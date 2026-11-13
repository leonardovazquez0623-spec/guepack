Implementación local del aviso y retiro de evidencias de entrega — 12 de noviembre de 2026.

Esta sesión no ejecutó migraciones ni despliegues de funciones o frontend a producción; no se verificó el estado remoto. El inventario de cambios parte de `98e0802` y conserva el commit `12dccf0` que apareció durante el trabajo. El archivo preexistente `qr-generator (1).html` no fue modificado por esta implementación.

El cliente ve el texto solicitado después de comprobar su usuario con Auth y su membresía `cliente` en el tenant detectado. Se consulta al cargar la app, al volver desde otra ventana/aplicación y al restaurar la página. Cerrar el aviso sólo lo oculta durante esa entrada. No hay campañas, correos, notificaciones push ni selección automática de archivos para clientes que no pulsaron el botón.

El servidor selecciona `pedidos.foto_evidencia`, `pedidos.firma_evidencia` y `paradas.foto_url/firma_url` de entregas completadas, con `fecha <= now() - interval '30 days'`. Usa `pedidos.entregado_at` y, para cada parada, su propia `completada_at`. No usa `created_at`, la fecha del archivo ni la fecha de instalación. El ZIP conserva las carpetas `GK-{folio}` y contiene un manifiesto de tamaños y SHA-256.

**Límite histórico acordado:** el usuario confirmó que no existe otra fuente de fechas. Los registros sin fecha real comprobable se conservan y no entran al retiro. Las evidencias anteriores al despliegue que sí tienen fecha se incluyen desde la primera entrada. Una parada con `completada_at` puede ser elegible aunque el pedido antiguo no tenga `entregado_at`.

El bucket `evidencias` pasa a privado. Las políticas restrictivas protegen las rutas de entrega incluso si existen políticas permisivas antiguas. Los clientes acceden a sus pedidos; el administrador necesita su rol del tenant exacto y el repartidor su asignación. Los ZIP se sirven mediante la Edge Function, que valida Auth y propietario/tenant en cada descarga. No se devuelve una URL pública ni una URL firmada del ZIP.

La creación y la eliminación tienen un estado persistente. Se conserva una sola preparación activa por cliente/tenant, una clave idempotente y un lease de trabajador. Se transmite el ZIP por bloques al disco temporal, se sube y se descarga completamente para comparar tamaño y SHA-256 antes de eliminar originales mediante Storage API. Los errores de preparación dejan los originales. Un borrado parcial conserva el ZIP y las referencias pendientes; el reintento reconcilia los archivos ya retirados. Los campos originales se limpian sólo después de confirmar la ausencia en Storage o de conservar el objeto por estar compartido.

Se comprueban referencias compartidas en todos los campos de pedidos/paradas y, de forma conservadora, valores de texto/JSON de otras tablas públicas. No se borran comprobantes, recolecciones, recetas, depósitos, pedidos ni folios. Las referencias en curso se bloquean para evitar cambios durante la reserva. Las rutas retiradas quedan marcadas para impedir su reutilización accidental.

Cada lote contiene hasta 100 objetos y 100 MiB de originales; si quedan evidencias, el historial ofrece otro lote con el mismo botón. Esta división limita recursos de Edge. Los formatos históricos ajenos a las rutas que genera actualmente la app se conservan y aparecen en la consulta previa de revisión. Un archivo individual de más de 100 MiB requiere tratamiento fuera de este flujo; no se elimina.

El plazo de 24 horas comienza al verificar el ZIP. SQL impide descargarlo al vencer, independientemente del cron. La eliminación física ocurre en la siguiente ejecución del cron, programado cada minuto, y reintenta si Storage falla. El cron sólo continúa lotes consentidos y elimina copias temporales; no crea lotes ni retira originales de clientes que no dieron consentimiento. También recoge candidatos de ZIP abandonados y candidatos tardíos de trabajadores interrumpidos.

Archivos de la función y finalidad:

| Archivo | Cambio |
| --- | --- |
| `app.html` | Carga del módulo/CSS, aviso después del control de sesión, sección de ZIPs y marcador de evidencias retiradas en historial/visor. |
| `evidencias-entrega.js` | Comprobación por entrada, diálogo, idempotencia de clics, descarga y recuperación. |
| `evidencias-entrega.css` | Tema de la app, diálogo adaptable, foco y botones táctiles. |
| `repartidor.html` | Sólo dos accesos a fotos de paradas y su helper: solicitan URL privada firmada al privatizar el bucket. |
| `supabase/config.toml` | Registro de la nueva función y máximo local de Storage de 110 MiB para el ZIP; Auth se valida dentro del handler. |
| `supabase/functions/evidencias-entrega/index.ts` | Inicialización de clientes y límites de peticiones. |
| `supabase/functions/evidencias-entrega/handler.ts` | Autorización, estado, consentimiento, reintento, descarga y mantenimiento. |
| `supabase/functions/evidencias-entrega/service.ts` | Preparación/verificación del ZIP, borrado, reintentos y limpieza. |
| `supabase/functions/evidencias-entrega/zip.ts` | Escritura incremental de ZIP con CRC32, SHA-256 y manifiesto. |
| `supabase/functions/evidencias-entrega/deno.json`, `deno.lock` | Dependencias fijadas de la función. |
| `supabase/migrations/20261112010000_retiro_evidencias_entrega.sql` | Tablas, RPC, bloqueos, marcadores de retiro y permisos privados. |
| `supabase/migrations/20261112020000_cron_retiro_evidencias.sql` | Instalador del cron usando la infraestructura existente; no activa el trabajo al migrar. |
| `supabase/queries/retiro_evidencias_preflight.sql` | Inventario previo de esquema, fechas, membresías, formatos y permisos; sólo lectura. |
| `supabase/tests/evidencias/fixture.sql` | Datos ficticios previos a la migración. Exclusivo del PostgreSQL efímero de pruebas. |
| `supabase/tests/evidencias/workflow_test.ts`, `ui_test.ts` | Pruebas SQL/Storage/HTTP y ciclo del aviso. |
| `supabase/tests/evidencias/browser_test.cjs` | Chrome sin red con el CSS real de la app, móvil/escritorio y descarga Blob. |
| `supabase/tests/evidencias/audit_app.cjs`, `audit_sql.ts` | Reproducciones de errores existentes sin modificar la app. |
| `supabase/tests/evidencias/deno.json`, `deno.lock` | Dependencias aisladas de pruebas. |
| Este documento y `docs/revision-app-2026-11-12.md` | Activación, verificación y reporte. |

Para repetir las pruebas desde la raíz:

```powershell
deno check --config supabase/functions/evidencias-entrega/deno.json supabase/functions/evidencias-entrega/index.ts
deno test --config supabase/tests/evidencias/deno.json --allow-read --allow-write --allow-env supabase/tests/evidencias/
node supabase/tests/evidencias/browser_test.cjs
node supabase/tests/evidencias/audit_app.cjs
deno run --config supabase/tests/evidencias/deno.json --allow-read --allow-env supabase/tests/evidencias/audit_sql.ts
git diff --check
```

La prueba de navegador usa `playwright-core` ya disponible en este entorno y un Chrome/Edge local. Si hace falta instalarlo en otro equipo, usar una instalación aislada de pruebas (`npm install --no-save --package-lock=false playwright-core`), sin alterar las dependencias de producción. `EVIDENCIAS_BROWSER` permite indicar otro ejecutable. El navegador usa un origen HTTPS interceptado; bloquea toda salida de red.

La batería usa PostgreSQL 17.5 mediante PGlite, ejecuta las dos migraciones reales y procesa ZIPs reales con la función de producción. Storage y Auth se simulan con identidades y objetos ficticios. Prueba históricos previos a migración, umbral de 30 días, recientes, fechas ausentes, falta de sesión, cuenta sin evidencias, dos tenants, otro cliente del mismo tenant, aviso cerrado/reapertura, clic duplicado, fallo de lectura, ZIP corrupto, borrado parcial, respuesta perdida, lease obsoleto, archivos compartidos, recuperación, caducidad y limpieza de candidatos tardíos.

Resultado final ejecutado: **16 pruebas Deno aprobadas, 0 fallidas** (13 de flujo/SQL/HTTP y 3 de interfaz). Las **2 pruebas Chrome** aprobaron en 390×844 y 1280×800, incluyendo centrado, ausencia de desbordamiento, texto literal, Escape, reapertura y descarga Blob. También pasaron la comprobación de tipos de la función, `node --check evidencias-entrega.js`, la revisión de sintaxis de 42 scripts de la raíz y `git diff --check`. Las cuatro reproducciones de auditoría confirmaron A1–A4 y no alteraron esos flujos.

No se ejecutó un stack Supabase completo: Docker no pudo conectar a su motor. Tampoco se verificaron Auth/Storage alojados, dispositivos iOS/Android, límites reales de CPU/red de Edge, contención con conexiones PostgreSQL independientes ni datos/políticas remotos. Las pruebas visuales aíslan esta función con el CSS real, no sustituyen una prueba integral de inicio de sesión de toda la app.

Activación exacta, primero en un proyecto de staging:

1. Ejecutar en el SQL Editor del proyecto elegido `supabase/queries/retiro_evidencias_preflight.sql`. Deben existir las columnas enumeradas, el bucket `evidencias`, las membresías cliente correctas y las extensiones `pg_cron`, `pg_net` y Vault. Resolver diferencias de esquema o membresía antes de activar; no inferir tenants ni fechas. Revisar el contador de rutas históricas fuera del formato esperado. Los `NULL` de fechas permanecen conservados.
2. Guardar el estado de buckets/políticas y una copia de los datos/objetos de prueba. Configurar el límite global de carga de Storage para admitir **110000000 bytes** (el límite del bucket de ZIP); el límite global no puede ser menor al del bucket. Si el plan/proyecto no permite ese tamaño, ajustar y probar los límites de lote y bucket antes de activar; no asumir que aumentar el límite del bucket cambia el global.
3. En el SQL Editor, ejecutar completos y en este orden los archivos `20261112010000_retiro_evidencias_entrega.sql` y `20261112020000_cron_retiro_evidencias.sql`. Cada archivo tiene su transacción. No ejecutar el `fixture.sql` contra Supabase: crea un esquema artificial de pruebas. No hacer un `db push` indiscriminado del historial antiguo del repositorio.
4. Desplegar exclusivamente la función al proyecto elegido:

   ```powershell
   $EvidenceProjectRef = 'REF_DEL_PROYECTO_DE_STAGING'
   supabase functions deploy evidencias-entrega --project-ref $EvidenceProjectRef --no-verify-jwt
   ```

   `--no-verify-jwt` desactiva el chequeo del gateway; el handler siempre valida al cliente mediante `auth.getUser(token)`. Sólo `maintenance` acepta la clave de servicio. Las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` son las suministradas por Supabase. Dejar `EVIDENCIAS_LOCAL_TEST` sin configurar en alojado.
5. Confirmar que Vault contiene `cron_service_role_key` del mismo proyecto. Se reutiliza el secreto de `activar-pedidos-programados`; no se imprime ni se incluye en el repositorio. Si falta, crearlo desde Vault con la clave de servicio de ese proyecto y ese nombre. Activar el trabajo:

   ```sql
   select public.evidencia_configurar_cron('https://REF_DEL_PROYECTO_DE_STAGING.supabase.co');
   select jobid, jobname, schedule, active from cron.job
   where jobname='retirar-evidencias-entrega';
   ```

   Sustituir la referencia por el identificador real en minúsculas. La función valida el dominio y reutiliza el nombre del trabajo para no duplicarlo.
6. Publicar juntos `app.html`, `evidencias-entrega.js`, `evidencias-entrega.css` y `repartidor.html` en el frontend de staging apuntado a ese proyecto. El frontend actual tiene URL/key de producción fijas; el entorno de prueba debe configurar sus clientes hacia staging antes de abrirlo. No probar borrado con esa configuración de producción.
7. Usar dos cuentas cliente de tenants distintos y pedidos/archivos creados por los flujos de staging. Repetir la matriz anterior sobre Auth y Storage reales, incluida la apertura de fotos privadas del repartidor y administrador. Para simular 30 días, modificar únicamente fechas de pedidos de prueba en staging. Verificar que un 401/403 no crea lotes y que una consulta/cierre tampoco los crea.
8. Verificar `storage.buckets.public = false` para ambos buckets, acceso denegado a originales/ZIP de otro cliente y conservación de comprobantes/recolección. Revisar resultados del cron y respuestas de pg_net, no sólo la existencia del trabajo:

   ```sql
   select estado, count(*) from public.evidencia_lotes group by estado;
   select id, estado, creado_at, verificado_at, vence_at, ultimo_error
   from public.evidencia_lotes order by creado_at desc limit 20;
   select status, return_message, start_time, end_time
   from cron.job_run_details where jobid in
     (select jobid from cron.job where jobname='retirar-evidencias-entrega')
   order by start_time desc limit 10;
   select status_code, timed_out, error_msg, created
   from net._http_response order by created desc limit 10;
   ```

   Un cron exitoso sólo prueba que se encoló HTTP; comprobar también HTTP 200 y la eliminación real de ZIP/objetos de prueba. Para la prueba acelerada de caducidad, sólo en staging, adelantar `vence_at` del lote de prueba y verificar 410 y limpieza en el siguiente minuto.
9. Tras validar staging, repetir los pasos 1–6 con el proyecto/hosting de producción como parte del despliegue autorizado. Publicar el frontend al final. No es necesario migrar ni marcar manualmente las evidencias históricas con fecha; la consulta las encuentra inmediatamente.

Para desactivar sin perder la recuperación de lotes existentes: retirar del frontend la llamada a `GuepEvidencias.iniciar` y deshabilitar temporalmente la acción `start` en el handler, conservando `status`, `retry`, `download` y el cron. Mantener el servicio hasta vencer y limpiar los ZIP existentes. Después puede desprogramarse `select cron.unschedule('retirar-evidencias-entrega');`. No borrar las tablas de lotes ni hacer público el bucket como rollback. El borrado físico de originales no se revierte con SQL; durante su plazo, el ZIP es la copia de recuperación. Conservar copias de los originales antes de cualquier prueba destructiva en staging.

Referencias técnicas consultadas: Supabase documenta los [buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals), la [eliminación mediante Storage API](https://supabase.com/docs/guides/storage/management/delete-objects), el [disco temporal de Edge](https://supabase.com/docs/guides/functions/ephemeral-storage) y sus [límites de ejecución](https://supabase.com/docs/guides/functions/limits). El flujo no elimina filas de `storage.objects` mediante SQL en producción; los deletes SQL del simulador sólo representan el efecto de la API en la base efímera.
