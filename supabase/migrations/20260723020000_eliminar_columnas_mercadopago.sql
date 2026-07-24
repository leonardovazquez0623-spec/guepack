BEGIN;

ALTER TABLE public.pedidos
  DROP COLUMN IF EXISTS mercadopago_preference_id;

ALTER TABLE public.envios_nacionales
  DROP COLUMN IF EXISTS mercadopago_preference_id,
  DROP COLUMN IF EXISTS mercadopago_payment_id;

COMMIT;
