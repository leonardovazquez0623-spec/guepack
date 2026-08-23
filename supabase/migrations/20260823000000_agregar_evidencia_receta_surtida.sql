BEGIN;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS foto_receta_surtido text,
  ADD COLUMN IF NOT EXISTS firma_receta_surtido text;

COMMENT ON COLUMN public.pedidos.foto_receta_surtido IS
  'URL de la foto de evidencia (bucket evidencias) que el repartidor sube al confirmar que recibió el medicamento en la farmacia. NULL si receta_subestado nunca llegó a surtido, o si lo marcó admin.html como override manual sin evidencia.';
COMMENT ON COLUMN public.pedidos.firma_receta_surtido IS
  'URL de la firma de evidencia (bucket evidencias) capturada junto con foto_receta_surtido.';

COMMIT;
