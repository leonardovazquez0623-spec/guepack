BEGIN;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS entregado_at timestamptz NULL;

COMMENT ON COLUMN public.pedidos.entregado_at IS
  'Fecha y hora real en que el repartidor marcó el pedido como Entregado (marcar_entregado()). NULL en pedidos entregados antes de este cambio, o que aún no se entregan. Usar esta columna (no created_at) para reportes de facturación/Finanzas.';

COMMIT;
