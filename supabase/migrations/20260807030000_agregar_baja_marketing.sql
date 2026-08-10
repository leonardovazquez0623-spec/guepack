ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.usuarios.marketing_opt_out IS
  'true si el usuario se dio de baja de correos promocionales (campanas de reactivacion, etc). Se actualiza via la Edge Function baja-campana con service_role.';

CREATE OR REPLACE FUNCTION public.listar_clientes_reactivacion(
  p_segmento TEXT,
  p_tenant_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
  user_id TEXT,
  email TEXT,
  nombre TEXT,
  tenant_id BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.user_id::TEXT,
    btrim(u.email)::TEXT,
    NULLIF(btrim(u.nombre), '')::TEXT,
    u.tenant_id::BIGINT
  FROM public.usuarios AS u
  WHERE u.rol = 'cliente'
    AND u.user_id IS NOT NULL
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
    AND u.tenant_id IS NOT NULL
    AND NOT u.marketing_opt_out
    AND (
      p_tenant_id IS NULL
      OR u.tenant_id = p_tenant_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.campanas_reactivacion_log AS log
      WHERE log.user_id = u.user_id::TEXT
        AND log.segmento = p_segmento
    )
    AND (
      (
        p_segmento = 'nunca_pidieron'
        AND NOT EXISTS (
          SELECT 1
          FROM public.pedidos AS p
          WHERE p.user_id::TEXT = u.user_id::TEXT
        )
      )
      OR
      (
        p_segmento = 'inactivos'
        AND EXISTS (
          SELECT 1
          FROM public.pedidos AS p
          WHERE p.user_id::TEXT = u.user_id::TEXT
        )
        AND (
          SELECT MAX(p.created_at)
          FROM public.pedidos AS p
          WHERE p.user_id::TEXT = u.user_id::TEXT
        ) < now() - INTERVAL '7 days'
      )
    )
  ORDER BY u.tenant_id, u.user_id;
$$;

COMMENT ON FUNCTION public.listar_clientes_reactivacion(TEXT, BIGINT) IS
  'Obtiene clientes elegibles para una campana (excluye dados de baja); debe invocarse exclusivamente con service_role.';

REVOKE ALL
  ON FUNCTION public.listar_clientes_reactivacion(TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.listar_clientes_reactivacion(TEXT, BIGINT)
  TO service_role;
