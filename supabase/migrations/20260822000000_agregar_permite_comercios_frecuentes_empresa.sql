BEGIN;

ALTER TABLE public.empresas_afiliadas
  ADD COLUMN IF NOT EXISTS permite_comercios_frecuentes boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.empresas_afiliadas.permite_comercios_frecuentes IS
  'Si es false, los usuarios de esta cuenta corporativa no ven la sección de Comercios frecuentes al crear un pedido. Default true para preservar el comportamiento actual.';

COMMIT;
