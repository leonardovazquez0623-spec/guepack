// GUEPACK — Sistema de iconos FINAL
// Todo gira alrededor del gato. Trazo azul #1E56C7, acento naranja #F05A1A.
// Sin orejitas decorativas en ningún ícono — la identidad "gato" vive en
// bigotes, huellas y la cola de guepardo, no en orejas literales.

const GUEPACK_ICONS = {

  // 📦 Paquete → Caja con huella
  paquete: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="20" width="40" height="32" rx="3" stroke="#1E56C7" stroke-width="3.5"/>
  <path d="M12 27 L32 36 L52 27" stroke="#1E56C7" stroke-width="3.5" fill="none"/>
  <path d="M32 36 L32 52" stroke="#1E56C7" stroke-width="3.5"/>
  <circle cx="42" cy="43" r="3" fill="#F05A1A"/>
  <circle cx="47" cy="40" r="2.2" fill="#F05A1A"/>
  <circle cx="47" cy="46" r="2.2" fill="#F05A1A"/>
  <circle cx="42" cy="48" r="1.9" fill="#F05A1A"/>
</svg>`,

  // ⭐ Favoritos → Estrella sólida naranja
  favoritos: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 8 L39.5 24.5 L57.5 27 L44.5 39 L48 57 L32 47.5 L16 57 L19.5 39 L6.5 27 L24.5 24.5 Z" fill="#F05A1A"/>
</svg>`,

  // ⭐ Dirección guardada → misma estrella, para botón junto al campo de dirección
  direccion_guardada: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 8 L39.5 24.5 L57.5 27 L44.5 39 L48 57 L32 47.5 L16 57 L19.5 39 L6.5 27 L24.5 24.5 Z" fill="#F05A1A"/>
</svg>`,

  // 📝 Nota de pedido → libreta con huella de acento
  nota_pedido: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 10 H40 L48 18 V54 H16 Z" stroke="#1E56C7" stroke-width="3.5" fill="#fff" stroke-linejoin="round"/>
  <path d="M40 10 V18 H48" stroke="#1E56C7" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
  <path d="M22 28 H38 M22 36 H38 M22 44 H32" stroke="#1E56C7" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="42" cy="46" r="2.6" fill="#F05A1A"/>
  <circle cx="46.5" cy="43.5" r="1.9" fill="#F05A1A"/>
  <circle cx="46.5" cy="48.5" r="1.9" fill="#F05A1A"/>
</svg>`,

  // ❤️ Me gusta → Nariz de gato
  me_gusta: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 26 C27 18, 15 21, 15 30 C15 39, 32 50, 32 50 C32 50, 49 39, 49 30 C49 21, 37 18, 32 26 Z" stroke="#F05A1A" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
</svg>`,

  // ⚡ Entrega rápida → Cola de guepardo con estela
  entrega_rapida: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 34 Q26 22 38 30 Q48 36 54 28" stroke="#F05A1A" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M8 26 Q18 21 26 26" stroke="#F05A1A" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.5"/>
  <circle cx="54" cy="28" r="3" fill="#1E56C7"/>
</svg>`,

  // 📍 Ubicación → Huella en el pin
  ubicacion: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 10 C20 10 12 19 12 29 C12 43 32 56 32 56 C32 56 52 43 52 29 C52 19 44 10 32 10 Z" stroke="#1E56C7" stroke-width="3.5" fill="none"/>
  <circle cx="32" cy="27" r="4.2" fill="#F05A1A"/>
  <circle cx="25" cy="21" r="2.6" fill="#F05A1A"/>
  <circle cx="39" cy="21" r="2.6" fill="#F05A1A"/>
</svg>`,

  // 💬 Chat → Burbuja de diálogo
  chat: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 16 h40 a5 5 0 0 1 5 5 v16 a5 5 0 0 1 -5 5 h-20 l-10 10 v-10 h-10 a5 5 0 0 1 -5 -5 v-16 a5 5 0 0 1 5 -5 Z" stroke="#1E56C7" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
  <circle cx="24" cy="29" r="2.4" fill="#F05A1A"/>
  <circle cx="32" cy="29" r="2.4" fill="#F05A1A"/>
  <circle cx="40" cy="29" r="2.4" fill="#F05A1A"/>
</svg>`,

  // 🔔 Notificaciones → Campana con badge naranja
  notificaciones: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M18 36 C18 24 23 17 32 17 C41 17 46 24 46 36 L50 44 H14 Z" stroke="#1E56C7" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
  <path d="M26 44 a6 6 0 0 0 12 0" stroke="#1E56C7" stroke-width="3" fill="none"/>
  <circle cx="45" cy="18" r="5.5" fill="#F05A1A"/>
</svg>`,

  // ⏳ Esperando → Cola de guepardo enroscada en círculo (loader), naranja con manchas
  esperando: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 10 A22 22 0 1 1 11 36" stroke="#F05A1A" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M11 36 L5 41 L14 43 Z" fill="#F05A1A"/>
  <circle cx="32" cy="10" r="2.6" fill="#C2410C"/>
  <circle cx="49" cy="18" r="2.6" fill="#C2410C"/>
  <circle cx="54" cy="34" r="2.6" fill="#C2410C"/>
  <circle cx="45" cy="48" r="2.6" fill="#C2410C"/>
  <circle cx="27" cy="53" r="2.2" fill="#C2410C"/>
</svg>`,

  // ✅ Entregado → Círculo verde + palomita
  entregado: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="26" fill="#2FAE5C"/>
  <path d="M20 33 L28 41 L45 22" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  // 🎖️ Logro → Placa con huella
  logro: `
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 8 L52 17 V30 C52 44 43 51 32 56 C21 51 12 44 12 30 V17 Z" stroke="#1E56C7" stroke-width="3.5" fill="none" stroke-linejoin="round"/>
  <circle cx="32" cy="29" r="4" fill="#F0B429"/>
  <circle cx="25" cy="23" r="2.6" fill="#F0B429"/>
  <circle cx="39" cy="23" r="2.6" fill="#F0B429"/>
</svg>`,

};

export default GUEPACK_ICONS;
