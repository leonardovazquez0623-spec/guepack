// tracking-cliente.js — usa Google Maps JS API
// Depende de: db (global de rastreo.html), Google Maps cargado en rastreo.html

let _mapa            = null
let _marcador        = null
let _channelTracking = null

function iniciarMapaTracking(pedidoId, contenedorId) {
  contenedorId = contenedorId || 'mapa-tracking'

  if (!window.google?.maps) {
    setTimeout(() => iniciarMapaTracking(pedidoId, contenedorId), 150)
    return
  }

  const el = document.getElementById(contenedorId)
  if (!el) { console.warn('[tracking-cli] contenedor no encontrado:', contenedorId); return }

  _mapa = new google.maps.Map(el, {
    center:          { lat: 20.6597, lng: -103.3496 },
    zoom:            15,
    disableDefaultUI: true,
    zoomControl:     true,
    gestureHandling: 'cooperative'
  })

  _cargarPosicionInicial(pedidoId)
  _suscribirTracking(pedidoId)
}

async function _cargarPosicionInicial(pedidoId) {
  const { data } = await db.from('driver_locations')
    .select('lat, lng, heading')
    .eq('pedido_id', pedidoId)
    .maybeSingle()

  if (data?.lat && data?.lng) {
    _actualizarMarcador(data.lat, data.lng, data.heading)
    console.log('[tracking-cli] posición inicial cargada:', data.lat, data.lng)
  } else {
    console.log('[tracking-cli] sin posición inicial — esperando Realtime')
  }
}

function _suscribirTracking(pedidoId) {
  _channelTracking = db.channel('tracking-' + pedidoId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'driver_locations',
      filter: 'pedido_id=eq.' + pedidoId
    }, payload => {
      const row = payload.new
      if (!row?.lat || !row?.lng) return
      console.log('[tracking-cli] actualización Realtime:', row.lat, row.lng)
      _actualizarMarcador(row.lat, row.lng, row.heading)
    })
    .subscribe(status => {
      console.log('[tracking-cli] Realtime status:', status)
    })
}

function _actualizarMarcador(lat, lng, heading) {
  const pos = { lat, lng }

  const card = document.getElementById('mapa-tracking-card')
  if (card) card.style.display = 'block'

  if (!_marcador) {
    _marcador = new google.maps.Marker({
      position: pos,
      map:      _mapa,
      title:    'Tu repartidor',
      icon: {
        path:        google.maps.SymbolPath.CIRCLE,
        scale:       12,
        fillColor:   '#f05a1a',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 3
      }
    })
  } else {
    _marcador.setPosition(pos)
  }

  _mapa.panTo(pos)
}

function detenerMapaTracking() {
  if (_channelTracking) {
    db.removeChannel(_channelTracking)
    _channelTracking = null
  }
  if (_marcador) {
    _marcador.setMap(null)
    _marcador = null
  }
  _mapa = null
}
