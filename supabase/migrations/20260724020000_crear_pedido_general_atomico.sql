CREATE OR REPLACE FUNCTION public.crear_pedido_general_atomico(
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
  p_precio_final NUMERIC,
  p_total_antes_cupon NUMERIC,
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
  v_cupon public.cupones%ROWTYPE;
  v_usos_usuario INTEGER := 0;
  v_descuento_cupon NUMERIC := 0;
  v_precio_esperado NUMERIC := 0;
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

  -- Bloquea el perfil para consumir una sola vez el cargo pendiente.
  SELECT *
  INTO v_usuario
  FROM public.usuarios
  WHERE user_id = p_user_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PERFIL_USUARIO_NO_ENCONTRADO';
  END IF;
  IF v_usuario.empresa_codigo IS NOT NULL AND btrim(v_usuario.empresa_codigo) <> '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'FLUJO_CORPORATIVO_NO_PERMITIDO';
  END IF;
  IF round(COALESCE(v_usuario.cargo_cancelacion, 0)::NUMERIC, 2)
     IS DISTINCT FROM round(COALESCE(p_cargo_cancelacion, 0), 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
  END IF;
  IF p_precio_final < 0 OR p_total_antes_cupon < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRECIO_INVALIDO';
  END IF;

  IF p_cupon_codigo IS NOT NULL AND btrim(p_cupon_codigo) <> '' THEN
    -- El bloqueo protege tanto el límite global como el límite por usuario.
    SELECT *
    INTO v_cupon
    FROM public.cupones
    WHERE tenant_id = p_tenant_id
      AND upper(codigo) = upper(btrim(p_cupon_codigo))
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_NO_DISPONIBLE';
    END IF;
    IF v_cupon.fecha_expiracion IS NOT NULL AND v_cupon.fecha_expiracion < CURRENT_DATE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_EXPIRADO';
    END IF;
    IF v_cupon.usos_maximos IS NOT NULL
       AND COALESCE(v_cupon.usos_actuales, 0) >= v_cupon.usos_maximos THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_AGOTADO';
    END IF;

    SELECT COALESCE(usos, 0)
    INTO v_usos_usuario
    FROM public.cupones_usos
    WHERE cupon_id = v_cupon.id
      AND user_id = p_user_id;

    IF v_cupon.usos_por_usuario IS NOT NULL
       AND v_usos_usuario >= v_cupon.usos_por_usuario THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LIMITE_CUPON_USUARIO';
    END IF;

    -- Solo revalida el descuento bloqueado; no recalcula la tarifa.
    IF v_cupon.tipo = 'porcentaje' THEN
      IF v_cupon.descuento < 0 OR v_cupon.descuento > 100 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CUPON_INVALIDA';
      END IF;
      v_descuento_cupon := round(p_total_antes_cupon * v_cupon.descuento / 100, 2);
    ELSIF v_cupon.tipo IN ('fijo', 'monto') THEN
      IF v_cupon.descuento < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CUPON_INVALIDA';
      END IF;
      v_descuento_cupon := LEAST(p_total_antes_cupon, v_cupon.descuento);
    ELSE
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CUPON_INVALIDA';
    END IF;

    v_precio_esperado := GREATEST(0, round(p_total_antes_cupon - v_descuento_cupon, 2));
    IF round(p_precio_final, 2) IS DISTINCT FROM v_precio_esperado THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_CAMBIO_REQUIERE_RECOTIZAR';
    END IF;
  ELSIF round(p_precio_final, 2) IS DISTINCT FROM round(p_total_antes_cupon, 2) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRECIO_SIN_CUPON_INCONSISTENTE';
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
    p_direccion_recoleccion, p_direccion_entrega, p_fecha, p_tamanio, p_zona,
    round(p_precio_final, 2), p_estado, p_user_id, p_tenant_id,
    NULLIF(btrim(p_instrucciones), ''), p_metodo_pago,
    NULLIF(btrim(p_comprobante_pago), ''),
    CASE WHEN p_cupon_codigo IS NULL OR btrim(p_cupon_codigo) = '' THEN NULL
         ELSE upper(btrim(p_cupon_codigo)) END,
    p_token_rastreo, NULL, FALSE, p_km_recorridos, p_lat_recoleccion,
    p_lng_recoleccion, p_lat_entrega, p_lng_entrega,
    round(COALESCE(p_cargo_cancelacion, 0), 2), p_idempotency_key
  )
  RETURNING * INTO v_pedido;

  IF p_cupon_codigo IS NOT NULL AND btrim(p_cupon_codigo) <> '' THEN
    UPDATE public.cupones
    SET usos_actuales = COALESCE(usos_actuales, 0) + 1
    WHERE id = v_cupon.id;

    INSERT INTO public.cupones_usos (cupon_id, user_id, usos)
    VALUES (v_cupon.id, p_user_id, 1)
    ON CONFLICT (cupon_id, user_id)
    DO UPDATE SET usos = public.cupones_usos.usos + 1;
  END IF;

  IF COALESCE(p_cargo_cancelacion, 0) > 0 THEN
    UPDATE public.usuarios
    SET cargo_cancelacion = 0
    WHERE user_id = p_user_id
      AND tenant_id = p_tenant_id;
  END IF;

  RETURN QUERY SELECT to_jsonb(v_pedido), FALSE;
END;
$$;

COMMENT ON FUNCTION public.crear_pedido_general_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) IS 'Crea un pedido general y consume el cupón y cargo pendiente de forma atómica. Solo puede invocarse con service_role.';

REVOKE ALL ON FUNCTION public.crear_pedido_general_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crear_pedido_general_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, NUMERIC,
  NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT
) TO service_role;
