ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS banco_clabe TEXT,
  ADD COLUMN IF NOT EXISTS banco_nombre TEXT,
  ADD COLUMN IF NOT EXISTS banco_titular TEXT;

COMMENT ON COLUMN public.tenants.banco_clabe IS 'CLABE interbancaria de 18 dígitos para recibir transferencias';
COMMENT ON COLUMN public.tenants.banco_nombre IS 'Nombre del banco que recibe las transferencias';
COMMENT ON COLUMN public.tenants.banco_titular IS 'Nombre del titular de la cuenta bancaria';
