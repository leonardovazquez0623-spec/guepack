// tracking-repartidor.js
// Depende de: db (global de repartidor.html)

let _tracker        = null
let _trackerPromise = null
let _trackingActivo = false
let _trackingPedido = null
let _trackingDriver = null

window.__gpsDebug = window.__gpsDebug || {
  ultimoFixAt: null,
  envios: 0,
  reanudo: '—'
}

function _cargarTracker() {
  if (_trackerPromise) return _trackerPromise

  _trackerPromise = import('./gps-tracker.js')
    .then(({ crearTracker }) => {
      _tracker = crearTracker({
        onFix: _onPosicion,
        onEstado: ({ fix_at, motivo }) => {
          if (fix_at) window.__gpsDebug.ultimoFixAt = fix_at.getTime()
          if (motivo) window.__gpsDebug.reanudo = motivo
        }
      })
      return _tracker
    })
    .catch(error => {
      _trackerPromise = null
      console.error('[tracking-repa] no se pudo cargar gps-tracker.js:', error)
      throw error
    })

  return _trackerPromise
}

function iniciarTracking(pedidoId, driverId) {
  if (!navigator.geolocation) {
    console.warn('[tracking-repa] geolocation no disponible en este dispositivo')
    return
  }
  if (_trackingActivo) _tracker?.detener()

  _trackingPedido = pedidoId
  _trackingDriver = driverId
  _trackingActivo = true

  _cargarTracker()
    .then(tracker => {
      if (_trackingActivo) tracker.iniciar()
    })
    .catch(() => {})
  console.log('[tracking-repa] iniciado — pedido:', pedidoId, '| driver:', driverId)
}

function detenerTracking() {
  if (!_trackingActivo) return
  _trackingActivo = false
  _tracker?.detener()
  _trackingPedido = null
  _trackingDriver = null
  console.log('[tracking-repa] detenido')
}

async function _onPosicion({ lat, lng, heading, fix_at }) {
  console.log('[tracking-repa] posición:', lat.toFixed(5), lng.toFixed(5), '| heading:', heading)

  const { error } = await db.from('driver_locations').upsert({
    pedido_id:  _trackingPedido,
    driver_id:  _trackingDriver,
    lat,
    lng,
    heading:    heading ?? null,
    updated_at: fix_at.toISOString()
  }, { onConflict: 'pedido_id' })

  if (error) {
    console.error('[tracking-repa] error guardando posición:', error.message)
    throw error
  }

  window.__gpsDebug.envios++
}
