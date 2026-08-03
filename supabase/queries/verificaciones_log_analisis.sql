-- a) Conteo de fallos por etapa en las últimas 48 horas.
SELECT
  etapa,
  COUNT(*) AS total_fallos
FROM public.verificaciones_log
WHERE creado_en >= NOW() - INTERVAL '48 hours'
  AND etapa NOT IN ('envio_ok', 'verificado_ok')
GROUP BY etapa
ORDER BY total_fallos DESC, etapa;

-- b) Comparativa PWA standalone contra navegador, por etapa, últimas 48 horas.
SELECT
  etapa,
  standalone,
  COUNT(*) AS total_eventos,
  ROUND(
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY standalone),
    2
  ) AS porcentaje_dentro_entorno
FROM public.verificaciones_log
WHERE creado_en >= NOW() - INTERVAL '48 hours'
GROUP BY etapa, standalone
ORDER BY etapa, standalone DESC;

-- c) Usuarios con tres o más intentos fallidos y la secuencia de etapas.
SELECT
  usuario_id,
  COUNT(*) AS total_fallos,
  JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'creado_en', creado_en,
      'etapa', etapa,
      'codigo', codigo,
      'standalone', standalone,
      'telefono_masked', telefono_masked
    )
    ORDER BY creado_en
  ) AS intentos
FROM public.verificaciones_log
WHERE creado_en >= NOW() - INTERVAL '48 hours'
  AND usuario_id IS NOT NULL
  AND etapa NOT IN ('envio_ok', 'verificado_ok')
GROUP BY usuario_id
HAVING COUNT(*) >= 3
ORDER BY total_fallos DESC, usuario_id;
