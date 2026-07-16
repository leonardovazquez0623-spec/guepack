ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS envio_nacional_id BIGINT REFERENCES envios_nacionales(id);
