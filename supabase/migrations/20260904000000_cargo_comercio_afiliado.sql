BEGIN;

ALTER TABLE public.comercios_afiliados
  ADD COLUMN IF NOT EXISTS cargo_servicio_mostrador numeric NULL
    CONSTRAINT comercios_afiliados_cargo_servicio_mostrador_no_negativo
    CHECK (cargo_servicio_mostrador IS NULL OR cargo_servicio_mostrador >= 0);

COMMENT ON COLUMN public.comercios_afiliados.cargo_servicio_mostrador IS
  'Cargo de servicio de mostrador específico de este comercio (puede ser 0 para no cobrar nada). NULL = usa el cargo general del tenant (precios_generales.cargo_servicio_mostrador).';

COMMIT;
