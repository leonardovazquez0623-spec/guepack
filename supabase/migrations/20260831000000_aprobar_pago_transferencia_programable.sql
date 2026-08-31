BEGIN;

CREATE OR REPLACE FUNCTION public.aprobar_pago_transferencia_programable(
  p_pedido_id BIGINT
)
RETURNS TABLE (
  pedido_id BIGINT,
  pago_verificado BOOLEAN,
  debe_disparar_asignacion BOOLEAN,
  estado_actual TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_reconciliacion RECORD;
BEGIN
  IF p_pedido_id IS NULL THEN
    RAISE EXCEPTION 'PEDIDO_ID_REQUERIDO';
  END IF;

  SELECT p.* INTO v_pedido
  FROM public.pedidos AS p
  WHERE p.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PEDIDO_NO_ENCONTRADO';
  END IF;

  IF NOT public.is_admin_tenant(v_pedido.tenant_id) THEN
    RAISE EXCEPTION 'NO_AUTORIZADO';
  END IF;

  -- Si ya no está pendiente de verificación (otro admin lo aprobó/rechazó
  -- mientras tanto), no hacer nada — admin.html lo interpreta como
  -- "ya no está pendiente" y refresca la lista.
  IF v_pedido.estado <> 'Pendiente verificación de pago'
     OR v_pedido.metodo_pago <> 'transferencia' THEN
    RETURN QUERY SELECT p_pedido_id, FALSE, FALSE, v_pedido.estado;
    RETURN;
  END IF;

  UPDATE public.pedidos
  SET pago_verificado = TRUE
  WHERE id = p_pedido_id;

  -- Reutiliza el motor ya probado: decide si el momento de apertura ya
  -- se alcanzó (pedido normal → sí; programado a futuro → se queda
  -- Programado hasta que el cron lo active más tarde).
  SELECT * INTO v_reconciliacion
  FROM public.reconciliar_activacion_pedido(p_pedido_id);

  RETURN QUERY SELECT
    p_pedido_id,
    TRUE,
    COALESCE(v_reconciliacion.debe_encolar_asignacion, FALSE),
    COALESCE(v_reconciliacion.estado_actual, v_pedido.estado);
END;
$$;

REVOKE ALL ON FUNCTION public.aprobar_pago_transferencia_programable(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprobar_pago_transferencia_programable(BIGINT) TO authenticated;

COMMIT;
