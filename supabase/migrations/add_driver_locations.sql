-- Tabla para tracking en tiempo real del repartidor
CREATE TABLE IF NOT EXISTS driver_locations (
  id         UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id  INTEGER          NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  driver_id  UUID             NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  heading    DOUBLE PRECISION,
  updated_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  -- Un solo registro por pedido para upsert eficiente
  CONSTRAINT driver_locations_pedido_id_key UNIQUE (pedido_id)
);

-- Realtime necesita REPLICA IDENTITY FULL para enviar el row completo en el payload
ALTER TABLE driver_locations REPLICA IDENTITY FULL;

-- Agregar a la publicación de Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE driver_locations;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;

-- El repartidor solo puede insertar/actualizar su propia ubicación
CREATE POLICY "driver_upsert_own_location" ON driver_locations
  FOR ALL
  USING     (auth.uid() = driver_id)
  WITH CHECK (auth.uid() = driver_id);

-- Lectura pública: rastreo.html accede con clave anon sin autenticación del cliente.
-- La seguridad real está en el token_rastreo del pedido (UUID no adivinable),
-- que la app valida antes de mostrar el pedido_id.
CREATE POLICY "public_read_location" ON driver_locations
  FOR SELECT
  TO anon, authenticated
  USING (true);
