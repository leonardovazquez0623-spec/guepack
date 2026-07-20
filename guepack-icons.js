// GUEPACK — Sistema de iconos v2
// Paquete base: guepack-icons/svg (24x24, stroke 1.8, redondeado)
// Azul #1E56C7 (estructura) · Naranja #F05A1A (acentos)
// CSS icon-on-color usa filter:brightness(0)invert(1) → todo blanco sobre fondo color

const GUEPACK_ICONS = {

  // ── Iconos del paquete nuevo ──────────────────────────────────────────────

  // 01 Inicio — casa con puerta naranja
  inicio: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1h4.5v-6h2v6H17.5a1 1 0 0 0 1-1v-9"/><path d="M10 20v-4h4v4" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 02 Paquetes — caja 3D con línea naranja
  paquete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6.5v11L12 21l8-3.5v-11L12 3Z"/><path d="M4 6.5 12 10l8-3.5"/><path d="M12 10v11"/><path d="M8 4.7 16 8.2" stroke="#F05A1A"/></svg>`,

  // 03 Envíos — camión sin palomita
  envios: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16V7.5a1 1 0 0 1 1-1h9.5v9.5"/><path d="M13.5 10h4l3 3v3h-2"/><circle cx="7" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/><path d="M3 13h3" stroke="#F05A1A"/></svg>`,

  // 04 Direcciones — pin clásico con círculo naranja sólido (reemplaza 📍)
  ubicacion: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 09 Favoritos — corazón-pin naranja (dirección guardada/favorita)
  direccion_guardada: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-9.6A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 7 3.4C19 15.6 12 20 12 20Z" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 05 Perfil — persona individual
  perfil: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5"/></svg>`,

  // 06 Usuarios — dos personas
  usuarios: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5"/><circle cx="17" cy="9" r="2.3" stroke="#F05A1A"/><path d="M15.2 13.2c2.4.2 4.3 2.1 4.3 4.8" stroke="#F05A1A"/></svg>`,

  // 07 Chat — burbuja con puntos
  chat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.2 3.5V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/><circle cx="8.3" cy="10.7" r="1" fill="#1E56C7" stroke="none"/><circle cx="12" cy="10.7" r="1" fill="#1E56C7" stroke="none"/><circle cx="15.7" cy="10.7" r="1" fill="#F05A1A" stroke="none"/></svg>`,

  // 08 Notificaciones — campana con badge naranja
  notificaciones: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10.5a6 6 0 0 1 12 0c0 3.6 1 5 2 6H4c1-1 2-2.4 2-6Z"/><path d="M9.5 19.5a2.5 2.5 0 0 0 5 0"/><circle cx="18" cy="6" r="3" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 09 Favoritos — corazón-pin naranja sólido
  favoritos: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-9.6A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 7 3.4C19 15.6 12 20 12 20Z" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 10 Destacados — estrella naranja sólida
  logro: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.7 1.1-5.7-4.3-4 5.8-.7L12 3.5Z" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 11 Evidencia — cámara
  evidencia: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h3.2L8.5 6h7l1.3 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.2" stroke="#F05A1A"/></svg>`,

  // 14 Mensajes — sobre
  mensajes: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5h17a1 1 0 0 1 1 1V17a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z"/><path d="M3.8 7 12 13l8.2-6" stroke="#F05A1A"/></svg>`,

  // 16 Historial — reloj con flecha
  historial: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2" stroke="var(--color-secondary)"/><path d="M4 6l.3 3 3-.5" stroke="var(--color-primary)"/></svg>`,

  // 17 Cotización — documento con líneas
  cotizacion: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14.5 3.5V8H19"/><path d="M8 12.5h4M8 15.5h6" stroke="#F05A1A"/><circle cx="9.2" cy="17.8" r="1" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 18 Pagos — tarjeta de crédito
  pagos: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19"/><rect x="5" y="13.5" width="5" height="2.2" rx="0.5" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 19 Cobros — círculo naranja con $
  cobros: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5" fill="#F05A1A" stroke="#F05A1A"/><text x="12" y="16.3" font-size="11" fill="white" stroke="none" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold">$</text></svg>`,

  // 20 Promociones — ticket/etiqueta de descuento
  promociones: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5V6a1 1 0 0 1 1-1h6.5l8.5 8.5-7.5 7.5L4 12.5Z"/><circle cx="8.3" cy="8.3" r="1.5" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 21 Empresa — edificio
  empresa: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="9" height="17"/><rect x="13" y="9" width="7" height="11.5"/><rect x="6.3" y="6" width="1.8" height="1.8" fill="#F05A1A" stroke="#F05A1A"/><rect x="9.9" y="6" width="1.8" height="1.8" fill="#F05A1A" stroke="#F05A1A"/><rect x="6.3" y="10" width="1.8" height="1.8" fill="#F05A1A" stroke="#F05A1A"/><rect x="9.9" y="10" width="1.8" height="1.8" fill="#F05A1A" stroke="#F05A1A"/><rect x="9.5" y="16" width="3" height="4.5"/></svg>`,

  // 22 Recolección — caja con flecha arriba
  recoleccion: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="12" width="14" height="9" rx="1.2"/><path d="M5 12l2.3-2.8h9.4L19 12"/><path d="M12 12v9"/><path d="M12 8V3" stroke="#F05A1A"/><path d="M9 6 12 3l3 3" stroke="#F05A1A"/></svg>`,

  // 22b Enviar paquete (alias recoleccion)
  enviar_paquete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="12" width="14" height="9" rx="1.2"/><path d="M5 12l2.3-2.8h9.4L19 12"/><path d="M12 12v9"/><path d="M12 8V3" stroke="#F05A1A"/><path d="M9 6 12 3l3 3" stroke="#F05A1A"/></svg>`,

  // 22c Recibir paquete — caja con flecha abajo
  recibir_paquete: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="12" width="14" height="9" rx="1.2"/><path d="M5 12l2.3-2.8h9.4L19 12"/><path d="M12 12v9"/><path d="M12 3v5" stroke="#F05A1A"/><path d="M9 5.5 12 8.5l3-3" stroke="#F05A1A"/></svg>`,

  // 23 Entrega — camión con palomita naranja
  entrega: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16V7.5a1 1 0 0 1 1-1h9.5v9.5"/><path d="M13.5 10h4l3 3v3h-2"/><circle cx="7" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/><path d="M5.5 12.5l1.8 1.8L10.5 11" stroke="#F05A1A"/></svg>`,

  // 24 Rastreo — pin clásico con círculo naranja (04-Direcciones)
  rastreo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4" fill="var(--color-secondary)" stroke="var(--color-secondary)"/></svg>`,

  // 25 Seguro — escudo naranja con palomita
  seguro: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 19 6v6c0 5-3 7.7-7 8.5-4-.8-7-3.5-7-8.5V6l7-2.5Z" fill="#F05A1A" stroke="#F05A1A"/><path d="M8.7 12l2.2 2.2 4.4-4.4" stroke="white"/></svg>`,

  // 26 Express — rayo naranja
  entrega_rapida: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13.5h5.5L10 21l8.5-11H12.5L13 3Z" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 27 Estadísticas — barras verticales
  estadisticas: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10" stroke="#1E56C7"/><path d="M9.5 20V6" stroke="#F05A1A"/><path d="M15 20v-9" stroke="#1E56C7"/><path d="M20 20V4" stroke="#F05A1A"/></svg>`,

  // 28 Reportes — pastel circular con sector
  reportes: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="11.5" r="7"/><path d="M10.5 4.5v7h7" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // 29 Buscar — lupa
  buscar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3 20.5 20.5" stroke="#F05A1A"/></svg>`,

  // 30 Agregar — círculo azul con + blanco
  agregar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" fill="var(--color-primary)" stroke="var(--color-primary)"/><path d="M12 8v8M8 12h8" stroke="white"/></svg>`,

  // 31 Editar — lápiz
  editar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l.9-3.9L15.6 5.4a1.8 1.8 0 0 1 2.5 0l0 0a1.8 1.8 0 0 1 0 2.5L7.4 18.6 4 20Z"/><path d="M14 7 17 10" stroke="#F05A1A"/></svg>`,

  // 32 Eliminar — bote de basura
  eliminar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/><path d="M6.5 7 7.3 19a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7"/><path d="M10 11v5.5M14 11v5.5" stroke="#F05A1A"/></svg>`,

  // 33 Subir — círculo con flecha arriba
  subir: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" stroke="#F05A1A"/></svg>`,

  // 34 Descargar — círculo con flecha abajo
  descargar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8.5 12.5 12 16l3.5-3.5" stroke="#F05A1A"/></svg>`,

  // 35 Compartir — tres nodos conectados
  compartir: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.3"/><circle cx="17.5" cy="5.5" r="2.3" stroke="#F05A1A"/><circle cx="17.5" cy="18.5" r="2.3" stroke="#F05A1A"/><path d="M8 10.7 15.6 6.8M8 13.3l7.6 3.9"/></svg>`,

  // 36 Soporte — audífonos
  soporte: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="12.5" width="4" height="5.5" rx="1.5"/><rect x="17" y="12.5" width="4" height="5.5" rx="1.5" fill="#F05A1A" stroke="#F05A1A"/><path d="M18 18v.5a3 3 0 0 1-3 3h-2.5"/></svg>`,

  // 37 Configuración — engranaje con rayos naranja
  configuracion: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6M17.8 17.8l-1.6-1.6M7.8 7.8 6.2 6.2" stroke="#F05A1A"/></svg>`,

  // 38 Seguridad — escudo con candado
  seguridad: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 19 6v6c0 5-3 7.7-7 8.5-4-.8-7-3.5-7-8.5V6l7-2.5Z"/><rect x="9.5" y="11" width="5" height="4" rx="0.8" fill="#F05A1A" stroke="#F05A1A"/><path d="M10.3 11V9.5a1.7 1.7 0 0 1 3.4 0V11" stroke="#F05A1A"/></svg>`,

  // 39 Iniciar sesión — puerta con flecha entrando
  iniciar_sesion: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="12" r="4"/><circle cx="8" cy="12" r="1.3" fill="#F05A1A" stroke="#F05A1A"/><path d="M11.8 12H20"/><path d="M16.5 12v3"/><path d="M19 12v2.2"/></svg>`,

  // 40 Salir — puerta con flecha saliendo
  salir: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/><path d="M15.5 8 19.5 12l-4 4" stroke="#F05A1A"/><path d="M19.5 12H9" stroke="#F05A1A"/></svg>`,

  // 43 Nacional — globo terráqueo
  nacional: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17Z"/><path d="M5 7.5c1.8 1 4.3 1.5 7 1.5s5.2-.5 7-1.5M5 16.5c1.8-1 4.3-1.5 7-1.5s5.2.5 7 1.5" stroke="var(--color-secondary)"/></svg>`,

  // 45 VIP — trofeo naranja
  vip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5h12v3.5c0 4-2.5 6.7-6 7.3-3.5-.6-6-3.3-6-7.3V5Z" fill="#F05A1A" stroke="#F05A1A"/><path d="M6 6.5H3.5v1.8A2.7 2.7 0 0 0 6 11M18 6.5h2.5v1.8A2.7 2.7 0 0 1 18 11" stroke="#F05A1A"/><path d="M10 19h4M9 21h6M12 15.8V19"/></svg>`,

  // 48 Etiquetas — tag
  nota_pedido: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1E56C7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r="1.3" fill="#F05A1A" stroke="#F05A1A"/></svg>`,

  // ── Iconos sin equivalente en el paquete nuevo — se mantienen del diseño original ──

  // Repartidor — gato con mochila GuePack (identidad de marca)
  repartidor: `<svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="20" r="10" stroke="#1E56C7" stroke-width="2.5"/><path d="M20 12 L17 5 L23 10" stroke="#1E56C7" stroke-width="2.5" stroke-linejoin="round"/><path d="M36 12 L39 5 L33 10" stroke="#1E56C7" stroke-width="2.5" stroke-linejoin="round"/><path d="M23 21 Q28 25 33 21" stroke="#F05A1A" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="24" cy="18" r="1.3" fill="#1E56C7"/><circle cx="32" cy="18" r="1.3" fill="#1E56C7"/><rect x="18" y="32" width="20" height="16" rx="4" stroke="#F05A1A" stroke-width="2.5"/><path d="M18 38 L12 36 L12 46 L18 44" stroke="#F05A1A" stroke-width="2.2" stroke-linejoin="round" fill="none"/></svg>`,

  // Esperando — cola de guepardo enroscada (spinner de carga)
  esperando: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 10 A22 22 0 1 1 11 36" stroke="#F05A1A" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M11 36 L5 41 L14 43 Z" fill="#F05A1A"/><circle cx="32" cy="10" r="2.6" fill="#C2410C"/><circle cx="49" cy="18" r="2.6" fill="#C2410C"/><circle cx="54" cy="34" r="2.6" fill="#C2410C"/><circle cx="45" cy="48" r="2.6" fill="#C2410C"/><circle cx="27" cy="53" r="2.2" fill="#C2410C"/></svg>`,

  // Entregado — círculo verde con palomita (estado final exitoso)
  entregado: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="26" fill="#2FAE5C"/><path d="M20 33 L28 41 L45 22" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // Me gusta — corazón outline naranja
  me_gusta: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 26 C27 18, 15 21, 15 30 C15 39, 32 50, 32 50 C32 50, 49 39, 49 30 C49 21, 37 18, 32 26 Z" stroke="#F05A1A" stroke-width="3.5" fill="none" stroke-linejoin="round"/></svg>`,

};

function gi(key) { return GUEPACK_ICONS[key] || ''; }
if (typeof window !== 'undefined') window.GUEPACK_ICONS = GUEPACK_ICONS;
