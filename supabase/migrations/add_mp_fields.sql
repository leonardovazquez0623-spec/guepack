-- Integración Mercado Pago + columnas auxiliares de pago para envios_nacionales.
-- Ejecutar una sola vez en producción (usa IF NOT EXISTS para idempotencia).

INSERT INTO config_app (key, value)
VALUES ('proveedor_pago_activo', 'mercadopago')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

ALTER TABLE envios_nacionales
  ADD COLUMN IF NOT EXISTS mercadopago_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS mercadopago_payment_id    TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url              TEXT,
  ADD COLUMN IF NOT EXISTS conekta_checkout_id       TEXT,
  ADD COLUMN IF NOT EXISTS pago_verificado_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_generacion_guia     TEXT;
