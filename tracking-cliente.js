// tracking-cliente.js
// Depende de: db (global de rastreo.html), MAPBOX_TOKEN (de config.js)

let _mapa            = null
let _marcador        = null
let _channelTracking = null

function iniciarMapaTracking(pedidoId, contenedorId) {
  contenedorId = contenedorId || 'mapa-tracking'
  if (!MAPBOX_TOKEN) { console.warn('[tracking-cli] MAPBOX_TOKEN no definido'); return }

  mapboxgl.accessToken = MAPBOX_TOKEN

  _mapa = new mapboxgl.Map({
    container: contenedorId,
    style:     'mapbox://styles/mapbox/streets-v12',
    center:    [-103.3496, 20.6597], // Guadalajara
    zoom:      14
  })

  _mapa.addControl(new mapboxgl.NavigationControl(), 'top-right')

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
  const coords = [lng, lat]

  // Mostrar el card del mapa si estaba oculto
  const card = document.getElementById('mapa-tracking-card')
  if (card) card.style.display = 'block'

  if (!_marcador) {
    const el = document.createElement('div')
    el.style.cssText = [
      'width:38px', 'height:38px',
      'background:var(--orange)',
      'border-radius:50%',
      'border:3px solid white',
      'box-shadow:0 2px 14px rgba(240,90,26,0.55)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:18px', 'cursor:default'
    ].join(';')
    el.textContent = '🏍️'
    el.title = 'Tu repartidor'

    _marcador = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(coords)
      .addTo(_mapa)
  } else {
    _marcador.setLngLat(coords)
  }

  if (heading !== null && heading !== undefined) {
    _marcador.setRotation(heading)
  }

  _mapa.easeTo({ center: coords, duration: 800 })
}

function detenerMapaTracking() {
  if (_channelTracking) {
    db.removeChannel(_channelTracking)
    _channelTracking = null
  }
  if (_mapa) {
    _mapa.remove()
    _mapa    = null
    _marcador = null
  }
}
