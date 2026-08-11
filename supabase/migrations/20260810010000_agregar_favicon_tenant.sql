BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS favicon_url TEXT;

COMMENT ON COLUMN public.tenants.favicon_url IS
  'URL pública del favicon personalizado del tenant.';

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
  img_soporte,
  favicon_url
FROM public.tenants
WHERE activo IS TRUE;

UPDATE public.tenants
SET dominio = lower(btrim(dominio))
WHERE dominio IS DISTINCT FROM lower(btrim(dominio));

COMMIT;
