DROP FUNCTION IF EXISTS public.listar_cuentas_sin_verificar();

CREATE OR REPLACE FUNCTION public.listar_cuentas_sin_verificar(p_tenant_id BIGINT)
RETURNS TABLE (
  user_id TEXT,
  email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    usuario.user_id::TEXT,
    usuario.email,
    au.created_at
  FROM public.usuarios AS usuario
  INNER JOIN auth.users AS au
    ON au.id::TEXT = usuario.user_id::TEXT
  WHERE (p_tenant_id IS NULL OR usuario.tenant_id = p_tenant_id)
  AND EXISTS (
    SELECT 1
    FROM public.usuarios AS administrador
    WHERE administrador.user_id::TEXT = auth.uid()::TEXT
      AND administrador.rol = 'admin'
      AND (
        administrador.es_superadmin IS TRUE
        OR (
          p_tenant_id IS NOT NULL
          AND administrador.tenant_id = p_tenant_id
        )
      )
  )
  AND au.email_confirmed_at IS NULL
  ORDER BY au.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_cuentas_sin_verificar(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_cuentas_sin_verificar(BIGINT) TO authenticated;
