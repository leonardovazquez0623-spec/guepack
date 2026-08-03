/**
 * gps-tracker.js — GUEPACK
 *
 * Resuelve: "cierro y abro la app y ya no toma ubicación hasta que refresco".
 * Causa real: al volver de background el watchPosition quedó muerto y nadie lo revive
 * (bfcache en iOS, congelamiento de timers en Android). No es falta de permisos.
 *
 * NO hace tracking en segundo plano — eso no existe en PWA. Lo que hace es:
 *   - reanudar el watch en cuanto la app vuelve a primer plano (sin refrescar)
 *   - mantener la pantalla encendida mientras hay ruta activa (Wake Lock)
 *   - detectar watches muertos con un watchdog y relanzarlos
 *   - reportar fix_at real del GPS, no now(), para no mentirle al semáforo del admin
 *
 * Uso:
 *   const tracker = crearTracker({
 *     onFix: async (fix) => { ...tu upsert a Supabase... },
 *     onEstado: (e) => { ...pintar banner... }
 *   });
 *   tracker.iniciar();   // al aceptar/entrar a ruta
 *   tracker.detener();   // al terminar la ruta o cerrar sesión
 */

const CFG = {
  MIN_INTERVALO_MS: 15000,   // no mandar más seguido que esto
  MIN_DISTANCIA_M: 25,       // ni si no se movió (ahorra batería y writes)
  FIX_RANCIO_MS: 60000,      // sin fix en 60s => el watch está muerto
  WATCHDOG_MS: 20000,
  MAX_ACCURACY_M: 100,       // descartar fixes muy imprecisos
  TIMEOUT_MS: 20000,
};

export function crearTracker({ onFix, onEstado = () => {} } = {}) {
  let watchId = null;
  let wakeLock = null;
  let watchdog = null;
  let activo = false;

  let ultimoFixMs = 0;      // cuándo llegó el último fix del navegador
  let ultimoEnvio = null;   // { lat, lng, ms } del último upsert exitoso

  const estado = (tipo, msg, detalle = {}) => onEstado({ tipo, msg, activo, ...detalle });

  // ---------- utilidades ----------
  function metros(a, b) {
    const R = 6371000, toRad = g => g * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function valeLaPenaEnviar(lat, lng) {
    if (!ultimoEnvio) return true;
    const dt = Date.now() - ultimoEnvio.ms;
    if (dt >= CFG.MIN_INTERVALO_MS * 4) return true;          // heartbeat aunque no se mueva
    if (dt < CFG.MIN_INTERVALO_MS) return false;
    return metros(ultimoEnvio, { lat, lng }) >= CFG.MIN_DISTANCIA_M;
  }

  // ---------- callbacks del navegador ----------
  async function onPos(pos) {
    ultimoFixMs = Date.now();
    const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords;
    const fixAt = new Date(pos.timestamp);

    estado('fix', 'Fix GPS recibido', { fix_at: fixAt });

    if (accuracy != null && accuracy > CFG.MAX_ACCURACY_M) {
      estado('debil', `Señal GPS imprecisa (±${Math.round(accuracy)} m)`);
      return;
    }
    estado('ok', 'Reportando ubicación');

    if (!valeLaPenaEnviar(lat, lng)) return;

    try {
      // fix_at = timestamp del GPS. Si el navegador entrega una posición cacheada,
      // el admin tiene que verla como vieja, no como fresca.
      await onFix({ lat, lng, heading, accuracy, fix_at: fixAt });
      ultimoEnvio = { lat, lng, ms: Date.now() };
    } catch (e) {
      console.warn('[gps] falló el envío, se reintenta en el próximo fix', e);
    }
  }

  function onErr(err) {
    if (err.code === err.PERMISSION_DENIED) {
      detener();
      estado('sin-permiso', 'Activa el permiso de ubicación para poder repartir');
      return;
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
      estado('debil', 'Sin señal GPS por ahora');
      return;
    }
    estado('debil', 'Buscando señal GPS…'); // TIMEOUT
  }

  // ---------- watch ----------
  function iniciarWatch() {
    if (!('geolocation' in navigator)) {
      estado('sin-soporte', 'Este navegador no soporta ubicación');
      return;
    }
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: CFG.TIMEOUT_MS,
    });

    // El watch puede tardar en emitir el primero. Este disparo evita el hueco
    // de 20s al volver de background, que es justo lo que se sentía como "no toma nada".
    navigator.geolocation.getCurrentPosition(onPos, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 10000,
    });
  }

  // ---------- wake lock ----------
  async function pedirWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {
      // batería baja o el SO lo negó — no es fatal
    }
  }

  async function soltarWakeLock() {
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
  }

  // ---------- reanudación ----------
  function reanudar(motivo) {
    if (!activo) return;
    console.debug('[gps] reanudando:', motivo);
    estado('reanudado', `GPS reanudado: ${motivo}`, { motivo });
    iniciarWatch();
    pedirWakeLock();
  }

  // App vuelve a primer plano (cambio de pestaña, desbloqueo de pantalla)
  const hVisibility = () => {
    if (document.visibilityState === 'visible') reanudar('visibilitychange');
  };

  // iOS: la página se restaura desde bfcache al volver de otra app.
  // Sin esto es cuando el usuario "tiene que refrescar".
  const hPageshow = (e) => { if (e.persisted) reanudar('bfcache'); };

  // Android/Chrome congela la página antes de descartarla
  const hResume = () => reanudar('visibilitychange');

  // Recuperar conexión: puede haber fixes que no se subieron
  const hOnline = () => reanudar('online');

  function armarWatchdog() {
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (!activo || document.visibilityState !== 'visible') return;
      if (Date.now() - ultimoFixMs > CFG.FIX_RANCIO_MS) {
        reanudar('watchdog');
      }
    }, CFG.WATCHDOG_MS);
  }

  // ---------- API pública ----------
  function iniciar() {
    if (activo) return;
    activo = true;
    ultimoFixMs = Date.now();

    document.addEventListener('visibilitychange', hVisibility);
    window.addEventListener('pageshow', hPageshow);
    window.addEventListener('resume', hResume);
    window.addEventListener('online', hOnline);

    iniciarWatch();
    pedirWakeLock();
    armarWatchdog();
    estado('ok', 'Reportando ubicación');
  }

  function detener() {
    activo = false;
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    clearInterval(watchdog);
    soltarWakeLock();

    document.removeEventListener('visibilitychange', hVisibility);
    window.removeEventListener('pageshow', hPageshow);
    window.removeEventListener('resume', hResume);
    window.removeEventListener('online', hOnline);
    estado('detenido', 'Ubicación detenida');
  }

  return { iniciar, detener, reanudar: () => reanudar('manual'), get activo() { return activo; } };
}

/* ------------------------------------------------------------------
   Integración en repartidor.html — reemplaza el watchPosition actual
   de tracking-repartidor.js por esto:

   import { crearTracker } from './gps-tracker.js';

   const tracker = crearTracker({
     onFix: async ({ lat, lng, heading, accuracy, fix_at }) => {
       // Paso 1: se mantiene el upsert que ya tienes por pedido_id
       await supabase.from('driver_locations').upsert({
         pedido_id: pedidoActivoId,
         driver_id: session.user.id,
         lat, lng, heading,
         updated_at: fix_at.toISOString()
       }, { onConflict: 'pedido_id' });

       // Paso 2 (cuando exista repartidor_ubicacion) se agrega aquí el
       // segundo upsert con fix_at, y el panel admin ya ve a los libres.
     },
     onEstado: ({ tipo, msg }) => {
       const b = document.getElementById('gpsBanner');
       b.textContent = msg;
       b.dataset.tipo = tipo;          // ok | debil | sin-permiso | detenido
       b.hidden = (tipo === 'ok');
     }
   });

   tracker.iniciar();   // al aceptar ruta
   tracker.detener();   // al terminar o cerrar sesión
------------------------------------------------------------------- */
