Revisión de la app en modo lectura — 12 de noviembre de 2026.

Se revisaron sesión/tenant, historial, entrega y paradas, almacenamiento, panel administrativo, rastreo, service worker y validaciones de entrada. Se comprobó sintaxis de los 42 scripts propios encontrados en los HTML/JS de la raíz, incluyendo los dos módulos ES. No se corrigieron los errores siguientes. La revisión es del repositorio; no demuestra qué migraciones o políticas están aplicadas en producción.

Errores confirmados en el código:

| ID / prioridad | Archivo y línea | Manifestación e impacto | Evidencia |
| --- | --- | --- | --- |
| A1 — P1 | `repartidor.html:2792`, `:2815`, `:2831`, `:2838` | Si falla subir la foto/firma o guardar sus referencias, `confirmarEntrega()` sigue marcando el pedido Entregado. El cliente puede quedarse sin comprobante aunque la entrega aparezca finalizada. | `audit_app.cjs` ejecuta la función real con ambas subidas fallidas y captura la llamada final a `cambiarEstado(1, 'Entregado')`. |
| A2 — P1 | `admin.html:3928`, `:4205`; también `app.html:7321` | El botón administrativo de entrega sólo hace `update({estado: status})`. Omite el flujo que registra `entregado_at` y contabiliza la entrega en `marcar_entregado`. Con el esquema del repositorio, deja fecha ausente y no actualiza ese contador; esas evidencias se conservan fuera de la nueva selección por falta de fecha. | `audit_app.cjs` captura el payload real, que sólo contiene estado. La fecha/contador se actualizan en `20260828040000_marcar_entregado_entregado_at.sql:32`. Una posible compensación mediante triggers remotos no presentes en el repo queda sin verificar. |
| A3 — P2 | `sw.js:89` | Sin red y sin una entrada en caché, el `catch` de fetch devuelve `undefined`; `respondWith` necesita un `Response`. La carga del recurso falla y no existe una respuesta offline válida. El worker actual tampoco escribe entradas nuevas en caché. | `audit_app.cjs` ejecuta el listener real con red fallida y caché vacía; el resultado es `undefined`. |
| A4 — P2 | `supabase/migrations/20260821020000_rastreo_publico_comercio.sql:52` y `:55`; consumidor `rastreo.html:598`, `:628` | La calificación pública se promedia por nombre del repartidor, sin tenant ni ID. Dos repartidores con el mismo nombre mezclan su reputación. El helper es `SECURITY DEFINER`, de modo que no debe confiar en un filtro RLS implícito para ese agregado. | `audit_sql.ts` extrae la consulta de la última definición de la RPC del repositorio y la ejecuta con dos tenants: 5 y 1 estrellas devuelven 3.0, en lugar de 5 para el primero. No se verificó la definición desplegada. |

Prioridades: P1 afecta integridad operativa/datos y merece corrección antes de confiar en esos flujos; P2 produce resultados o experiencia incorrectos bajo la condición descrita.

Hallazgos separados que requieren verificación:

| ID / prioridad de investigación | Archivo y línea | Evidencia observada | Qué falta comprobar |
| --- | --- | --- | --- |
| V1 — P1 | `app.html:2821`, `:7031`, `:2288` | Pedidos activos e historial se filtran por usuario sin tenant explícito. El control inicial usa el perfil global `usuarios.rol`. | El alcance real de RLS, cuentas con membresías en más de un tenant y si esos perfiles deben acceder como cliente en el tenant actual. No se afirma una fuga confirmada. La función nueva sí exige tenant exacto. |
| V2 — P2 | `repartidor.html:2945` | `paradas.completada_at` se envía desde `new Date()` del dispositivo. La nueva función compara esa fecha guardada con la hora SQL. | Si existe un trigger remoto que la sustituye por hora de servidor y si hay registros afectados por relojes incorrectos. No se cambiaron fechas históricas ni el flujo de completar paradas. |
| V3 — P1 | `app.html:7119`, `:7133` | El nombre del destinatario se interpola en `innerHTML` sin escape de salida. | Qué vías pueden guardar HTML en ese campo. El backend `crear-pedido-local/index.ts:334` valida nombres y el formulario también sanitiza, por lo que el punto de salida por sí solo no prueba explotación con el flujo actual. Revisar imports, datos antiguos y otras escrituras antes de afirmar XSS explotable. |
| V4 — P2 | `admin.html:5570` | Finanzas usa `created_at` cuando falta `entregado_at`; esas fechas no tienen por qué ser el día de entrega. | Cuánto afecta a los reportes reales. El usuario confirmó que no hay fuente alternativa para reconstruir el histórico; no se rellenaron fechas. |

Reproducciones locales, sin red ni modificaciones en los archivos auditados:

```powershell
node supabase/tests/evidencias/audit_app.cjs
deno run --config supabase/tests/evidencias/deno.json --allow-read --allow-env supabase/tests/evidencias/audit_sql.ts
```

El ajuste de `repartidor.html` de esta entrega sólo adapta los enlaces de fotos al bucket privado. No corrige A1, A2 ni V2. No se modificaron `admin.html`, `sw.js`, la RPC de rastreo ni las validaciones de `crear-pedido-local`.
