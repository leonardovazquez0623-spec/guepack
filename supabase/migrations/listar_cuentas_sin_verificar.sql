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
    usuario.created_at
  FROM public.usuarios AS usuario
  WHERE EXISTS (
    SELECT 1
    FROM public.usuarios AS administrador
    WHERE administrador.user_id::TEXT = auth.uid()::TEXT
      AND administrador.rol = 'admin'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM auth.users AS usuario_auth
    WHERE usuario_auth.id::TEXT = usuario.user_id::TEXT
      AND usuario_auth.email_confirmed_at IS NOT NULL
  )
  ORDER BY usuario.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_cuentas_sin_verificar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_cuentas_sin_verificar() TO authenticated;
