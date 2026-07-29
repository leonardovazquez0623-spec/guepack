CREATE OR REPLACE FUNCTION public.crear_pedido_paqueteria_atomico(
  p_user_id TEXT,
  p_tenant_id BIGINT,
  p_idempotency_key TEXT,
  p_servicio TEXT,
  p_bolsas INTEGER,
  p_cajas INTEGER,
  p_nombre TEXT,
  p_nombre_remitente TEXT,
  p_whatsapp TEXT,
  p_direccion_recoleccion TEXT,
  p_fecha DATE,
  p_instrucciones TEXT,
  p_metodo_pago TEXT,
  p_comprobante_pago TEXT,
  p_estado TEXT,
  p_token_rastreo TEXT,
  p_lat_recoleccion DOUBLE PRECISION,
  p_lng_recoleccion DOUBLE PRECISION,
  p_precio_cotizado NUMERIC,
  p_cargo_cancelacion NUMERIC,
  p_cupon_codigo TEXT
)
RETURNS TABLE (
  pedido JSONB,
  es_recuperacion BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_usuario public.usuarios%ROWTYPE;
  v_empresa public.empresas_afiliadas%ROWTYPE;
  v_servicio TEXT;
  v_precio_bolsas NUMERIC := 0;
  v_precio_cajas NUMERIC := 0;
  v_subtotal NUMERIC;
  v_iva NUMERIC;
  v_iva_calculado NUMERIC;
  v_cargo_cancelacion NUMERIC;
  v_precio_final NUMERIC;
  v_direccion_entrega TEXT;
  v_descripcion_cantidades TEXT;
  v_zona TEXT;
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

  v_servicio := lower(btrim(COALESCE(p_servicio, '')));
  IF v_servicio NOT IN ('paqueteria', 'mercado_libre') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'SERVICIO_PAQUETERIA_INVALIDO';
  END IF;
  IF p_bolsas IS NULL OR p_bolsas < 0 OR p_bolsas > 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANTIDAD_BOLSAS_INVALIDA';
  END IF;
  IF p_cajas IS NULL OR p_cajas < 0 OR p_cajas > 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANTIDAD_CAJAS_INVALIDA';
  END IF;
  IF p_bolsas = 0 AND p_cajas = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CANTIDADES_PAQUETERIA_REQUERIDAS';
  END IF;
  IF p_lat_recoleccion IS NULL
     OR p_lat_recoleccion < -90
     OR p_lat_recoleccion > 90
     OR p_lng_recoleccion IS NULL
     OR p_lng_recoleccion < -180
     OR p_lng_recoleccion > 180 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'COORDENADAS_RECOLECCION_INVALIDAS';
  END IF;
  IF p_precio_cotizado IS NULL OR p_precio_cotizado < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRECIO_INVALIDO';
  END IF;
  IF p_nombre IS NULL
     OR btrim(p_nombre) = ''
     OR p_whatsapp IS NULL
     OR btrim(p_whatsapp) = ''
     OR p_direccion_recoleccion IS NULL
     OR btrim(p_direccion_recoleccion) = ''
     OR p_fecha IS NULL
     OR p_metodo_pago IS NULL
     OR btrim(p_metodo_pago) = ''
     OR p_estado IS NULL
     OR btrim(p_estado) = ''
     OR p_token_rastreo IS NULL
     OR btrim(p_token_rastreo) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DATOS_PEDIDO_INVALIDOS';
  END IF;

  -- Serializa reintentos concurrentes con la misma clave.
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

  -- El perfil bloqueado es la fuente de empresa y cargo pendiente.
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
  -- Solo TRUE habilita el servicio; FALSE y NULL se rechazan.
  IF v_servicio = 'paqueteria'
     AND v_empresa.permite_paqueterias IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAQUETERIA_NO_PERMITIDA';
  END IF;
  IF v_servicio = 'mercado_libre'
     AND v_empresa.permite_mercado_libre IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MERCADO_LIBRE_NO_PERMITIDO';
  END IF;
  IF v_empresa.iva IS NULL
     OR v_empresa.iva::NUMERIC < 0
     OR v_empresa.iva::NUMERIC > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
  END IF;
  v_iva := v_empresa.iva::NUMERIC;

  /*
   * Regla determinista para rangos solapados:
   * 1. menor cantidad_desde;
   * 2. menor cantidad_hasta, dejando rangos abiertos al final;
   * 3. menor precio como desempate final.
   */
  IF p_bolsas > 0 THEN
    SELECT r.precio::NUMERIC
    INTO v_precio_bolsas
    FROM public.rangos_paqueteria AS r
    WHERE r.empresa_id = v_empresa.id
      AND r.servicio = v_servicio
      AND r.tipo = 'Bolsa'
      AND r.cantidad_desde IS NOT NULL
      AND r.precio IS NOT NULL
      AND r.cantidad_desde >= 0
      AND r.precio >= 0
      AND (r.cantidad_hasta IS NULL OR r.cantidad_hasta >= r.cantidad_desde)
      AND r.cantidad_desde <= p_bolsas
      AND (r.cantidad_hasta IS NULL OR p_bolsas <= r.cantidad_hasta)
    ORDER BY
      r.cantidad_desde ASC,
      r.cantidad_hasta ASC NULLS LAST,
      r.precio ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RANGO_BOLSAS_NO_ENCONTRADO';
    END IF;
  END IF;

  IF p_cajas > 0 THEN
    SELECT r.precio::NUMERIC
    INTO v_precio_cajas
    FROM public.rangos_paqueteria AS r
    WHERE r.empresa_id = v_empresa.id
      AND r.servicio = v_servicio
      AND r.tipo = 'Caja'
      AND r.cantidad_desde IS NOT NULL
      AND r.precio IS NOT NULL
      AND r.cantidad_desde >= 0
      AND r.precio >= 0
      AND (r.cantidad_hasta IS NULL OR r.cantidad_hasta >= r.cantidad_desde)
      AND r.cantidad_desde <= p_cajas
      AND (r.cantidad_hasta IS NULL OR p_cajas <= r.cantidad_hasta)
    ORDER BY
      r.cantidad_desde ASC,
      r.cantidad_hasta ASC NULLS LAST,
      r.precio ASC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RANGO_CAJAS_NO_ENCONTRADO';
    END IF;
  END IF;

  v_subtotal := round(v_precio_bolsas + v_precio_cajas, 2);
  -- VIP no participa en este flujo.
  v_iva_calculado := round(v_subtotal * v_iva, 2);
  v_cargo_cancelacion := GREATEST(
    0,
    round(COALESCE(v_usuario.cargo_cancelacion, 0)::NUMERIC, 2)
  );

  IF v_cargo_cancelacion IS DISTINCT FROM
     GREATEST(0, round(COALESCE(p_cargo_cancelacion, 0), 2)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
  END IF;

  v_precio_final := round(
    v_subtotal + v_iva_calculado + v_cargo_cancelacion,
    2
  );

  IF round(p_precio_cotizado, 2) IS DISTINCT FROM v_precio_final THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_PAQUETERIA_CAMBIO';
  END IF;

  v_direccion_entrega := CASE v_servicio
    WHEN 'paqueteria' THEN 'Paquetería DHL/FedEx/Estafeta'
    ELSE 'Mercado Libre'
  END;

  v_descripcion_cantidades := concat_ws(
    ' + ',
    CASE
      WHEN p_bolsas > 0 THEN
        p_bolsas || ' ' || CASE WHEN p_bolsas = 1 THEN 'bolsa' ELSE 'bolsas' END
    END,
    CASE
      WHEN p_cajas > 0 THEN
        p_cajas || ' ' || CASE WHEN p_cajas = 1 THEN 'caja' ELSE 'cajas' END
    END
  );

  v_zona := CASE v_servicio
    WHEN 'paqueteria' THEN 'Recolección paquetería'
    ELSE 'Recolección Mercado Libre'
  END || ' · ' || v_descripcion_cantidades;

  INSERT INTO public.pedidos (
    nombre, nombre_remitente, whatsapp, direccion_recoleccion, direccion_entrega,
    fecha, tamanio, zona, precio, estado, user_id, tenant_id, instrucciones,
    metodo_pago, comprobante_pago, cupon_codigo, token_rastreo, empresa_codigo,
    es_tarifa_adicional, km_recorridos, lat_recoleccion, lng_recoleccion,
    lat_entrega, lng_entrega, cargo_cancelacion, idempotency_key
  )
  VALUES (
    p_nombre, NULLIF(btrim(p_nombre_remitente), ''), p_whatsapp,
    p_direccion_recoleccion, v_direccion_entrega, p_fecha, 'sobre', v_zona,
    -- pedidos.precio es BIGINT en el esquema actual.
    ROUND(v_precio_final)::BIGINT,
    p_estado, p_user_id, p_tenant_id, NULLIF(btrim(p_instrucciones), ''),
    p_metodo_pago, NULLIF(btrim(p_comprobante_pago), ''), NULL,
    p_token_rastreo, btrim(v_usuario.empresa_codigo), FALSE, 0,
    p_lat_recoleccion, p_lng_recoleccion, NULL, NULL,
    v_cargo_cancelacion, p_idempotency_key
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

COMMENT ON FUNCTION public.crear_pedido_paqueteria_atomico(
  TEXT, BIGINT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE,
  TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC,
  NUMERIC, TEXT
) IS 'Crea pedidos corporativos de paquetería o Mercado Libre, recalcula rangos e IVA y consume atómicamente el cargo de cancelación. Solo puede invocarse con service_role.';

REVOKE ALL ON FUNCTION public.crear_pedido_paqueteria_atomico(
  TEXT, BIGINT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE,
  TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC,
  NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_pedido_paqueteria_atomico(
  TEXT, BIGINT, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, DATE,
  TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC,
  NUMERIC, TEXT
) TO service_role;
