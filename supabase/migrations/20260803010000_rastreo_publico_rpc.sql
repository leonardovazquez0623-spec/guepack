-- =====================================================================
-- GUEPACK · 20260803010000_rastreo_publico_rpc.sql
--
-- Arregla la vista pública de rastreo (rastreo.html), que hoy está rota:
--   400 → pide repartidores.whatsapp, columna que no existe (es telefono)
--   401 → paradas y repartidores exigen auth.uid(); el cliente no tiene cuenta
--
-- Reemplaza dos queries directas del navegador por un solo RPC que:
--   - autoriza por token_rastreo (el mismo secreto del link)
--   - devuelve SOLO lo que el destinatario debe ver
--   - NO devuelve paradas.direccion, instrucciones, lat/lng, firma ni foto
--
-- Nota sobre multiparada: se devuelve posición y conteo, no direcciones.
-- Si el cliente manda el link a varios destinatarios, ninguno ve a dónde
-- van los paquetes de los demás. Cuando se agregue token por parada, ese
-- link sí podrá devolver su propia dirección sin cambiar este RPC.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rastreo_publico(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_pedido   record;
  v_repa     jsonb := NULL;
  v_paradas  jsonb := NULL;
  v_estrellas numeric;
BEGIN
  -- Token inválido y token inexistente devuelven lo mismo, a propósito:
  -- no confirmamos si un token existe.
  IF p_token IS NULL OR length(trim(p_token)) < 20 OR length(p_token) > 100 THEN
    RETURN jsonb_build_object('encontrado', false);
  END IF;

  SELECT p.id, p.estado, p.zona, p.tamanio, p.repartidor, p.tenant_id,
         p.created_at, p.nombre
    INTO v_pedido
  FROM public.pedidos p
  WHERE p.token_rastreo = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('encontrado', false);
  END IF;

  -- Repartidor: solo lo que el destinatario necesita para reconocerlo.
  -- Sin email, sin ganancias, sin efectivo_acumulado.
  IF v_pedido.repartidor IS NOT NULL THEN
    SELECT jsonb_build_object(
             'nombre',      r.nombre,
             'foto_perfil', r.foto_perfil,
             'placas',      r.placas,
             'telefono',    r.telefono      -- era 'whatsapp': esa columna no existe
           )
      INTO v_repa
    FROM public.repartidores r
    WHERE r.nombre = v_pedido.repartidor
      AND r.tenant_id = v_pedido.tenant_id  -- evita cruce entre tenants con nombres iguales
    LIMIT 1;

    SELECT round(avg(c.estrellas)::numeric, 1)
      INTO v_estrellas
    FROM public.calificaciones c
    WHERE c.repartidor = v_pedido.repartidor;
  END IF;

  -- Paradas: progreso, no direcciones.
  SELECT jsonb_agg(
           jsonb_build_object(
             'orden',  s.orden,
             'estado', s.estado,
             'completada', (s.estado = 'completada')
           ) ORDER BY s.orden
         )
    INTO v_paradas
  FROM public.paradas s
  WHERE s.pedido_id = v_pedido.id;

  RETURN jsonb_build_object(
    'encontrado', true,
    'pedido', jsonb_build_object(
      'folio',      'GK-' || v_pedido.id,
      'estado',     v_pedido.estado,
      'zona',       v_pedido.zona,
      'tamanio',    v_pedido.tamanio,
      'created_at', v_pedido.created_at
    ),
    'repartidor', v_repa,
    'calificacion', v_estrellas,
    'paradas', COALESCE(v_paradas, '[]'::jsonb),
    'total_paradas',      COALESCE(jsonb_array_length(v_paradas), 0),
    'paradas_completadas', (
      SELECT count(*) FROM public.paradas s
      WHERE s.pedido_id = v_pedido.id AND s.estado = 'completada'
    )
  );
END;
$$;

-- El link de rastreo se abre sin cuenta: anon necesita ejecutarlo.
REVOKE ALL ON FUNCTION public.rastreo_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rastreo_publico(text) TO anon, authenticated;

COMMENT ON FUNCTION public.rastreo_publico(text) IS
  'Vista pública de rastreo autorizada por token_rastreo. No expone direcciones de paradas, evidencias ni datos del repartidor más allá de nombre, foto, placas y teléfono.';

-- ---------------------------------------------------------------------
-- token_rastreo generado por la base, no por el navegador
--
-- Hoy app.html:5445 hace crypto.randomUUID() y lo escribe directo. Es el
-- único secreto de la vista pública; debe nacer del servidor.
-- ---------------------------------------------------------------------
ALTER TABLE public.pedidos
  ALTER COLUMN token_rastreo SET DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_token_rastreo_uq
  ON public.pedidos (token_rastreo)
  WHERE token_rastreo IS NOT NULL;

COMMIT;

-- =====================================================================
-- VERIFICAR (sustituye el token por uno real de tus 3 pedidos activos)
-- =====================================================================
-- SELECT public.rastreo_publico('TOKEN_REAL_AQUI');
-- SELECT public.rastreo_publico('token-basura');        -- {"encontrado": false}
-- SELECT public.rastreo_publico(NULL);                  -- {"encontrado": false}
