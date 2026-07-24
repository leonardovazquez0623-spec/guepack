BEGIN;

DROP POLICY IF EXISTS "tenants activos publico"
ON public.tenants;

REVOKE SELECT
ON public.tenants
FROM anon;

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

COMMENT ON VIEW public.tenants_publico IS
  'Vista pública ejecutada deliberadamente con permisos del propietario (security_invoker=false). Permite consultar únicamente las columnas proyectadas sin conceder acceso directo a public.tenants ni exponer datos bancarios.';

CREATE OR REPLACE FUNCTION public.obtener_datos_bancarios_tenant()
RETURNS TABLE (
  banco_nombre text,
  banco_clabe text,
  banco_titular text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    t.banco_nombre,
    t.banco_clabe,
    t.banco_titular
  FROM public.usuarios AS u
  INNER JOIN public.tenants AS t
    ON t.id = u.tenant_id
  WHERE u.user_id = auth.uid()::text
    AND t.activo IS TRUE
  LIMIT 1;
$$;

REVOKE ALL
ON FUNCTION public.obtener_datos_bancarios_tenant()
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.obtener_datos_bancarios_tenant()
FROM anon;

GRANT EXECUTE
ON FUNCTION public.obtener_datos_bancarios_tenant()
TO authenticated;

COMMENT ON FUNCTION public.obtener_datos_bancarios_tenant() IS
  'Devuelve únicamente los datos bancarios del tenant del usuario autenticado';

COMMIT;
