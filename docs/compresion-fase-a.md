# Compresión de imágenes y límites de Storage — fase A

Estado: propuesta sin aplicar. No ejecutar este SQL sin una revisión y autorización posteriores. No se ha consultado la configuración de producción.

## Límite propuesto

Después de desplegar el cambio y actualizar las PWA instaladas, proponer un máximo de 5 MiB (5.242.880 bytes) y MIME `image/jpeg`, `image/png`, `image/webp` para `evidencias` y `perfiles`. `anuncios` queda fuera de esta propuesta: sus logos, mascotas y favicon ICO se revisarán en otra fase. El límite propuesto bloquea SVG, HEIC, GIF, PDF y cualquier otro MIME fuera de la lista, incluidos originales menores de 3 MiB que el compresor no logre convertir. Antes de activar, inventariar esos usos y definir excepción o una fase posterior; no activar si se requiere mantenerlos. Un control por MIME comprueba metadatos, no garantiza que los bytes sean una imagen válida. El tamaño máximo de 5 MiB se aplica a todas las cargas del bucket, no solo a imágenes.

`evidencias-zips` se deja separado en 110.000.000 bytes y `application/zip` para no romper el retiro de evidencias. El SQL propuesto no modifica este bucket; se debe verificar su configuración efectiva por separado. Un cambio de límites no reduce el espacio que ya ocupan los objetos existentes. La restricción 402 puede seguir impidiendo subidas hasta resolver la cuota de la organización.

```sql
-- PROPUESTA: NO EJECUTAR. Revisar configuración y usos reales antes de aplicar.
BEGIN;
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
WHERE id IN ('evidencias','perfiles');
COMMIT;
```

## Antes de considerar su aplicación

1. Desplegar la versión revisada y comprobar sus tres pantallas, permisos, cargas y lecturas en QA. No hay despliegue en esta entrega.
2. Conseguir que cada repartidor y cliente activo cierre y reabra la PWA con conexión; comprobar versión en cada dispositivo. La versión `guepack-v14-compresion` permite identificar el service worker, pero no prueba que una pestaña antigua ya haya recargado ni que todos los clientes se hayan conectado.
3. Llevar un registro explícito de dispositivos/versiones activos, basado en telemetría de versión de app y último uso o confirmaciones individuales verificables. El código de esta entrega no implementa telemetría ni existe una consulta que pruebe universalmente que no quedan clientes viejos: los dispositivos desconectados pueden reaparecer. Acordar una ventana de actividad y tratamiento de dispositivos ausentes antes de restringir.
4. Revisar uso de formatos y límites efectivos de cada bucket por separado, incluyendo aplicaciones antiguas y scripts externos; revisar `anuncios` en otra fase. El límite global de Storage también debe admitir ZIPs.
5. Planear una reversión con los valores reales guardados antes del cambio. Restaurar ambos campos por bucket; no asumir valores anteriores ni aplicar un rollback genérico.

## Prueba manual de teléfono

Abrir `/tools/prueba-compresion.html` desde un origen HTTPS de QA, sin iniciar sesión. La página usa exclusivamente el módulo local y no carga `config.js`, ni Supabase ni claves. En iPhone repetir en Safari y en la página añadida a pantalla de inicio; en Xiaomi usar Chrome. Para cada caso, probar una foto de 12 MP y, si el equipo la ofrece, una de 48–50 MP en horizontal y vertical; incluir foto con texto y EXIF rotado. Anotar modelo, versión de sistema y navegador, modo PWA, tamaño y dimensiones antes/después, duración, mayor intervalo del temporizador, orientación visual y legibilidad. Descargar la medición JSON sin incluir fotografías privadas.

Mientras comprime, desplazar la pantalla y observar si se bloquea. El mayor intervalo del temporizador es una señal aproximada, no una medida de memoria ni una prueba concluyente de ausencia de congelamientos. Si el navegador se cierra o falla la decodificación, anotar el caso. Comprobar foto pequeña, PDF sin cambios, firma pequeña y falla del módulo sin conectividad. El modo instalado requiere acceder primero con conexión; no se promete disponibilidad offline.

## Preview de Vercel sin tocar producción

Tras revisión y autorización separada para desplegar: desde el worktree, usar un proyecto de Vercel **aislado de QA**, verificar su vinculación y variables (sin secretos de producción) y ejecutar `vercel deploy` sin `--prod`. El comando crea un despliegue de previsualización, no un despliegue de producción; no asignar dominios de producción ni promoverlo. Abrir la URL de preview `/tools/prueba-compresion.html`. La protección del preview puede requerir autenticación también en el móvil. No se ha ejecutado el comando ni creado preview. Documentación: https://vercel.com/docs/cli/deploy

## Comportamiento anterior de Storage pendiente de otra tarea

En receta surtida y parada, un error devuelto por Storage puede dejar una referencia nula mientras se confirma el estado. En recolección, el modal puede cerrarse aunque no se haya subido evidencia. Esta fase conserva deliberadamente ese comportamiento al fallar Storage. El error nuevo de compresión se detiene antes de subir y deja disponible el reintento.
