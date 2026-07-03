// tracking-cliente.js — usa Google Maps JS API
// Depende de: db (global de rastreo.html), Google Maps cargado en rastreo.html

let _mapa            = null
let _marcador        = null
let _channelTracking = null
let _DriverOverlay   = null
let _latEntrega      = null
let _lngEntrega      = null

// ── Haversine ────────────────────────────────────────────────────────────────
function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
              + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
              * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Clase OverlayView (lazy, se crea cuando Maps ya está disponible) ─────────
function _ensureOverlayClass() {
  if (_DriverOverlay) return
  _DriverOverlay = class extends google.maps.OverlayView {
    constructor(map, lat, lng, heading) {
      super()
      this._position = new google.maps.LatLng(lat, lng)
      this._heading  = heading ?? 0
      this._el       = null
      this._img      = null
      this.setMap(map)
    }

    onAdd() {
      const el = document.createElement('div')
      el.className = 'driver-overlay'

      const halo = document.createElement('div')
      halo.className = 'driver-halo'

      const img = document.createElement('img')
      img.className = 'driver-icon'
      img.src = 'maps_cat.png'
      img.alt = ''

      el.appendChild(halo)
      el.appendChild(img)
      this._el  = el
      this._img = img

      this.getPanes().overlayLayer.appendChild(el)
    }

    draw() {
      if (!this._el) return
      const p = this.getProjection().fromLatLngToDivPixel(this._position)
      this._el.style.left = p.x + 'px'
      this._el.style.top  = p.y + 'px'
      this._img.style.transform = `translate(-50%, -50%) rotate(${this._heading}deg)`
    }

    onRemove() {
      if (this._el?.parentNode) this._el.parentNode.removeChild(this._el)
      this._el  = null
      this._img = null
    }

    setPosition(lat, lng, heading) {
      this._position = new google.maps.LatLng(lat, lng)
      if (heading != null) this._heading = heading
      this.draw()
    }
  }
}

// ── CSS del marcador y pulso ─────────────────────────────────────────────────
function _inyectarEstilosOverlay() {
  if (document.getElementById('driver-overlay-styles')) return
  const s = document.createElement('style')
  s.id = 'driver-overlay-styles'
  s.textContent = `
    .driver-overlay {
      position: absolute;
      width: 0; height: 0;
      pointer-events: none;
    }
    .driver-halo {
      position: absolute;
      width: 52px; height: 52px;
      border-radius: 50%;
      background: rgba(240, 90, 26, 0.38);
      top: 50%; left: 50%;
      transform: translate(-50%, -50%) scale(1);
      animation: driver-pulse 1.9s ease-out infinite;
    }
    .driver-icon {
      position: absolute;
      width: 38px; height: 38px;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(0deg);
      transform-origin: center center;
      transition: transform 0.25s ease;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.32));
    }
    @keyframes driver-pulse {
      0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.75; }
      65%  { transform: translate(-50%, -50%) scale(2.9); opacity: 0; }
      100% { transform: translate(-50%, -50%) scale(1);   opacity: 0; }
    }
  `
  document.head.appendChild(s)
}

// ── Card "en camino" (se inyecta una vez antes de mapa-tracking-card) ────────
function _asegurarCardEnCamino() {
  if (document.getElementById('camino-tracking-card')) return
  const mapaCard = document.getElementById('mapa-tracking-card')
  if (!mapaCard) return
  const card = document.createElement('div')
  card.id = 'camino-tracking-card'
  card.className = 'card'
  card.style.display = 'none'
  card.innerHTML = `
    <div style="text-align:center;padding:20px 12px">
      <div style="font-size:36px;margin-bottom:12px">🚚</div>
      <div style="font-family:Montserrat,sans-serif;font-weight:900;font-size:15px;color:var(--blue);margin-bottom:6px">Tu repartidor va en camino</div>
      <div style="font-family:Montserrat,sans-serif;font-size:12px;font-weight:600;color:var(--gray-mid);line-height:1.5">El mapa aparecerá cuando el repartidor<br>esté cerca de tu domicilio</div>
    </div>
  `
  mapaCard.insertAdjacentElement('beforebegin', card)
}

// ── Funciones públicas ───────────────────────────────────────────────────────

function iniciarMapaTracking(pedidoId, latEntrega, lngEntrega, contenedorId) {
  contenedorId = contenedorId || 'mapa-tracking'

  if (!window.google?.maps) {
    setTimeout(() => iniciarMapaTracking(pedidoId, latEntrega, lngEntrega, contenedorId), 150)
    return
  }

  _inyectarEstilosOverlay()
  _ensureOverlayClass()
  _latEntrega = latEntrega ?? null
  _lngEntrega = lngEntrega ?? null
  _asegurarCardEnCamino()

  _cargarPosicionInicial(pedidoId, contenedorId)
  _suscribirTracking(pedidoId, contenedorId)
}

async function _cargarPosicionInicial(pedidoId, contenedorId) {
  const { data } = await db.from('driver_locations')
    .select('lat, lng, heading')
    .eq('pedido_id', pedidoId)
    .maybeSingle()

  if (data?.lat && data?.lng) {
    _evaluarProximidad(data.lat, data.lng, data.heading, contenedorId)
    console.log('[tracking-cli] posición inicial cargada:', data.lat, data.lng)
  } else {
    console.log('[tracking-cli] sin posición inicial — esperando Realtime')
  }
}

function _suscribirTracking(pedidoId, contenedorId) {
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
      _evaluarProximidad(row.lat, row.lng, row.heading, contenedorId)
    })
    .subscribe(status => {
      console.log('[tracking-cli] Realtime status:', status)
    })
}

function _evaluarProximidad(lat, lng, heading, contenedorId) {
  const dbg = document.getElementById('debug-tracking')

  // Pedidos sin coords guardadas → mostrar mapa directo (comportamiento anterior)
  if (_latEntrega == null || _lngEntrega == null) {
    if (dbg) dbg.innerHTML =
      '🚚 Driver: ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '<br>' +
      '📍 Entrega: sin coords (fallback)'
    _mostrarMapa(lat, lng, heading, contenedorId)
    return
  }
  const dist = calcularDistanciaKm(lat, lng, _latEntrega, _lngEntrega)
  console.log('[tracking-cli] distancia a entrega:', dist.toFixed(3), 'km')
  if (dbg) dbg.innerHTML =
    '🚚 Driver: ' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '<br>' +
    '📍 Entrega: ' + _latEntrega.toFixed(6) + ', ' + _lngEntrega.toFixed(6) + '<br>' +
    '📏 Distancia: ' + dist.toFixed(3) + ' km ' + (dist <= 1 ? '✅ MAPA' : '🟡 EN CAMINO')
  if (dist <= 1) {
    _mostrarMapa(lat, lng, heading, contenedorId)
  } else {
    _mostrarEnCamino()
  }
}

function _mostrarMapa(lat, lng, heading, contenedorId) {
  const mapaCard   = document.getElementById('mapa-tracking-card')
  const caminoCard = document.getElementById('camino-tracking-card')
  if (mapaCard)   mapaCard.style.display   = 'block'
  if (caminoCard) caminoCard.style.display = 'none'

  if (!_mapa) {
    const el = document.getElementById(contenedorId || 'mapa-tracking')
    if (!el) return
    _mapa = new google.maps.Map(el, {
      center:           { lat, lng },
      zoom:             15,
      disableDefaultUI: true,
      zoomControl:      true,
      gestureHandling:  'cooperative'
    })
  }

  _actualizarMarcador(lat, lng, heading)
}

function _mostrarEnCamino() {
  const mapaCard   = document.getElementById('mapa-tracking-card')
  const caminoCard = document.getElementById('camino-tracking-card')
  if (mapaCard)   mapaCard.style.display   = 'none'
  if (caminoCard) caminoCard.style.display = 'block'
}

function _actualizarMarcador(lat, lng, heading) {
  if (!_marcador) {
    _marcador = new _DriverOverlay(_mapa, lat, lng, heading)
  } else {
    _marcador.setPosition(lat, lng, heading)
  }
  _mapa.panTo({ lat, lng })
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
