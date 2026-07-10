-- Guardar coordenadas al crear pedidos (Places ya regresa lat/lng, sin llamada extra a Geocoding)
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS lat_recoleccion DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng_recoleccion DOUBLE PRECISION;

-- paradas: cada parada intermediaria también guarda sus coordenadas
ALTER TABLE paradas
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
