BEGIN;

ALTER TABLE public.precios_generales
  ADD COLUMN IF NOT EXISTS radio_maximo_km numeric NULL;

ALTER TABLE public.precios_generales
  DROP CONSTRAINT IF EXISTS precios_generales_radio_maximo_km_valido;

ALTER TABLE public.precios_generales
  ADD CONSTRAINT precios_generales_radio_maximo_km_valido
  CHECK (radio_maximo_km IS NULL OR radio_maximo_km > 0);

COMMENT ON COLUMN public.precios_generales.radio_maximo_km IS
  'Radio máximo de entrega en km desde la sucursal/origen. NULL = sin límite (comportamiento actual).';

COMMIT;
