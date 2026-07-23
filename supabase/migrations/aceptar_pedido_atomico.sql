CREATE OR REPLACE FUNCTION public.aceptar_pedido_atomico(
  p_pedido_id BIGINT,
  p_repartidor_nombre TEXT,
  p_ganancia_repartidor NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  filas_afectadas INTEGER;
BEGIN
  UPDATE public.pedidos
  SET
    repartidor = p_repartidor_nombre,
    asignacion_automatica = TRUE,
    ganancia_repartidor = p_ganancia_repartidor
  WHERE id = p_pedido_id
    AND repartidor IS NULL;

  GET DIAGNOSTICS filas_afectadas = ROW_COUNT;
  RETURN filas_afectadas;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aceptar_pedido_atomico(
  BIGINT,
  TEXT,
  NUMERIC
) TO authenticated;
