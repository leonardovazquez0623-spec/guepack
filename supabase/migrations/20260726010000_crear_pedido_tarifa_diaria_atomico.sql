CREATE OR REPLACE FUNCTION public.crear_pedido_tarifa_diaria_atomico(
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
  v_pedido_cobertura public.pedidos%ROWTYPE;
  v_fecha_mexico DATE;
  v_inicio_dia TIMESTAMPTZ;
  v_fin_dia TIMESTAMPTZ;
  v_tarifa_diaria NUMERIC;
  v_iva NUMERIC;
  v_base NUMERIC;
  v_cargo_cancelacion NUMERIC;
  v_precio_final NUMERIC;
  v_tarifa_cubierta BOOLEAN := FALSE;
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
  IF p_precio_cotizado IS NULL OR p_precio_cotizado < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRECIO_INVALIDO';
  END IF;
  IF p_cargo_cancelacion IS NULL OR p_cargo_cancelacion < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_INVALIDO';
  END IF;
  IF p_km_recorridos IS NULL OR p_km_recorridos < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DISTANCIA_INVALIDA';
  END IF;
  IF p_tamanio IS NULL OR btrim(p_tamanio) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TAMANIO_INVALIDO';
  END IF;
  IF p_metodo_pago IS DISTINCT FROM 'Crédito' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'METODO_PAGO_TARIFA_DIARIA_INVALIDO';
  END IF;
  IF p_cupon_codigo IS NOT NULL AND btrim(p_cupon_codigo) <> '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_NO_PERMITIDO_CORPORATIVO';
  END IF;

  -- 1. Serializa reintentos concurrentes del mismo pedido.
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

  -- 2. usuarios.empresa_codigo es la única fuente de verdad.
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

  -- 3. Resuelve y bloquea la empresa usando tenant + código del usuario.
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
  IF v_empresa.tipo_tarifa IS NULL
     OR lower(btrim(v_empresa.tipo_tarifa)) <> 'diaria' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FLUJO_TARIFA_DIARIA_REQUERIDO';
  END IF;

  /*
   * tarifa_diaria conserva el fallback histórico de 380 cuando es NULL.
   * IVA es obligatorio en Fase 3 porque ahora participa en el cobro real.
   */
  v_tarifa_diaria := COALESCE(v_empresa.tarifa_diaria::NUMERIC, 380);
  v_iva := v_empresa.iva::NUMERIC;

  IF v_empresa.iva IS NULL
     OR v_tarifa_diaria < 0
     OR v_iva < 0
     OR v_iva > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_TARIFA_DIARIA_INVALIDA';
  END IF;

  -- 4. Construye la jornada civil de Ciudad de México como instantes UTC.
  v_fecha_mexico :=
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE;
  v_inicio_dia :=
    v_fecha_mexico::TIMESTAMP AT TIME ZONE 'America/Mexico_City';
  v_fin_dia :=
    (v_fecha_mexico + 1)::TIMESTAMP AT TIME ZONE 'America/Mexico_City';

  /*
   * 5. Serializa la decisión "primer pedido del día" por
   * tenant + empresa + fecha civil de México.
   *
   * Limitación conocida: multiparada diaria sigue en el flujo legado y no
   * participa en este advisory lock. En teoría puede competir con este flujo
   * hasta que multiparada sea migrada en su propia fase.
   */
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat(
        p_tenant_id,
        ':tarifa-diaria:',
        v_empresa.id,
        ':',
        v_fecha_mexico
      ),
      0
    )
  );

  /*
   * Bloquea el pedido que mantiene cubierta la tarifa, si existe, para que
   * una cancelación o cobro administrativo concurrente no cambie su estado
   * durante la decisión y el INSERT.
   */
  SELECT *
  INTO v_pedido_cobertura
  FROM public.pedidos
  WHERE tenant_id = p_tenant_id
    AND empresa_codigo = btrim(v_usuario.empresa_codigo)
    AND metodo_pago = 'Crédito'
    AND estado <> 'Cancelado'
    AND credito_cobrado = FALSE
    AND created_at >= v_inicio_dia
    AND created_at < v_fin_dia
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  v_tarifa_cubierta := FOUND;

  -- VIP y cargo_paquete_grande no participan en tarifa diaria.
  IF v_tarifa_cubierta THEN
    v_base := 0;
  ELSE
    v_base := round(v_tarifa_diaria * (1 + v_iva), 2);
  END IF;

  v_cargo_cancelacion :=
    GREATEST(0, round(COALESCE(v_usuario.cargo_cancelacion, 0)::NUMERIC, 2));

  /*
   * El cargo se valida de forma asimétrica igual que el total:
   * una reducción favorable se acepta; un aumento exige recotizar.
   */
  IF v_cargo_cancelacion >
     round(COALESCE(p_cargo_cancelacion, 0), 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
  END IF;

  v_precio_final := round(v_base + v_cargo_cancelacion, 2);

  /*
   * Validación asimétrica:
   * - si otro request ganó la tarifa y el precio definitivo bajó, se acepta;
   * - si el precio definitivo subió, se exige recotizar para no cobrar más
   *   de lo que el cliente vio.
   */
  IF v_precio_final > round(p_precio_cotizado, 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_DIARIA_CAMBIO';
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
    -- pedidos.precio es BIGINT: redondear antes del INSERT.
    ROUND(v_precio_final)::BIGINT,
    p_estado, p_user_id, p_tenant_id, NULLIF(btrim(p_instrucciones), ''),
    'Crédito', NULLIF(btrim(p_comprobante_pago), ''), NULL,
    p_token_rastreo, btrim(v_usuario.empresa_codigo), v_tarifa_cubierta,
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

COMMENT ON FUNCTION public.crear_pedido_tarifa_diaria_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) IS 'Crea un pedido corporativo simple de tarifa diaria, reserva atómicamente el primer cobro del día de Ciudad de México y consume el cargo pendiente. Solo service_role.';

REVOKE ALL ON FUNCTION public.crear_pedido_tarifa_diaria_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_pedido_tarifa_diaria_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) TO service_role;
