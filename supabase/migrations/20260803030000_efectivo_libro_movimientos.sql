-- =====================================================================
-- GUEPACK · 20260803030000_efectivo_libro_movimientos.sql
--
-- PASO C — mueve al servidor el manejo de efectivo y entregas.
--
-- Qué está mal hoy (repartidor.html:1923 y :1970):
--   · _confirmarCobrado(pedidoId, monto) recibe el pedido y NO lo usa:
--     doble tap = doble cobro, y no hay registro de qué se cobró
--   · el monto viaja en el onclick del DOM: editable desde el navegador
--   · el update va .eq('nombre', ...): se pisa entre tenants homónimos
--   · confirmarDeposito() pone efectivo_acumulado = 0 sin guardar cuánto
--   · total_envios sube en cada 'Entregado': re-marcar duplica
--   · multiparada (completarRutaMulti) nunca muestra el botón de cobro:
--     el efectivo de esos pedidos NO se registra jamás
--
-- La solución no es mover el UPDATE a un RPC, es tener un libro de
-- movimientos. Así la idempotencia sale gratis (UNIQUE por pedido),
-- queda historial auditable, y el depósito pasa de "borrar el saldo" a
-- ser un asiento más.
--
-- efectivo_acumulado se conserva como saldo cacheado para que admin.html
-- siga funcionando sin cambios; los RPC lo recalculan desde el libro.
--
-- OJO: esta migración NO bloquea todavía las escrituras directas del
-- frontend. Ese candado va en una migración posterior, DESPUÉS de que
-- repartidor.html use estos RPC. Aplicarlo antes rompe la operación.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Parámetros configurables por tenant
--    (hoy están quemados: 300 y 25 en repartidor.html)
-- ---------------------------------------------------------------------
ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS tope_efectivo         numeric NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS envios_para_premium   integer NOT NULL DEFAULT 25;

COMMENT ON COLUMN public.configuracion.tope_efectivo IS
  'Efectivo acumulado que obliga a depositar antes de seguir cobrando.';

-- ---------------------------------------------------------------------
-- 2. Libro de movimientos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.movimientos_efectivo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     bigint NOT NULL,
  repartidor_id bigint NOT NULL REFERENCES public.repartidores(id) ON DELETE RESTRICT,
  pedido_id     bigint REFERENCES public.pedidos(id) ON DELETE SET NULL,
  tipo          text   NOT NULL CHECK (tipo IN ('cobro','deposito','ajuste','saldo_inicial')),
  -- cobro y saldo_inicial suman; deposito resta; ajuste puede ir en ambos sentidos
  monto         numeric NOT NULL CHECK (monto <> 0),
  nota          text,
  registrado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Esta es la idempotencia: un pedido no se puede cobrar dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_cobro_por_pedido_uq
  ON public.movimientos_efectivo (pedido_id)
  WHERE tipo = 'cobro' AND pedido_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS movimientos_repartidor_idx
  ON public.movimientos_efectivo (repartidor_id, created_at DESC);

ALTER TABLE public.movimientos_efectivo ENABLE ROW LEVEL SECURITY;

-- Nadie escribe directo: solo los RPC (SECURITY DEFINER) insertan.
DROP POLICY IF EXISTS "admin lee movimientos de su tenant" ON public.movimientos_efectivo;
CREATE POLICY "admin lee movimientos de su tenant"
  ON public.movimientos_efectivo FOR SELECT TO authenticated
  USING (public.is_admin_tenant(tenant_id));

DROP POLICY IF EXISTS "repartidor lee sus movimientos" ON public.movimientos_efectivo;
CREATE POLICY "repartidor lee sus movimientos"
  ON public.movimientos_efectivo FOR SELECT TO authenticated
  USING (repartidor_id = public.mi_repartidor_id());

-- Saldo de apertura para quien ya trae efectivo acumulado, para que el
-- libro cuadre con la realidad desde el día uno.
INSERT INTO public.movimientos_efectivo (tenant_id, repartidor_id, tipo, monto, nota)
SELECT r.tenant_id, r.id, 'saldo_inicial', r.efectivo_acumulado,
       'Saldo previo a la migración del libro de movimientos'
FROM public.repartidores r
WHERE COALESCE(r.efectivo_acumulado, 0) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.movimientos_efectivo m
    WHERE m.repartidor_id = r.id AND m.tipo = 'saldo_inicial'
  );

-- ---------------------------------------------------------------------
-- 3. Saldo derivado del libro
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saldo_efectivo(p_repartidor_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN m.tipo = 'deposito' THEN -m.monto ELSE m.monto END
  ), 0)
  FROM public.movimientos_efectivo m
  WHERE m.repartidor_id = p_repartidor_id;
$$;

-- ---------------------------------------------------------------------
-- 4. registrar_cobro_efectivo
--
-- Idempotente: el segundo tap devuelve ya_registrado = true sin sumar.
-- El monto sale de pedidos.precio en la BASE, nunca del cliente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_cobro_efectivo(p_pedido_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_repa_id  bigint;
  v_pedido   record;
  v_tope     numeric;
  v_saldo    numeric;
  v_ya       boolean := false;
BEGIN
  v_repa_id := public.mi_repartidor_id();
  IF v_repa_id IS NULL THEN
    RAISE EXCEPTION 'No estás registrado como repartidor';
  END IF;

  -- FOR UPDATE serializa dos taps simultáneos sobre el mismo pedido
  SELECT p.id, p.precio, p.metodo_pago, p.estado, p.tenant_id, p.repartidor_id
    INTO v_pedido
  FROM public.pedidos p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  -- Solo el repartidor asignado cobra ese pedido
  IF v_pedido.repartidor_id IS DISTINCT FROM v_repa_id THEN
    RAISE EXCEPTION 'Ese pedido no está asignado a ti';
  END IF;

  IF lower(COALESCE(v_pedido.metodo_pago, '')) <> 'efectivo' THEN
    RAISE EXCEPTION 'Ese pedido no es de pago en efectivo';
  END IF;

  IF COALESCE(v_pedido.precio, 0) <= 0 THEN
    RAISE EXCEPTION 'El pedido no tiene precio válido';
  END IF;

  -- Idempotencia real: si ya existe el asiento, no se duplica
  INSERT INTO public.movimientos_efectivo
    (tenant_id, repartidor_id, pedido_id, tipo, monto, registrado_por, nota)
  VALUES
    (v_pedido.tenant_id, v_repa_id, p_pedido_id, 'cobro', v_pedido.precio,
     auth.uid(), 'Cobro en domicilio')
  ON CONFLICT (pedido_id) WHERE tipo = 'cobro' AND pedido_id IS NOT NULL
  DO NOTHING;

  IF NOT FOUND THEN
    v_ya := true;   -- ya estaba registrado; no se sumó de nuevo
  END IF;

  v_saldo := public.saldo_efectivo(v_repa_id);

  SELECT c.tope_efectivo INTO v_tope
  FROM public.configuracion c WHERE c.tenant_id = v_pedido.tenant_id LIMIT 1;
  v_tope := COALESCE(v_tope, 300);

  UPDATE public.repartidores
     SET efectivo_acumulado = v_saldo,
         bloqueado_efectivo = (v_saldo >= v_tope)
   WHERE id = v_repa_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ya_registrado', v_ya,
    'monto', v_pedido.precio,
    'saldo', v_saldo,
    'tope', v_tope,
    'bloqueado', (v_saldo >= v_tope)
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 5. registrar_deposito  (admin)
--
-- Reemplaza el "efectivo_acumulado = 0" de admin.html:2551, que borraba
-- el saldo sin dejar constancia de cuánto se depositó.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_deposito(
  p_repartidor_id bigint,
  p_monto numeric DEFAULT NULL,   -- NULL = deposita el saldo completo
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_tenant bigint;
  v_saldo  numeric;
  v_monto  numeric;
  v_tope   numeric;
BEGIN
  SELECT r.tenant_id INTO v_tenant
  FROM public.repartidores r WHERE r.id = p_repartidor_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Repartidor no encontrado';
  END IF;

  IF NOT public.is_admin_tenant(v_tenant) THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar depósitos';
  END IF;

  v_saldo := public.saldo_efectivo(p_repartidor_id);
  v_monto := COALESCE(p_monto, v_saldo);

  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del depósito debe ser mayor a cero';
  END IF;

  INSERT INTO public.movimientos_efectivo
    (tenant_id, repartidor_id, tipo, monto, registrado_por, nota)
  VALUES
    (v_tenant, p_repartidor_id, 'deposito', v_monto, auth.uid(),
     COALESCE(p_nota, 'Depósito confirmado por admin'));

  v_saldo := public.saldo_efectivo(p_repartidor_id);

  SELECT c.tope_efectivo INTO v_tope
  FROM public.configuracion c WHERE c.tenant_id = v_tenant LIMIT 1;
  v_tope := COALESCE(v_tope, 300);

  UPDATE public.repartidores
     SET efectivo_acumulado = v_saldo,
         bloqueado_efectivo = (v_saldo >= v_tope)
   WHERE id = p_repartidor_id;

  RETURN jsonb_build_object('ok', true, 'depositado', v_monto, 'saldo', v_saldo);
END;
$$;

-- ---------------------------------------------------------------------
-- 6. marcar_entregado
--
-- total_envios sube UNA sola vez: si el pedido ya estaba 'Entregado',
-- no vuelve a contar. Hoy re-marcar duplica el contador.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_entregado(p_pedido_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_repa_id   bigint;
  v_pedido    record;
  v_ya        boolean := false;
  v_total     integer;
  v_meta      integer;
  v_nivel     text;
  v_subio     boolean := false;
BEGIN
  v_repa_id := public.mi_repartidor_id();
  IF v_repa_id IS NULL THEN
    RAISE EXCEPTION 'No estás registrado como repartidor';
  END IF;

  SELECT p.id, p.estado, p.tenant_id, p.repartidor_id
    INTO v_pedido
  FROM public.pedidos p WHERE p.id = p_pedido_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  IF v_pedido.repartidor_id IS DISTINCT FROM v_repa_id THEN
    RAISE EXCEPTION 'Ese pedido no está asignado a ti';
  END IF;

  IF v_pedido.estado = 'Entregado' THEN
    v_ya := true;
  ELSE
    UPDATE public.pedidos SET estado = 'Entregado' WHERE id = p_pedido_id;

    SELECT c.envios_para_premium INTO v_meta
    FROM public.configuracion c WHERE c.tenant_id = v_pedido.tenant_id LIMIT 1;
    v_meta := COALESCE(v_meta, 25);

    UPDATE public.repartidores
       SET total_envios = COALESCE(total_envios, 0) + 1,
           nivel = CASE
                     WHEN COALESCE(total_envios, 0) + 1 >= v_meta THEN 'premium'
                     ELSE COALESCE(nivel, 'nuevo')
                   END
     WHERE id = v_repa_id
     RETURNING total_envios, nivel INTO v_total, v_nivel;

    v_subio := (v_nivel = 'premium');
  END IF;

  IF v_total IS NULL THEN
    SELECT r.total_envios, r.nivel INTO v_total, v_nivel
    FROM public.repartidores r WHERE r.id = v_repa_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'ya_entregado', v_ya,
    'total_envios', v_total, 'nivel', v_nivel, 'es_premium', v_subio
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_cobro_efectivo(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_deposito(bigint, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marcar_entregado(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_efectivo(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_deposito(bigint, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_entregado(bigint) TO authenticated;

COMMIT;

-- =====================================================================
-- DESPUÉS de migrar repartidor.html y admin.html a estos RPC, correr
-- esta segunda parte para cerrar las escrituras directas. NO antes.
-- =====================================================================
-- CREATE OR REPLACE FUNCTION public.proteger_campos_repartidor()
-- RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
-- BEGIN
--   IF auth.uid() IS NULL THEN RETURN NEW; END IF;              -- backend/cron
--   IF public.is_admin_tenant(NEW.tenant_id) THEN RETURN NEW; END IF;
--   IF NEW.efectivo_acumulado IS DISTINCT FROM OLD.efectivo_acumulado
--   OR NEW.bloqueado_efectivo IS DISTINCT FROM OLD.bloqueado_efectivo
--   OR NEW.total_envios       IS DISTINCT FROM OLD.total_envios
--   OR NEW.nivel              IS DISTINCT FROM OLD.nivel
--   OR NEW.ganancia_base      IS DISTINCT FROM OLD.ganancia_base
--   OR NEW.ganancia_por_km    IS DISTINCT FROM OLD.ganancia_por_km
--   OR NEW.ganancia_tarifa_diaria IS DISTINCT FROM OLD.ganancia_tarifa_diaria
--   OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
--   OR NEW.user_id   IS DISTINCT FROM OLD.user_id
--   OR NEW.email     IS DISTINCT FROM OLD.email
--   OR NEW.nombre    IS DISTINCT FROM OLD.nombre THEN
--     RAISE EXCEPTION 'Solo un administrador puede modificar ese campo';
--   END IF;
--   RETURN NEW;
-- END; $$;
-- DROP TRIGGER IF EXISTS trg_proteger_campos_repartidor ON public.repartidores;
-- CREATE TRIGGER trg_proteger_campos_repartidor
--   BEFORE UPDATE ON public.repartidores
--   FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_repartidor();

-- =====================================================================
-- VERIFICAR
-- =====================================================================
-- SELECT public.saldo_efectivo(1);
-- SELECT * FROM public.movimientos_efectivo ORDER BY id DESC LIMIT 10;
-- SELECT public.registrar_cobro_efectivo(289);   -- como repartidor, no en SQL Editor
