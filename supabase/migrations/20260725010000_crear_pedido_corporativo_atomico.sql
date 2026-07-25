CREATE OR REPLACE FUNCTION public.crear_pedido_corporativo_atomico(
  p_user_id TEXT,
  p_tenant_id BIGINT,
  p_idempotency_key TEXT,
  p_nombre TEXT,
  p_nombre_remitente TEXT,
  p_whatsapp TEXT,
  p_direccion_recoleccion TEXT,
  p_direccion_entrega TEXT,
  p_fecha DATE,
  p_tamanio TEXT,
  p_zona TEXT,
  p_precio_cotizado NUMERIC,
  p_estado TEXT,
  p_instrucciones TEXT,
  p_metodo_pago TEXT,
  p_comprobante_pago TEXT,
  p_token_rastreo TEXT,
  p_km_recorridos NUMERIC,
  p_lat_recoleccion DOUBLE PRECISION,
  p_lng_recoleccion DOUBLE PRECISION,
  p_lat_entrega DOUBLE PRECISION,
  p_lng_entrega DOUBLE PRECISION,
  p_cargo_cancelacion NUMERIC,
  p_cupon_codigo TEXT
)
RETURNS TABLE (pedido JSONB, es_recuperacion BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_usuario public.usuarios%ROWTYPE;
  v_empresa public.empresas_afiliadas%ROWTYPE;
  v_precios_generales public.precios_generales%ROWTYPE;
  v_rango RECORD;
  v_rango_encontrado BOOLEAN := FALSE;
  v_hay_rangos BOOLEAN := FALSE;
  v_rango_desde NUMERIC;
  v_rango_hasta NUMERIC;
  v_rango_precio NUMERIC;
  v_tarifa_km NUMERIC;
  v_tarifa_minima NUMERIC;
  v_km_minimo NUMERIC;
  v_tarifa_base_extra NUMERIC;
  v_iva NUMERIC;
  v_cargo_paquete_grande NUMERIC := 0;
  v_cargo_cancelacion NUMERIC := 0;
  v_precio_base NUMERIC;
  v_subtotal NUMERIC;
  v_iva_calculado NUMERIC;
  v_precio_final NUMERIC;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'USUARIO_INVALIDO';
  END IF;
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TENANT_INVALIDO';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CLAVE_IDEMPOTENCIA_INVALIDA';
  END IF;
  IF p_km_recorridos IS NULL OR p_km_recorridos < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DISTANCIA_INVALIDA';
  END IF;
  IF p_precio_cotizado IS NULL OR p_precio_cotizado < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRECIO_INVALIDO';
  END IF;
  IF p_tamanio IS NULL OR btrim(p_tamanio) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TAMANIO_INVALIDO';
  END IF;

  -- Serializa reintentos concurrentes del mismo pedido.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  SELECT *
  INTO v_pedido
  FROM public.pedidos
  WHERE idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF v_pedido.user_id IS DISTINCT FROM p_user_id
       OR v_pedido.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CLAVE_IDEMPOTENCIA_EN_USO';
    END IF;
    RETURN QUERY SELECT to_jsonb(v_pedido), TRUE;
    RETURN;
  END IF;

  -- 1. Bloquea el usuario. usuarios.empresa_codigo es la única fuente
  -- de verdad para determinar y resolver el camino corporativo.
  SELECT *
  INTO v_usuario
  FROM public.usuarios
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PERFIL_USUARIO_NO_ENCONTRADO';
  END IF;
  IF v_usuario.empresa_codigo IS NULL OR btrim(v_usuario.empresa_codigo) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPRESA_CORPORATIVA_NO_ENCONTRADA';
  END IF;
  IF p_cupon_codigo IS NOT NULL AND btrim(p_cupon_codigo) <> '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_NO_PERMITIDO_CORPORATIVO';
  END IF;

  -- 2. Resuelve y bloquea la empresa por tenant + código del usuario.
  -- Los rangos jamás se consultan antes de obtener este empresa_id.
  SELECT *
  INTO v_empresa
  FROM public.empresas_afiliadas
  WHERE tenant_id = p_tenant_id
    AND codigo = btrim(v_usuario.empresa_codigo)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPRESA_CORPORATIVA_NO_ENCONTRADA';
  END IF;
  IF v_empresa.activa IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPRESA_CORPORATIVA_INACTIVA';
  END IF;
  IF v_empresa.tipo_tarifa IS NULL OR btrim(v_empresa.tipo_tarifa) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
  END IF;
  IF lower(btrim(v_empresa.tipo_tarifa)) = 'diaria' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_DIARIA_NO_SOPORTADA';
  END IF;

  -- Fase 2 es estricta incluso cuando existen rangos configurados.
  IF v_empresa.tarifa_km IS NULL
     OR v_empresa.tarifa_minima IS NULL
     OR v_empresa.km_minimo IS NULL
     OR v_empresa.tarifa_base_extra IS NULL
     OR v_empresa.iva IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
  END IF;

  v_tarifa_km := v_empresa.tarifa_km::NUMERIC;
  v_tarifa_minima := v_empresa.tarifa_minima::NUMERIC;
  v_km_minimo := v_empresa.km_minimo::NUMERIC;
  v_tarifa_base_extra := v_empresa.tarifa_base_extra::NUMERIC;
  v_iva := v_empresa.iva::NUMERIC;

  IF v_tarifa_km < 0
     OR v_tarifa_minima < 0
     OR v_km_minimo < 0
     OR v_tarifa_base_extra < 0
     OR v_iva < 0
     OR v_iva > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
  END IF;

  -- 3. Solo bloquea precios_generales cuando se necesita el fallback.
  IF lower(btrim(p_tamanio)) = 'grande' THEN
    IF v_empresa.cargo_paquete_grande IS NOT NULL THEN
      v_cargo_paquete_grande := v_empresa.cargo_paquete_grande::NUMERIC;
      IF v_cargo_paquete_grande < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
      END IF;
    ELSE
      SELECT *
      INTO v_precios_generales
      FROM public.precios_generales
      WHERE tenant_id = p_tenant_id
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND
         OR v_precios_generales.cargo_paquete_grande IS NULL
         OR v_precios_generales.cargo_paquete_grande < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CARGO_GRANDE_INVALIDA';
      END IF;
      v_cargo_paquete_grande := v_precios_generales.cargo_paquete_grande::NUMERIC;
    END IF;
  END IF;

  -- 4. Bloquea rangos filtrados exclusivamente por la empresa ya resuelta.
  FOR v_rango IN
    SELECT km_desde, km_hasta, precio
    FROM public.rangos_precio_empresa
    WHERE empresa_id = v_empresa.id
    ORDER BY km_desde
    FOR UPDATE
  LOOP
    v_hay_rangos := TRUE;

    IF v_rango.km_desde IS NULL
       OR v_rango.precio IS NULL
       OR v_rango.km_desde::NUMERIC < 0
       OR v_rango.precio::NUMERIC < 0
       OR (
         v_rango.km_hasta IS NOT NULL
         AND (
           v_rango.km_hasta::NUMERIC < 0
           OR v_rango.km_hasta::NUMERIC < v_rango.km_desde::NUMERIC
         )
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_RANGOS_EMPRESA_INVALIDA';
    END IF;

    IF NOT v_rango_encontrado THEN
      -- Mientras no haya coincidencia, conserva el último rango como fallback.
      v_rango_desde := v_rango.km_desde::NUMERIC;
      v_rango_hasta := CASE
        WHEN v_rango.km_hasta IS NULL THEN NULL
        ELSE v_rango.km_hasta::NUMERIC
      END;
      v_rango_precio := v_rango.precio::NUMERIC;

      IF p_km_recorridos >= v_rango.km_desde::NUMERIC
         AND (
           v_rango.km_hasta IS NULL
           OR p_km_recorridos <= v_rango.km_hasta::NUMERIC
         ) THEN
        v_rango_encontrado := TRUE;
      END IF;
    END IF;
  END LOOP;

  IF v_hay_rangos THEN
    /*
     * Compatibilidad con el cotizador frontend actual:
     * si ningún rango coincide, se utiliza el último rango configurado.
     * Cuando ese último rango es cerrado, se cobra únicamente su precio,
     * sin sumar kilómetros excedentes. Esta particularidad se conserva
     * intencionalmente en Fase 2 para no cambiar el precio ya mostrado al
     * cliente; revisar por separado si debe tratarse como rango abierto.
     */
    v_precio_base := v_rango_precio;
    IF v_rango_hasta IS NULL AND p_km_recorridos > v_rango_desde THEN
      v_precio_base :=
        v_precio_base
        + round(p_km_recorridos - v_rango_desde, 1) * v_tarifa_km;
    END IF;
  ELSE
    IF p_km_recorridos <= v_km_minimo THEN
      v_precio_base := v_tarifa_minima;
    ELSE
      v_precio_base :=
        v_tarifa_base_extra
        + v_tarifa_km * (p_km_recorridos - v_km_minimo);
    END IF;
  END IF;

  v_subtotal := round(v_precio_base + v_cargo_paquete_grande, 2);
  -- VIP no aplica a corporativo.
  v_iva_calculado := round(v_subtotal * v_iva, 2);
  v_cargo_cancelacion :=
    GREATEST(0, round(COALESCE(v_usuario.cargo_cancelacion, 0)::NUMERIC, 2));

  IF v_cargo_cancelacion IS DISTINCT FROM
     GREATEST(0, round(COALESCE(p_cargo_cancelacion, 0), 2)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
  END IF;

  v_precio_final :=
    round(v_subtotal + v_iva_calculado + v_cargo_cancelacion, 2);

  -- Detecta cambios entre la previsualización y el cálculo bloqueado.
  IF round(p_precio_cotizado, 2) IS DISTINCT FROM v_precio_final THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_CORPORATIVA_CAMBIO';
  END IF;

  INSERT INTO public.pedidos (
    nombre, nombre_remitente, whatsapp, direccion_recoleccion, direccion_entrega,
    fecha, tamanio, zona, precio, estado, user_id, tenant_id, instrucciones,
    metodo_pago, comprobante_pago, cupon_codigo, token_rastreo, empresa_codigo,
    es_tarifa_adicional, km_recorridos, lat_recoleccion, lng_recoleccion,
    lat_entrega, lng_entrega, cargo_cancelacion, idempotency_key
  )
  VALUES (
    p_nombre, NULLIF(btrim(p_nombre_remitente), ''), p_whatsapp,
    p_direccion_recoleccion, p_direccion_entrega, p_fecha,
    lower(btrim(p_tamanio)), p_zona,
    -- pedidos.precio es BIGINT: redondea explícitamente antes del INSERT.
    ROUND(v_precio_final)::BIGINT,
    p_estado, p_user_id, p_tenant_id, NULLIF(btrim(p_instrucciones), ''),
    p_metodo_pago, NULLIF(btrim(p_comprobante_pago), ''), NULL,
    p_token_rastreo, btrim(v_usuario.empresa_codigo), FALSE,
    round(p_km_recorridos, 1), p_lat_recoleccion, p_lng_recoleccion,
    p_lat_entrega, p_lng_entrega, v_cargo_cancelacion, p_idempotency_key
  )
  RETURNING * INTO v_pedido;

  IF v_cargo_cancelacion > 0 THEN
    UPDATE public.usuarios
    SET cargo_cancelacion = 0
    WHERE user_id = p_user_id
      AND tenant_id = p_tenant_id;
  END IF;

  RETURN QUERY SELECT to_jsonb(v_pedido), FALSE;
END;
$$;

COMMENT ON FUNCTION public.crear_pedido_corporativo_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) IS 'Crea un pedido corporativo por distancia, recalcula la tarifa y consume el cargo pendiente de forma atómica. Solo puede invocarse con service_role.';

REVOKE ALL ON FUNCTION public.crear_pedido_corporativo_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_pedido_corporativo_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) TO service_role;
