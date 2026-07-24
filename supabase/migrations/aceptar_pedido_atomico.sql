DROP FUNCTION IF EXISTS public.aceptar_pedido_atomico(
  BIGINT,
  TEXT,
  NUMERIC
);

CREATE OR REPLACE FUNCTION public.aceptar_pedido_atomico(
  p_pedido_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  usuario_id UUID;
  repartidor_nombre TEXT;
  repartidor_tenant_id BIGINT;
  ganancia_base_config NUMERIC;
  ganancia_por_km_config NUMERIC;
  ganancia_diaria_config NUMERIC;
  pedido_tenant_id BIGINT;
  pedido_repartidor TEXT;
  pedido_km NUMERIC;
  pedido_precio NUMERIC;
  pedido_zona TEXT;
  ganancia_calculada NUMERIC;
  filas_afectadas INTEGER;
BEGIN
  usuario_id := auth.uid();

  IF usuario_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere una sesión autenticada'
      USING ERRCODE = '28000';
  END IF;

  SELECT
    r.nombre,
    r.tenant_id,
    COALESCE(r.ganancia_base, 20),
    COALESCE(r.ganancia_por_km, 5),
    COALESCE(r.ganancia_tarifa_diaria, 40)
  INTO
    repartidor_nombre,
    repartidor_tenant_id,
    ganancia_base_config,
    ganancia_por_km_config,
    ganancia_diaria_config
  FROM public.usuarios AS u
  INNER JOIN public.repartidores AS r
    ON LOWER(r.email) = LOWER(u.email)
   AND r.tenant_id = u.tenant_id
  WHERE u.user_id = usuario_id::TEXT
    AND u.rol = 'repartidor'
    AND r.disponible IS TRUE
  LIMIT 1;

  IF repartidor_nombre IS NULL THEN
    RAISE EXCEPTION 'El usuario autenticado no corresponde a un repartidor disponible'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    p.tenant_id,
    p.repartidor,
    COALESCE(p.km_recorridos, 0),
    COALESCE(p.precio, 0),
    COALESCE(p.zona, '')
  INTO
    pedido_tenant_id,
    pedido_repartidor,
    pedido_km,
    pedido_precio,
    pedido_zona
  FROM public.pedidos AS p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido solicitado no existe'
      USING ERRCODE = 'P0002';
  END IF;

  IF pedido_tenant_id IS DISTINCT FROM repartidor_tenant_id THEN
    RAISE EXCEPTION 'El repartidor no pertenece al tenant del pedido'
      USING ERRCODE = '42501';
  END IF;

  IF pedido_repartidor IS NOT NULL THEN
    RETURN 0;
  END IF;

  IF pedido_zona ILIKE '%Tarifa diaria%' THEN
    ganancia_calculada := ROUND(
      pedido_precio * ganancia_diaria_config / 100
    );
  ELSE
    ganancia_calculada := ROUND(
      ganancia_base_config + pedido_km * ganancia_por_km_config
    );
  END IF;

  UPDATE public.pedidos
  SET
    repartidor = repartidor_nombre,
    asignacion_automatica = TRUE,
    ganancia_repartidor = ganancia_calculada
  WHERE id = p_pedido_id
    AND repartidor IS NULL;

  GET DIAGNOSTICS filas_afectadas = ROW_COUNT;
  RETURN filas_afectadas;
END;
$$;

REVOKE ALL
ON FUNCTION public.aceptar_pedido_atomico(BIGINT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.aceptar_pedido_atomico(BIGINT)
FROM anon;

GRANT EXECUTE
ON FUNCTION public.aceptar_pedido_atomico(BIGINT)
TO authenticated;
