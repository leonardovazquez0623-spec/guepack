ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS mercadopago_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url              TEXT;
