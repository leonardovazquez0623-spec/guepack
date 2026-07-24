-- Control de deduplicación de notificaciones públicas de rastreo.
CREATE TABLE IF NOT EXISTS public.notificaciones_rastreo_log (
  pedido_id BIGINT NOT NULL
    REFERENCES public.pedidos(id)
    ON DELETE CASCADE,
  estado TEXT NOT NULL,
  ultimo_envio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (pedido_id, estado),
  CONSTRAINT notificaciones_rastreo_log_estado_no_vacio
    CHECK (LENGTH(BTRIM(estado)) > 0)
);

ALTER TABLE public.notificaciones_rastreo_log
  ENABLE ROW LEVEL SECURITY;

-- Sin políticas públicas: solo service_role puede utilizar esta tabla.
REVOKE ALL
  ON TABLE public.notificaciones_rastreo_log
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reservar_notificacion_rastreo(
  p_pedido_id BIGINT,
  p_estado TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  reserva_realizada BOOLEAN := FALSE;
BEGIN
  IF p_pedido_id IS NULL OR p_pedido_id <= 0 THEN
    RETURN FALSE;
  END IF;

  IF p_estado IS NULL OR LENGTH(BTRIM(p_estado)) = 0 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.notificaciones_rastreo_log (
    pedido_id,
    estado,
    ultimo_envio
  )
  VALUES (
    p_pedido_id,
    BTRIM(p_estado),
    NOW()
  )
  ON CONFLICT (pedido_id, estado)
  DO UPDATE
    SET ultimo_envio = NOW()
    WHERE
      public.notificaciones_rastreo_log.ultimo_envio
      <= NOW() - INTERVAL '60 seconds'
  RETURNING TRUE
  INTO reserva_realizada;

  RETURN COALESCE(reserva_realizada, FALSE);
END;
$$;

REVOKE ALL
  ON FUNCTION public.reservar_notificacion_rastreo(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.reservar_notificacion_rastreo(BIGINT, TEXT)
  TO service_role;

COMMENT ON TABLE public.notificaciones_rastreo_log IS
  'Control de deduplicación de notificaciones públicas de rastreo.';

COMMENT ON FUNCTION public.reservar_notificacion_rastreo(BIGINT, TEXT) IS
  'Reserva atómicamente una notificación por pedido y estado durante 60 segundos.';
