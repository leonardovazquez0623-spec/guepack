-- Coordenadas de la dirección de entrega para cálculo de proximidad en tracking
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS lat_entrega DOUBLE PRECISION;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS lng_entrega DOUBLE PRECISION;
