BEGIN;
-- Configuración explícita durante despliegue. Reutiliza Vault, pg_cron y
-- pg_net de activar-pedidos-programados. No incorpora claves al repositorio.
CREATE FUNCTION public.evidencia_configurar_cron(p_supabase_url text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_sql text; v_id bigint;
BEGIN
  IF p_supabase_url !~ '^https://[a-z0-9]+\.supabase\.co$' THEN RAISE EXCEPTION 'URL_PROYECTO_INVALIDA'; END IF;
  IF NOT EXISTS(SELECT 1 FROM vault.secrets WHERE name='cron_service_role_key') THEN
    RAISE EXCEPTION 'FALTA_VAULT_CRON_SERVICE_ROLE_KEY';
  END IF;
  FOR v_id IN SELECT jobid FROM cron.job WHERE jobname='retirar-evidencias-entrega' LOOP
    PERFORM cron.unschedule(v_id);
  END LOOP;
  v_sql := format($job$
    SELECT net.http_post(url := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_service_role_key' ORDER BY created_at DESC LIMIT 1)),
      body := '{"action":"maintenance"}'::jsonb, timeout_milliseconds := 120000);
  $job$,p_supabase_url||'/functions/v1/evidencias-entrega');
  RETURN cron.schedule('retirar-evidencias-entrega','* * * * *',v_sql);
END $$;
REVOKE ALL ON FUNCTION public.evidencia_configurar_cron(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evidencia_configurar_cron(text) TO service_role;
COMMIT;
