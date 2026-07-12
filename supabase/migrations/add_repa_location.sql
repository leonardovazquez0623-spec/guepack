-- Ubicación GPS del repartidor para tracking en tiempo real desde app cliente.
-- Ejecutar una sola vez (usa IF NOT EXISTS para idempotencia).

ALTER TABLE repartidores
  ADD COLUMN IF NOT EXISTS lat      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS telefono TEXT;

-- Habilitar realtime en repartidores si aún no está activo
-- (esto requiere ejecutarse en el dashboard de Supabase → Table Editor → Realtime)
-- ALTER TABLE repartidores REPLICA IDENTITY FULL;
