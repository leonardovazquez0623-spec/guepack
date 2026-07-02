// tracking-cliente.js — usa Google Maps JS API
// Depende de: db (global de rastreo.html), Google Maps cargado en rastreo.html

let _mapa            = null
let _marcador        = null
let _channelTracking = null
let _DriverOverlay   = null  // clase definida lazy tras confirmar Maps cargado

// ── Clase OverlayView (se crea una sola vez, cuando Maps ya está disponible) ─
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

// ── CSS del marcador y pulso (inyectado una sola vez en <head>) ──────────────
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

// ── Funciones públicas ───────────────────────────────────────────────────────

function iniciarMapaTracking(pedidoId, contenedorId) {
  contenedorId = contenedorId || 'mapa-tracking'

  if (!window.google?.maps) {
    setTimeout(() => iniciarMapaTracking(pedidoId, contenedorId), 150)
    return
  }

  _inyectarEstilosOverlay()
  _ensureOverlayClass()

  const el = document.getElementById(contenedorId)
  if (!el) { console.warn('[tracking-cli] contenedor no encontrado:', contenedorId); return }

  _mapa = new google.maps.Map(el, {
    center:           { lat: 20.6597, lng: -103.3496 },
    zoom:             15,
    disableDefaultUI: true,
    zoomControl:      true,
    gestureHandling:  'cooperative'
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
  const card = document.getElementById('mapa-tracking-card')
  if (card) card.style.display = 'block'

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
