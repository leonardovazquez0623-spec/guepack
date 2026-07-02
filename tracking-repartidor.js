// tracking-repartidor.js
// Depende de: db (global de repartidor.html)

let _watchId        = null
let _trackingPedido = null
let _trackingDriver = null

function iniciarTracking(pedidoId, driverId) {
  if (!navigator.geolocation) {
    console.warn('[tracking-repa] geolocation no disponible en este dispositivo')
    return
  }
  if (_watchId !== null) detenerTracking()

  _trackingPedido = pedidoId
  _trackingDriver = driverId

  _watchId = navigator.geolocation.watchPosition(
    _onPosicion,
    _onErrorPosicion,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  )
  console.log('[tracking-repa] iniciado — pedido:', pedidoId, '| driver:', driverId)
}

function detenerTracking() {
  if (_watchId === null) return
  navigator.geolocation.clearWatch(_watchId)
  _watchId = null
  _trackingPedido = null
  _trackingDriver = null
  console.log('[tracking-repa] detenido')
}

async function _onPosicion(pos) {
  const { latitude: lat, longitude: lng, heading } = pos.coords
  console.log('[tracking-repa] posición:', lat.toFixed(5), lng.toFixed(5), '| heading:', heading)

  const { error } = await db.from('driver_locations').upsert({
    pedido_id:  _trackingPedido,
    driver_id:  _trackingDriver,
    lat,
    lng,
    heading:    heading ?? null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'pedido_id' })

  if (error) console.error('[tracking-repa] error guardando posición:', error.message)
}

function _onErrorPosicion(err) {
  const msgs = {
    1: 'Permiso de ubicación denegado',
    2: 'Posición no disponible',
    3: 'Tiempo de espera agotado'
  }
  console.warn('[tracking-repa] error geolocation:', msgs[err.code] || err.message)
}
