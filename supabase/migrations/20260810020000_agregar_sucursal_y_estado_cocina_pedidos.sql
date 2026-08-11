BEGIN;

-- pedidos.estado_cocina ya existe en producción (agregada anteriormente sin
-- llegar a usarse desde ningún código). Este cambio la formaliza: valores
-- válidos, default para nuevas órdenes y un índice para el tablero Kanban
-- de cocina.html. No se agrega la columna porque ya existe.

ALTER TABLE public.pedidos
  ALTER COLUMN estado_cocina SET DEFAULT 'nuevo';

ALTER TABLE public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_estado_cocina_valido;

ALTER TABLE public.pedidos
  ADD CONSTRAINT pedidos_estado_cocina_valido
  CHECK (estado_cocina IS NULL OR estado_cocina IN ('nuevo', 'en_preparacion', 'listo', 'en_camino'));

COMMENT ON COLUMN public.pedidos.estado_cocina IS
  'Estado del pedido en el flujo de cocina (tenants tipo restaurante): nuevo → en_preparacion → listo → en_camino. NULL para pedidos que no pasan por cocina (paquetería).';

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS sucursal_id integer NULL;

COMMENT ON COLUMN public.pedidos.sucursal_id IS
  'Sucursal de origen del pedido (menu.html). NULL en pedidos de paquetería creados antes de este cambio o fuera del flujo de menú.';

CREATE INDEX IF NOT EXISTS idx_pedidos_cocina
  ON public.pedidos (tenant_id, sucursal_id, estado_cocina)
  WHERE estado_cocina IS NOT NULL;

COMMIT;
