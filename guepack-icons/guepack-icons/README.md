# GUEPACK Icons

Paquete de 50 iconos SVG para Guepapp, en el estilo de tu poster de referencia:
- viewBox 24x24
- stroke 1.8, líneas redondeadas (amigable)
- azul `#1E56C7` (líneas principales) y naranja `#F05A1A` (acentos/detalles)

## Contenido
- `svg/` → los 50 archivos individuales, listos para usar (ej. `01-inicio.svg`)
- `sprite.svg` → todos los iconos combinados como `<symbol>`, ideal para cargar uno solo en tu PWA
- `preview.html` → ábrelo en el navegador para ver los 50 de un vistazo

## Uso en Guepapp (PWA)

**Opción A — inline SVG (recomendado para control de color con CSS):**
```html
<div class="icon" style="width:24px;height:24px;">
  <!-- pega el contenido del .svg aquí -->
</div>
```

**Opción B — sprite (una sola carga, mejor rendimiento):**
```html
<!-- una vez en tu index.html o app.html -->
<link rel="preload" href="/icons/sprite.svg" as="image">

<!-- en cualquier parte -->
<svg width="24" height="24">
  <use href="/icons/sprite.svg#01-inicio"></use>
</svg>
```

## Cambiar color con CSS
Como los SVG usan `stroke="currentColor"`-friendly (color fijo por defecto), si quieres que hereden color del contenedor, reemplaza en cada archivo `stroke="#1E56C7"` por `stroke="currentColor"` y luego controla con `color: #1E56C7;` en CSS.

## Lista de iconos
01 Inicio · 02 Paquetes · 03 Envíos · 04 Direcciones · 05 Perfil · 06 Usuarios · 07 Chat · 08 Notificaciones · 09 Favoritos · 10 Destacados · 11 Evidencia · 12 Galería · 13 Llamar · 14 Mensajes · 15 Calendario · 16 Historial · 17 Cotización · 18 Pagos · 19 Cobros · 20 Promociones · 21 Empresa · 22 Recolección · 22b Enviar paquete (flecha arriba) · 22c Recibir paquete (flecha abajo) · 23 Entrega · 24 Rastreo · 25 Seguro · 26 Express · 27 Estadísticas · 28 Reportes · 29 Buscar · 30 Agregar · 31 Editar · 32 Eliminar · 33 Subir · 34 Descargar · 35 Compartir · 36 Soporte · 37 Configuración · 38 Seguridad · 39 Iniciar sesión · 40 Salir · 41 Modo oscuro · 42 Modo claro · 43 Nacional · 44 Local (mismo diseño que Entrega) · 45 VIP · 46 App · 47 Objetivos · 48 Etiquetas · 49 Inventario · 50 Sucursales

## Cambios en esta revisión
- **Cobros**: símbolo `$` corregido (ya no está volteado)
- **Recolección**: flecha naranja reposicionada arriba del paquete
- **Nuevos**: `22b-enviar-paquete.svg` (flecha arriba, para "Enviar un paquete") y `22c-recibir-paquete.svg` (flecha abajo, para "Recibir un paquete")
- **Local**: ahora usa el mismo icono que Entrega
- **Objetivos**: flecha/dardo rediseñada (asta + punta + plumas)
- **Etiquetas**: borde de la etiqueta corregido, ya no se ve desfasado
