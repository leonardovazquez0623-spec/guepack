-- Fix 2 (motor de asignación): marca explícita para "se agotaron todas las
-- rondas automáticas y nadie tomó el pedido" — sin cancelar el pedido y sin
-- tocar pedidos.estado (admin.html filtra su cola principal con
-- .eq('estado','Pendiente') en varios lugares; cambiar estado lo ocultaría
-- del dashboard en vez de señalarlo).

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS asignacion_agotada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS asignacion_agotada_en timestamptz;
