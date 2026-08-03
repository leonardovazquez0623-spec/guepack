-- =====================================================================
-- GUEPACK · 20260803020000_repartidores_vinculo_y_ubicacion.sql
--
-- v2 — corregida tras el reporte de Codex.
--
-- CAMBIO RESPECTO A v1: se eliminó el trigger proteger_campos_repartidor.
-- Bloqueaba efectivo_acumulado, total_envios y nivel, que repartidor.html
-- escribe DIRECTO desde el navegador (botón "Cobrado" y "Entregado").
-- Aplicarlo habría roto la operación diaria.
--
-- Ese hueco (un repartidor puede editarse su propio efectivo y nivel) se
-- cierra en el Paso C, moviendo esos incrementos a un RPC atómico. Hasta
-- entonces sigue abierto: hoy no importa porque el único repartidor es el
-- dueño, pero debe cerrarse antes de que entre alguien más.
--
-- Qué sí hace:
--   1. repartidores.user_id     -> ancla por UUID
--   2. pedidos.repartidor_id    -> FK real + trigger de sincronización
--   3. calificaciones.repartidor_id
--   4. repartidor_ubicacion     -> ubicación de todos, con fix_at
--   5. is_admin_tenant()        -> is_admin() sin tenant es la raíz de las fugas
--   6. repartidores: cerrar el ALL sin tenant
--   7. Umbrales del semáforo por tenant
--
-- No elimina pedidos.repartidor ni repartidores.email: se sincronizan
-- durante la transición. La limpieza va después, con las lecturas migradas.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. repartidores.user_id
-- ---------------------------------------------------------------------
ALTER TABLE public.repartidores
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.repartidores r
SET user_id = u.id
FROM auth.users u
WHERE r.user_id IS NULL
  AND r.email IS NOT NULL
  AND lower(u.email) = lower(r.email);

CREATE UNIQUE INDEX IF NOT EXISTS repartidores_user_tenant_uq
  ON public.repartidores (user_id, tenant_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS repartidores_tenant_idx
  ON public.repartidores (tenant_id);

-- ---------------------------------------------------------------------
-- 2. pedidos.repartidor_id
-- ---------------------------------------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS repartidor_id bigint
    REFERENCES public.repartidores(id) ON DELETE SET NULL;

UPDATE public.pedidos p
SET repartidor_id = r.id
FROM public.repartidores r
WHERE p.repartidor_id IS NULL
  AND p.repartidor IS NOT NULL
  AND r.nombre = p.repartidor
  AND r.tenant_id = p.tenant_id;

CREATE INDEX IF NOT EXISTS pedidos_repartidor_id_idx
  ON public.pedidos (repartidor_id) WHERE repartidor_id IS NOT NULL;

-- Sincroniza nombre <-> id en ambos sentidos durante la transición.
-- Gracias a esto, admin.html y aceptar_pedido_atomico siguen escribiendo
-- el nombre como hoy y el id se resuelve solo. Nada se rompe en el medio.
CREATE OR REPLACE FUNCTION public.sync_pedido_repartidor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.repartidor_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.repartidor_id IS DISTINCT FROM OLD.repartidor_id) THEN
    SELECT r.nombre INTO NEW.repartidor
    FROM public.repartidores r WHERE r.id = NEW.repartidor_id;

  ELSIF NEW.repartidor IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.repartidor IS DISTINCT FROM OLD.repartidor) THEN
    SELECT r.id INTO NEW.repartidor_id
    FROM public.repartidores r
    WHERE r.nombre = NEW.repartidor
      AND (NEW.tenant_id IS NULL OR r.tenant_id = NEW.tenant_id)
    LIMIT 1;
  END IF;

  IF NEW.repartidor IS NULL THEN
    NEW.repartidor_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pedido_repartidor ON public.pedidos;
CREATE TRIGGER trg_sync_pedido_repartidor
  BEFORE INSERT OR UPDATE OF repartidor, repartidor_id ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.sync_pedido_repartidor();

-- ---------------------------------------------------------------------
-- 3. calificaciones.repartidor_id  (mismo problema: guarda el nombre)
-- ---------------------------------------------------------------------
ALTER TABLE public.calificaciones
  ADD COLUMN IF NOT EXISTS repartidor_id bigint
    REFERENCES public.repartidores(id) ON DELETE SET NULL;

UPDATE public.calificaciones c
SET repartidor_id = r.id
FROM public.repartidores r
WHERE c.repartidor_id IS NULL
  AND c.repartidor IS NOT NULL
  AND r.nombre = c.repartidor;

CREATE INDEX IF NOT EXISTS calificaciones_repartidor_id_idx
  ON public.calificaciones (repartidor_id) WHERE repartidor_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Funciones de identidad
-- ---------------------------------------------------------------------

-- is_admin() no verifica tenant: esa es la raíz de la fuga de
-- precios_generales, no las policies. Esta es la versión correcta.
-- is_admin() se conserva por ahora: cambiarla toca TODAS las policies
-- de golpe y eso va en su propia migración, con pruebas.
CREATE OR REPLACE FUNCTION public.is_admin_tenant(p_tenant_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuario_tenant_roles utr
    WHERE utr.user_id = auth.uid()::text
      AND utr.tenant_id = p_tenant_id
      AND utr.rol = 'admin'
  ) OR EXISTS (
    -- compatibilidad: el modelo viejo (usuarios.rol) sigue vivo en policies
    SELECT 1 FROM public.usuarios u
    WHERE u.user_id = auth.uid()::text
      AND u.rol = 'admin'
      AND (u.tenant_id = p_tenant_id OR u.es_superadmin = TRUE)
  );
$$;

CREATE OR REPLACE FUNCTION public.mi_repartidor_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT r.id FROM public.repartidores r
  WHERE r.user_id = auth.uid()
  ORDER BY (r.tenant_id = public.mi_tenant_id()) DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- 5. repartidor_ubicacion
--
-- Aparte de driver_locations (es por pedido: no ve a los repartidores
-- libres) y aparte de repartidores.lat/lng (sin timestamp, y comparte
-- tabla con efectivo_acumulado y ganancias — no queremos eso en Realtime).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repartidor_ubicacion (
  repartidor_id bigint PRIMARY KEY REFERENCES public.repartidores(id) ON DELETE CASCADE,
  user_id       uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     bigint NOT NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  heading       double precision,
  accuracy      double precision,
  -- fix_at = timestamp del GPS.  updated_at = cuándo llegó al server.
  -- Separados a propósito: una posición cacheada no debe pintar verde.
  fix_at        timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lat_valida CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT lng_valida CHECK (lng BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS repartidor_ubicacion_tenant_idx
  ON public.repartidor_ubicacion (tenant_id, fix_at DESC);

ALTER TABLE public.repartidor_ubicacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repartidor_ubicacion REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "repartidor escribe su ubicacion" ON public.repartidor_ubicacion;
CREATE POLICY "repartidor escribe su ubicacion"
  ON public.repartidor_ubicacion FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND repartidor_id = public.mi_repartidor_id());

DROP POLICY IF EXISTS "admin lee ubicacion de su tenant" ON public.repartidor_ubicacion;
CREATE POLICY "admin lee ubicacion de su tenant"
  ON public.repartidor_ubicacion FOR SELECT TO authenticated
  USING (public.is_admin_tenant(tenant_id));

-- ---------------------------------------------------------------------
-- 6. repartidores: cerrar el ALL sin tenant
--
-- "admin gestiona repartidores" era ALL / USING is_admin() / sin WITH CHECK.
-- Las policies permisivas se suman con OR, así que esa anulaba la de tenant
-- que estaba bien hecha: cualquier admin leía y ESCRIBÍA correos, tarifas y
-- efectivo_acumulado de repartidores de otros tenants, y sin WITH CHECK
-- podía reasignarles el tenant_id.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "admin gestiona repartidores" ON public.repartidores;

CREATE POLICY "admin gestiona repartidores de su tenant"
  ON public.repartidores FOR ALL TO authenticated
  USING (public.is_admin_tenant(tenant_id))
  WITH CHECK (public.is_admin_tenant(tenant_id));

-- La auto-actualización ahora ancla por UUID. Se conserva el match por
-- email como respaldo SOLO si el backfill no encontró user_id, para no
-- dejar a nadie fuera de su propia app.
DROP POLICY IF EXISTS "repartidor actualiza su disponibilidad" ON public.repartidores;
CREATE POLICY "repartidor actualiza su propia fila"
  ON public.repartidores FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND lower(email) = (
          SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid()))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND lower(email) = (
          SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid()))
  );

-- ---------------------------------------------------------------------
-- 7. Umbrales del semáforo GPS, por tenant
-- ---------------------------------------------------------------------
ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS gps_umbral_verde_seg integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS gps_umbral_ambar_seg integer NOT NULL DEFAULT 600;

ALTER TABLE public.configuracion
  DROP CONSTRAINT IF EXISTS gps_umbrales_coherentes;
ALTER TABLE public.configuracion
  ADD CONSTRAINT gps_umbrales_coherentes
  CHECK (gps_umbral_verde_seg > 0 AND gps_umbral_ambar_seg > gps_umbral_verde_seg);

-- ---------------------------------------------------------------------
-- 8. Marcar lo deprecado (no se elimina: primero migrar las lecturas)
-- ---------------------------------------------------------------------
COMMENT ON COLUMN public.repartidores.lat IS
  'DEPRECADO — usar repartidor_ubicacion. Sin timestamp, no sirve para el semáforo.';
COMMENT ON COLUMN public.repartidores.lng IS
  'DEPRECADO — usar repartidor_ubicacion.';
COMMENT ON COLUMN public.pedidos.repartidor IS
  'DEPRECADO — usar repartidor_id. Sincronizado por trigger durante la transición.';
COMMENT ON COLUMN public.calificaciones.repartidor IS
  'DEPRECADO — usar repartidor_id.';

COMMIT;

-- =====================================================================
-- VERIFICACIONES — correr después
-- =====================================================================

-- a) ¿Quedó algún repartidor sin user_id?   (se espera solo Edgar Natanael)
-- SELECT id, nombre, email, user_id FROM public.repartidores WHERE user_id IS NULL;

-- b) Pedidos sin repartidor_id              (se esperan los 2 de Edgar)
-- SELECT repartidor, count(*) FROM public.pedidos
-- WHERE repartidor IS NOT NULL AND repartidor_id IS NULL GROUP BY repartidor;

-- c) Los 165 de Leonardo Vazquez quedaron amarrados
-- SELECT count(*) FROM public.pedidos WHERE repartidor_id = 1;

-- d) Ninguna policy con USING true
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname='public' AND (qual='true' OR with_check='true');
