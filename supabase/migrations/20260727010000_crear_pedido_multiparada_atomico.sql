CREATE OR REPLACE FUNCTION public.guepack_punto_en_poligono(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_coordenadas JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total INTEGER;
  v_i INTEGER;
  v_j INTEGER;
  v_xi DOUBLE PRECISION;
  v_yi DOUBLE PRECISION;
  v_xj DOUBLE PRECISION;
  v_yj DOUBLE PRECISION;
  v_dentro BOOLEAN := FALSE;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180
     OR p_coordenadas IS NULL
     OR jsonb_typeof(p_coordenadas) <> 'array' THEN
    RETURN FALSE;
  END IF;
  v_total := jsonb_array_length(p_coordenadas);
  IF v_total < 3 THEN RETURN FALSE; END IF;
  v_j := v_total - 1;
  FOR v_i IN 0..v_total - 1 LOOP
    BEGIN
      v_xi := (p_coordenadas -> v_i ->> 'lng')::DOUBLE PRECISION;
      v_yi := (p_coordenadas -> v_i ->> 'lat')::DOUBLE PRECISION;
      v_xj := (p_coordenadas -> v_j ->> 'lng')::DOUBLE PRECISION;
      v_yj := (p_coordenadas -> v_j ->> 'lat')::DOUBLE PRECISION;
    EXCEPTION WHEN OTHERS THEN
      RETURN FALSE;
    END;
    IF v_xi IS NULL OR v_yi IS NULL OR v_xj IS NULL OR v_yj IS NULL THEN
      RETURN FALSE;
    END IF;
    IF ((v_yi > p_lat) <> (v_yj > p_lat))
       AND p_lng < (v_xj - v_xi) * (p_lat - v_yi)
         / NULLIF(v_yj - v_yi, 0) + v_xi THEN
      v_dentro := NOT v_dentro;
    END IF;
    v_j := v_i;
  END LOOP;
  RETURN v_dentro;
END;
$$;

REVOKE ALL ON FUNCTION public.guepack_punto_en_poligono(
  DOUBLE PRECISION, DOUBLE PRECISION, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guepack_punto_en_poligono(
  DOUBLE PRECISION, DOUBLE PRECISION, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.crear_pedido_multiparada_atomico(
  p_user_id TEXT,
  p_tenant_id BIGINT,
  p_idempotency_key TEXT,
  p_nombre TEXT,
  p_nombre_remitente TEXT,
  p_whatsapp TEXT,
  p_direccion_recoleccion TEXT,
  p_fecha DATE,
  p_tamanio TEXT,
  p_precio_cotizado NUMERIC,
  p_estado TEXT,
  p_instrucciones TEXT,
  p_metodo_pago TEXT,
  p_comprobante_pago TEXT,
  p_token_rastreo TEXT,
  p_km_recorridos NUMERIC,
  p_lat_recoleccion DOUBLE PRECISION,
  p_lng_recoleccion DOUBLE PRECISION,
  p_cargo_cancelacion NUMERIC,
  p_cupon_codigo TEXT,
  p_paradas JSONB
)
RETURNS TABLE (pedido JSONB, paradas JSONB, es_recuperacion BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_usuario public.usuarios%ROWTYPE;
  v_empresa public.empresas_afiliadas%ROWTYPE;
  v_zona public.zonas_cobertura%ROWTYPE;
  v_limite_ciudad public.zonas_cobertura%ROWTYPE;
  v_precios_generales public.precios_generales%ROWTYPE;
  v_cupon public.cupones%ROWTYPE;
  v_pedido_cobertura public.pedidos%ROWTYPE;
  v_elemento JSONB;
  v_indice BIGINT;
  v_total_paradas INTEGER;
  v_orden INTEGER;
  v_direccion TEXT;
  v_instrucciones_parada TEXT;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_lat_anterior DOUBLE PRECISION;
  v_lng_anterior DOUBLE PRECISION;
  v_lat_ultima DOUBLE PRECISION;
  v_lng_ultima DOUBLE PRECISION;
  v_direccion_entrega TEXT;
  v_haversine_total DOUBLE PRECISION := 0;
  v_diferencia_lat DOUBLE PRECISION;
  v_diferencia_lng DOUBLE PRECISION;
  v_a DOUBLE PRECISION;
  v_es_corporativo BOOLEAN := FALSE;
  v_es_tarifa_diaria BOOLEAN := FALSE;
  v_tarifa_cubierta BOOLEAN := FALSE;
  v_fecha_mexico DATE;
  v_inicio_dia TIMESTAMPTZ;
  v_fin_dia TIMESTAMPTZ;
  v_precio_base NUMERIC := 0;
  v_precio_por_km NUMERIC;
  v_cargo_paradas NUMERIC := 0;
  v_cargo_paquete_grande NUMERIC := 0;
  v_cargo_cancelacion NUMERIC := 0;
  v_subtotal NUMERIC := 0;
  v_iva NUMERIC := 0;
  v_iva_calculado NUMERIC := 0;
  v_total_antes_cupon NUMERIC := 0;
  v_descuento_cupon NUMERIC := 0;
  v_precio_final NUMERIC := 0;
  v_tarifa_km NUMERIC;
  v_tarifa_minima NUMERIC;
  v_km_minimo NUMERIC;
  v_tarifa_base_extra NUMERIC;
  v_tarifa_diaria NUMERIC;
  v_rango RECORD;
  v_hay_rangos BOOLEAN := FALSE;
  v_rango_encontrado BOOLEAN := FALSE;
  v_rango_desde NUMERIC;
  v_rango_hasta NUMERIC;
  v_rango_precio NUMERIC;
  v_usos_usuario INTEGER := 0;
  v_paradas_resultado JSONB;
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
  IF p_km_recorridos IS NULL OR p_km_recorridos < 0 OR p_km_recorridos > 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DISTANCIA_INVALIDA';
  END IF;
  IF p_precio_cotizado IS NULL OR p_precio_cotizado < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PRECIO_INVALIDO';
  END IF;
  IF p_tamanio IS NULL OR lower(btrim(p_tamanio)) NOT IN ('sobre', 'grande') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TAMANIO_INVALIDO';
  END IF;
  IF p_lat_recoleccion IS NULL OR p_lat_recoleccion < -90 OR p_lat_recoleccion > 90
     OR p_lng_recoleccion IS NULL OR p_lng_recoleccion < -180 OR p_lng_recoleccion > 180 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARADAS_INVALIDAS';
  END IF;
  IF p_paradas IS NULL OR jsonb_typeof(p_paradas) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARADAS_INVALIDAS';
  END IF;
  v_total_paradas := jsonb_array_length(p_paradas);
  IF v_total_paradas < 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARADAS_INVALIDAS';
  END IF;
  IF v_total_paradas > 8 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MAXIMO_PARADAS_EXCEDIDO';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  SELECT * INTO v_pedido FROM public.pedidos
  WHERE idempotency_key = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF v_pedido.user_id IS DISTINCT FROM p_user_id
       OR v_pedido.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CLAVE_IDEMPOTENCIA_EN_USO';
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.orden), '[]'::JSONB)
    INTO v_paradas_resultado FROM public.paradas AS p
    WHERE p.pedido_id = v_pedido.id;
    RETURN QUERY SELECT to_jsonb(v_pedido), v_paradas_resultado, TRUE;
    RETURN;
  END IF;

  SELECT * INTO v_usuario FROM public.usuarios
  WHERE user_id = p_user_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PERFIL_USUARIO_NO_ENCONTRADO';
  END IF;
  v_es_corporativo := v_usuario.empresa_codigo IS NOT NULL
    AND btrim(v_usuario.empresa_codigo) <> '';
  IF v_es_corporativo THEN
    IF p_cupon_codigo IS NOT NULL AND btrim(p_cupon_codigo) <> '' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_NO_PERMITIDO_CORPORATIVO';
    END IF;
    SELECT * INTO v_empresa FROM public.empresas_afiliadas
    WHERE tenant_id = p_tenant_id
      AND codigo = btrim(v_usuario.empresa_codigo)
    LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPRESA_CORPORATIVA_NO_ENCONTRADA';
    END IF;
    IF v_empresa.activa IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPRESA_CORPORATIVA_INACTIVA';
    END IF;
    IF v_empresa.tipo_tarifa IS NULL OR btrim(v_empresa.tipo_tarifa) = '' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
    END IF;
    v_es_tarifa_diaria := lower(btrim(v_empresa.tipo_tarifa)) = 'diaria';
  ELSIF p_metodo_pago = 'Crédito' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'METODO_PAGO_INVALIDO';
  END IF;

  v_lat_anterior := p_lat_recoleccion;
  v_lng_anterior := p_lng_recoleccion;
  FOR v_elemento, v_indice IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_paradas) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_elemento) <> 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARADAS_INVALIDAS';
    END IF;
    BEGIN
      v_orden := (v_elemento ->> 'orden')::INTEGER;
      v_lat := (v_elemento ->> 'lat')::DOUBLE PRECISION;
      v_lng := (v_elemento ->> 'lng')::DOUBLE PRECISION;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARADAS_INVALIDAS';
    END;
    v_direccion := btrim(COALESCE(v_elemento ->> 'direccion', ''));
    v_instrucciones_parada := NULLIF(
      btrim(COALESCE(v_elemento ->> 'instrucciones', '')), ''
    );
    IF v_orden IS DISTINCT FROM v_indice::INTEGER OR v_direccion = ''
       OR char_length(v_direccion) > 300
       OR (v_instrucciones_parada IS NOT NULL
           AND char_length(v_instrucciones_parada) > 500)
       OR v_lat IS NULL OR v_lat < -90 OR v_lat > 90
       OR v_lng IS NULL OR v_lng < -180 OR v_lng > 180 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PARADAS_INVALIDAS';
    END IF;
    IF v_indice = 1 THEN v_direccion_entrega := v_direccion; END IF;
    v_diferencia_lat := radians(v_lat - v_lat_anterior);
    v_diferencia_lng := radians(v_lng - v_lng_anterior);
    v_a := power(sin(v_diferencia_lat / 2), 2)
      + cos(radians(v_lat_anterior)) * cos(radians(v_lat))
      * power(sin(v_diferencia_lng / 2), 2);
    v_haversine_total := v_haversine_total + 6371 * 2 * atan2(
      sqrt(GREATEST(0, v_a)), sqrt(GREATEST(0, 1 - v_a))
    );
    v_lat_anterior := v_lat;
    v_lng_anterior := v_lng;
    v_lat_ultima := v_lat;
    v_lng_ultima := v_lng;
  END LOOP;
  IF v_haversine_total < 0.05 THEN
    IF p_km_recorridos > 0.5 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DISTANCIA_MULTIPARADA_CAMBIO';
    END IF;
  ELSIF p_km_recorridos < v_haversine_total * 0.9
     OR p_km_recorridos > v_haversine_total * 2.5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'DISTANCIA_MULTIPARADA_CAMBIO';
  END IF;

  IF v_es_corporativo THEN
    SELECT * INTO v_limite_ciudad FROM public.zonas_cobertura
    WHERE tenant_id = p_tenant_id AND activa = TRUE
      AND upper(btrim(nombre)) = 'LIMITE CIUDAD'
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LIMITE_CIUDAD_NO_CONFIGURADO';
    END IF;
    IF NOT public.guepack_punto_en_poligono(
      v_lat_ultima, v_lng_ultima, v_limite_ciudad.coordenadas::JSONB
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ULTIMA_PARADA_FUERA_LIMITE_CIUDAD';
    END IF;
  ELSE
    SELECT * INTO v_zona FROM public.zonas_cobertura
    WHERE tenant_id = p_tenant_id AND activa = TRUE
      AND upper(btrim(nombre)) <> 'LIMITE CIUDAD'
      AND public.guepack_punto_en_poligono(
        v_lat_ultima, v_lng_ultima, coordenadas::JSONB
      )
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ZONA_ULTIMA_PARADA_NO_DISPONIBLE';
    END IF;
  END IF;
  v_cargo_cancelacion := GREATEST(
    0, round(COALESCE(v_usuario.cargo_cancelacion, 0)::NUMERIC, 2)
  );

  IF NOT v_es_corporativo THEN
    v_precio_base := CASE WHEN lower(btrim(p_tamanio)) = 'sobre'
      THEN v_zona.precio_sobre::NUMERIC ELSE v_zona.precio_grande::NUMERIC END;
    v_precio_por_km := CASE WHEN v_zona.precio_por_km IS NULL THEN NULL
      ELSE v_zona.precio_por_km::NUMERIC END;
    IF v_precio_base IS NULL OR v_precio_base < 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_ZONA_INVALIDA';
    END IF;
    IF v_precio_por_km IS NOT NULL AND v_precio_por_km > 0 THEN
      v_subtotal := round(v_precio_base + p_km_recorridos * v_precio_por_km, 2);
    ELSE
      v_cargo_paradas := (v_total_paradas - 1) * 30;
      v_subtotal := round(v_precio_base + v_cargo_paradas, 2);
    END IF;
    IF lower(btrim(p_tamanio)) = 'grande' THEN
      SELECT * INTO v_precios_generales FROM public.precios_generales
      WHERE tenant_id = p_tenant_id LIMIT 1 FOR UPDATE;
      IF NOT FOUND OR v_precios_generales.cargo_paquete_grande IS NULL
         OR v_precios_generales.cargo_paquete_grande < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CARGO_GRANDE_INVALIDA';
      END IF;
      v_cargo_paquete_grande := v_precios_generales.cargo_paquete_grande::NUMERIC;
    END IF;
    IF v_cargo_cancelacion IS DISTINCT FROM
       GREATEST(0, round(COALESCE(p_cargo_cancelacion, 0), 2)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
    END IF;
    v_total_antes_cupon := round(
      v_subtotal + v_cargo_paquete_grande + v_cargo_cancelacion, 2
    );
    IF p_cupon_codigo IS NOT NULL AND btrim(p_cupon_codigo) <> '' THEN
      SELECT * INTO v_cupon FROM public.cupones
      WHERE tenant_id = p_tenant_id
        AND upper(codigo) = upper(btrim(p_cupon_codigo))
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_NO_DISPONIBLE';
      END IF;
      IF v_cupon.fecha_expiracion IS NOT NULL
         AND v_cupon.fecha_expiracion < CURRENT_DATE THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_EXPIRADO';
      END IF;
      IF v_cupon.usos_maximos IS NOT NULL
         AND COALESCE(v_cupon.usos_actuales, 0) >= v_cupon.usos_maximos THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CUPON_AGOTADO';
      END IF;
      SELECT COALESCE(usos, 0) INTO v_usos_usuario
      FROM public.cupones_usos
      WHERE cupon_id = v_cupon.id AND user_id = p_user_id;
      IF v_cupon.usos_por_usuario IS NOT NULL
         AND v_usos_usuario >= v_cupon.usos_por_usuario THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LIMITE_CUPON_USUARIO';
      END IF;
      IF v_cupon.tipo = 'porcentaje' THEN
        IF v_cupon.descuento < 0 OR v_cupon.descuento > 100 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CUPON_INVALIDA';
        END IF;
        v_descuento_cupon := round(v_total_antes_cupon * v_cupon.descuento / 100, 2);
      ELSIF v_cupon.tipo IN ('fijo', 'monto') THEN
        IF v_cupon.descuento < 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CUPON_INVALIDA';
        END IF;
        v_descuento_cupon := LEAST(v_total_antes_cupon, v_cupon.descuento);
      ELSE
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CUPON_INVALIDA';
      END IF;
    END IF;
    v_precio_final := GREATEST(
      0, round(v_total_antes_cupon - v_descuento_cupon, 2)
    );
    IF round(p_precio_cotizado, 2) IS DISTINCT FROM v_precio_final THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_MULTIPARADA_CAMBIO';
    END IF;
  ELSIF v_es_tarifa_diaria THEN
    IF p_metodo_pago IS DISTINCT FROM 'Crédito' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'METODO_PAGO_TARIFA_DIARIA_INVALIDO';
    END IF;
    v_tarifa_diaria := COALESCE(v_empresa.tarifa_diaria::NUMERIC, 380);
    v_iva := v_empresa.iva::NUMERIC;
    IF v_empresa.iva IS NULL OR v_tarifa_diaria < 0 OR v_iva < 0 OR v_iva > 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_TARIFA_DIARIA_INVALIDA';
    END IF;
    v_fecha_mexico := (CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::DATE;
    v_inicio_dia := v_fecha_mexico::TIMESTAMP AT TIME ZONE 'America/Mexico_City';
    v_fin_dia := (v_fecha_mexico + 1)::TIMESTAMP AT TIME ZONE 'America/Mexico_City';
    PERFORM pg_advisory_xact_lock(hashtextextended(concat(
      p_tenant_id, ':tarifa-diaria:', v_empresa.id, ':', v_fecha_mexico
    ), 0));
    SELECT * INTO v_pedido_cobertura FROM public.pedidos
    WHERE tenant_id = p_tenant_id
      AND empresa_codigo = btrim(v_usuario.empresa_codigo)
      AND metodo_pago = 'Crédito' AND estado <> 'Cancelado'
      AND credito_cobrado = FALSE
      AND created_at >= v_inicio_dia AND created_at < v_fin_dia
    ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    v_tarifa_cubierta := FOUND;
    v_subtotal := CASE WHEN v_tarifa_cubierta THEN 0
      ELSE round(v_tarifa_diaria * (1 + v_iva), 2) END;
    IF v_cargo_cancelacion >
       GREATEST(0, round(COALESCE(p_cargo_cancelacion, 0), 2)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
    END IF;
    v_precio_final := round(v_subtotal + v_cargo_cancelacion, 2);
    IF v_precio_final > round(p_precio_cotizado, 2) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_DIARIA_CAMBIO';
    END IF;
  ELSE
    IF v_empresa.tarifa_km IS NULL OR v_empresa.tarifa_minima IS NULL
       OR v_empresa.km_minimo IS NULL OR v_empresa.tarifa_base_extra IS NULL
       OR v_empresa.iva IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
    END IF;
    v_tarifa_km := v_empresa.tarifa_km::NUMERIC;
    v_tarifa_minima := v_empresa.tarifa_minima::NUMERIC;
    v_km_minimo := v_empresa.km_minimo::NUMERIC;
    v_tarifa_base_extra := v_empresa.tarifa_base_extra::NUMERIC;
    v_iva := v_empresa.iva::NUMERIC;
    IF v_tarifa_km < 0 OR v_tarifa_minima < 0 OR v_km_minimo < 0
       OR v_tarifa_base_extra < 0 OR v_iva < 0 OR v_iva > 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
    END IF;
    IF lower(btrim(p_tamanio)) = 'grande' THEN
      IF v_empresa.cargo_paquete_grande IS NOT NULL THEN
        v_cargo_paquete_grande := v_empresa.cargo_paquete_grande::NUMERIC;
        IF v_cargo_paquete_grande < 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CORPORATIVA_INVALIDA';
        END IF;
      ELSE
        SELECT * INTO v_precios_generales FROM public.precios_generales
        WHERE tenant_id = p_tenant_id LIMIT 1 FOR UPDATE;
        IF NOT FOUND OR v_precios_generales.cargo_paquete_grande IS NULL
           OR v_precios_generales.cargo_paquete_grande < 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_CARGO_GRANDE_INVALIDA';
        END IF;
        v_cargo_paquete_grande := v_precios_generales.cargo_paquete_grande::NUMERIC;
      END IF;
    END IF;
    FOR v_rango IN SELECT km_desde, km_hasta, precio
      FROM public.rangos_precio_empresa WHERE empresa_id = v_empresa.id
      ORDER BY km_desde FOR UPDATE
    LOOP
      v_hay_rangos := TRUE;
      IF v_rango.km_desde IS NULL OR v_rango.precio IS NULL
         OR v_rango.km_desde::NUMERIC < 0 OR v_rango.precio::NUMERIC < 0
         OR (v_rango.km_hasta IS NOT NULL
             AND (v_rango.km_hasta::NUMERIC < 0
                  OR v_rango.km_hasta::NUMERIC < v_rango.km_desde::NUMERIC)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CONFIGURACION_RANGOS_EMPRESA_INVALIDA';
      END IF;
      IF NOT v_rango_encontrado THEN
        v_rango_desde := v_rango.km_desde::NUMERIC;
        v_rango_hasta := CASE WHEN v_rango.km_hasta IS NULL THEN NULL
          ELSE v_rango.km_hasta::NUMERIC END;
        v_rango_precio := v_rango.precio::NUMERIC;
        IF p_km_recorridos >= v_rango.km_desde::NUMERIC
           AND (v_rango.km_hasta IS NULL
                OR p_km_recorridos <= v_rango.km_hasta::NUMERIC) THEN
          v_rango_encontrado := TRUE;
        END IF;
      END IF;
    END LOOP;
    IF v_hay_rangos THEN
      -- Conserva la particularidad del último rango cerrado de Fase 2.
      v_precio_base := v_rango_precio;
      IF v_rango_hasta IS NULL AND p_km_recorridos > v_rango_desde THEN
        v_precio_base := v_precio_base
          + round(p_km_recorridos - v_rango_desde, 1) * v_tarifa_km;
      END IF;
    ELSIF p_km_recorridos <= v_km_minimo THEN
      v_precio_base := v_tarifa_minima;
    ELSE
      v_precio_base := v_tarifa_base_extra
        + v_tarifa_km * (p_km_recorridos - v_km_minimo);
    END IF;
    v_subtotal := round(v_precio_base + v_cargo_paquete_grande, 2);
    v_iva_calculado := round(v_subtotal * v_iva, 2);
    IF v_cargo_cancelacion IS DISTINCT FROM
       GREATEST(0, round(COALESCE(p_cargo_cancelacion, 0), 2)) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CARGO_CANCELACION_CAMBIO';
    END IF;
    v_precio_final := round(
      v_subtotal + v_iva_calculado + v_cargo_cancelacion, 2
    );
    IF round(p_precio_cotizado, 2) IS DISTINCT FROM v_precio_final THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TARIFA_CORPORATIVA_CAMBIO';
    END IF;
  END IF;

  INSERT INTO public.pedidos (
    nombre, nombre_remitente, whatsapp, direccion_recoleccion, direccion_entrega,
    fecha, tamanio, zona, precio, estado, user_id, tenant_id, instrucciones,
    metodo_pago, comprobante_pago, cupon_codigo, token_rastreo, empresa_codigo,
    es_tarifa_adicional, km_recorridos, lat_recoleccion, lng_recoleccion,
    lat_entrega, lng_entrega, cargo_cancelacion, idempotency_key
  ) VALUES (
    p_nombre, NULLIF(btrim(p_nombre_remitente), ''), p_whatsapp,
    p_direccion_recoleccion, v_direccion_entrega, p_fecha,
    lower(btrim(p_tamanio)),
    CASE WHEN v_es_tarifa_diaria THEN 'Corporativo · Tarifa diaria'
      WHEN v_es_corporativo THEN 'Corporativo' ELSE v_zona.nombre END
      || ' · ' || round(p_km_recorridos, 1)
      || ' km · ' || v_total_paradas || ' paradas',
    ROUND(v_precio_final)::BIGINT, p_estado, p_user_id, p_tenant_id,
    NULLIF(btrim(p_instrucciones), ''), p_metodo_pago,
    NULLIF(btrim(p_comprobante_pago), ''),
    CASE WHEN v_es_corporativo OR p_cupon_codigo IS NULL
      OR btrim(p_cupon_codigo) = '' THEN NULL
      ELSE upper(btrim(p_cupon_codigo)) END,
    p_token_rastreo,
    CASE WHEN v_es_corporativo THEN btrim(v_usuario.empresa_codigo) ELSE NULL END,
    v_es_tarifa_diaria AND v_tarifa_cubierta,
    round(p_km_recorridos, 1), p_lat_recoleccion, p_lng_recoleccion,
    (p_paradas -> 0 ->> 'lat')::DOUBLE PRECISION,
    (p_paradas -> 0 ->> 'lng')::DOUBLE PRECISION,
    v_cargo_cancelacion, p_idempotency_key
  ) RETURNING * INTO v_pedido;

  INSERT INTO public.paradas (
    pedido_id, orden, direccion, instrucciones, estado, lat, lng
  )
  SELECT v_pedido.id, (p.elemento ->> 'orden')::INTEGER,
    btrim(p.elemento ->> 'direccion'),
    NULLIF(btrim(COALESCE(p.elemento ->> 'instrucciones', '')), ''),
    'pendiente', (p.elemento ->> 'lat')::DOUBLE PRECISION,
    (p.elemento ->> 'lng')::DOUBLE PRECISION
  FROM jsonb_array_elements(p_paradas) AS p(elemento)
  ORDER BY (p.elemento ->> 'orden')::INTEGER;

  IF NOT v_es_corporativo AND p_cupon_codigo IS NOT NULL
     AND btrim(p_cupon_codigo) <> '' THEN
    UPDATE public.cupones SET usos_actuales = COALESCE(usos_actuales, 0) + 1
    WHERE id = v_cupon.id;
    INSERT INTO public.cupones_usos (cupon_id, user_id, usos)
    VALUES (v_cupon.id, p_user_id, 1)
    ON CONFLICT (cupon_id, user_id)
    DO UPDATE SET usos = public.cupones_usos.usos + 1;
  END IF;
  IF v_cargo_cancelacion > 0 THEN
    UPDATE public.usuarios SET cargo_cancelacion = 0
    WHERE user_id = p_user_id AND tenant_id = p_tenant_id;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.orden), '[]'::JSONB)
  INTO v_paradas_resultado FROM public.paradas AS p
  WHERE p.pedido_id = v_pedido.id;
  RETURN QUERY SELECT to_jsonb(v_pedido), v_paradas_resultado, FALSE;
END;
$$;

COMMENT ON FUNCTION public.crear_pedido_multiparada_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, NUMERIC, TEXT,
  TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  NUMERIC, TEXT, JSONB
) IS 'Crea atómicamente un pedido multiparada normal o corporativo, valida cobertura, recalcula el precio e inserta todas sus paradas. Solo service_role.';
REVOKE ALL ON FUNCTION public.crear_pedido_multiparada_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, NUMERIC, TEXT,
  TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  NUMERIC, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_pedido_multiparada_atomico(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, NUMERIC, TEXT,
  TEXT, TEXT, TEXT, TEXT, NUMERIC, DOUBLE PRECISION, DOUBLE PRECISION,
  NUMERIC, TEXT, JSONB
) TO service_role;
