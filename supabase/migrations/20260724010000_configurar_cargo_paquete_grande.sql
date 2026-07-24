ALTER TABLE public.precios_generales
  ADD COLUMN IF NOT EXISTS cargo_paquete_grande NUMERIC NOT NULL DEFAULT 30;

ALTER TABLE public.empresas_afiliadas
  ADD COLUMN IF NOT EXISTS cargo_paquete_grande NUMERIC NULL;

ALTER TABLE public.precios_generales
  DROP CONSTRAINT IF EXISTS precios_generales_cargo_paquete_grande_no_negativo;

ALTER TABLE public.precios_generales
  ADD CONSTRAINT precios_generales_cargo_paquete_grande_no_negativo
  CHECK (cargo_paquete_grande >= 0);

ALTER TABLE public.empresas_afiliadas
  DROP CONSTRAINT IF EXISTS empresas_afiliadas_cargo_paquete_grande_no_negativo;

ALTER TABLE public.empresas_afiliadas
  ADD CONSTRAINT empresas_afiliadas_cargo_paquete_grande_no_negativo
  CHECK (cargo_paquete_grande IS NULL OR cargo_paquete_grande >= 0);

COMMENT ON COLUMN public.precios_generales.cargo_paquete_grande IS
  'Recargo general vigente para cotizaciones nuevas de paquetes grandes.';

COMMENT ON COLUMN public.empresas_afiliadas.cargo_paquete_grande IS
  'Recargo opcional de la empresa; NULL hereda el valor de precios_generales.';
