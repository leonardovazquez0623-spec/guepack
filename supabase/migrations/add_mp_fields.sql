-- Columnas para integración Mercado Pago en envios_nacionales
-- Ejecutar una sola vez en producción.
ALTER TABLE envios_nacionales
  ADD COLUMN IF NOT EXISTS mp_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS mp_payment_id    TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url     TEXT,
  ADD COLUMN IF NOT EXISTS conekta_checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS pago_verificado_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_generacion_guia TEXT;
