CREATE OR REPLACE FUNCTION public.listar_cuentas_sin_verificar()
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
  WHERE EXISTS (
    SELECT 1
    FROM public.usuarios AS administrador
    WHERE administrador.user_id::TEXT = auth.uid()::TEXT
      AND administrador.rol = 'admin'
  )
  AND au.email_confirmed_at IS NULL
  ORDER BY au.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_cuentas_sin_verificar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_cuentas_sin_verificar() TO authenticated;
