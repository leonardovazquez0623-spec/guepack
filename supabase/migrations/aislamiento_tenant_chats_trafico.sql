-- Agrega aislamiento por tenant a los eventos y a las cuentas sin verificar.
ALTER TABLE public.eventos_trafico
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES public.tenants(id);

-- Solo se atribuyen eventos antiguos cuando el usuario permite identificar el tenant.
UPDATE public.eventos_trafico AS evento
SET tenant_id = usuario.tenant_id
FROM public.usuarios AS usuario
WHERE evento.tenant_id IS NULL
  AND evento.user_id::TEXT = usuario.user_id::TEXT;

CREATE INDEX IF NOT EXISTS eventos_trafico_tenant_id_idx
  ON public.eventos_trafico (tenant_id);

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
  WHERE au.email_confirmed_at IS NULL
    AND (p_tenant_id IS NULL OR usuario.tenant_id = p_tenant_id)
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
  ORDER BY au.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.listar_cuentas_sin_verificar(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_cuentas_sin_verificar(BIGINT) TO authenticated;
