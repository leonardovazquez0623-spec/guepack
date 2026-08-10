BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'paqueteria';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_tipo_valido;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_tipo_valido
  CHECK (tipo IN ('paqueteria', 'restaurante'));

COMMENT ON COLUMN public.tenants.tipo IS
  'Tipo de negocio del tenant: paqueteria (splash/flujo actual) o restaurante (splash de bienvenida con menú). Default paqueteria para preservar el comportamiento de tenants existentes.';

CREATE OR REPLACE VIEW public.tenants_publico
WITH (
  security_barrier = true,
  security_invoker = false
)
AS
SELECT
  id,
  nombre,
  slug,
  dominio,
  logo_url,
  color_primario,
  color_secundario,
  whatsapp_soporte,
  activo,
  plan,
  tipo,
  nombre_app,
  ciudad,
  horario_atencion,
  img_bienvenida,
  img_encamino,
  img_recolectado,
  img_transito,
  img_entregado,
  img_soporte
FROM public.tenants
WHERE activo IS TRUE;

REVOKE ALL
ON public.tenants_publico
FROM PUBLIC;

GRANT SELECT
ON public.tenants_publico
TO anon, authenticated;

COMMIT;
