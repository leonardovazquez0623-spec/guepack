/**
 * GUEPACK Widget
 * Incluir en cualquier página con:
 *   <script src="widget.js?client=CODIGO"></script>
 *
 * El parámetro ?client=CODIGO se guarda en origen_widget del pedido.
 */
(function () {
  'use strict'

  // Leer parámetro client del propio script tag
  var scriptTag = document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script')
      return scripts[scripts.length - 1]
    })()
  var scriptSrc = scriptTag ? scriptTag.src : ''
  var clientCode = ''
  try {
    var u = new URL(scriptSrc)
    clientCode = u.searchParams.get('client') || ''
  } catch (e) {}

  // Base URL del widget (mismo origen que el script)
  var WIDGET_BASE = scriptSrc.replace(/widget\.js.*$/, '') || ''
  var WIDGET_URL = WIDGET_BASE + 'widget.html' + (clientCode ? '?client=' + encodeURIComponent(clientCode) : '')

  // ── Estilos ──────────────────────────────────────────────────────────────
  var style = document.createElement('style')
  style.textContent = [
    '#guepack-fab {',
    '  position: fixed;',
    '  bottom: 24px;',
    '  right: 24px;',
    '  z-index: 99998;',
    '  background: linear-gradient(135deg, #f05a1a 0%, #ff7a3d 100%);',
    '  color: #fff;',
    '  border: none;',
    '  border-radius: 50px;',
    '  padding: 14px 20px;',
    '  font-family: Montserrat, sans-serif;',
    '  font-size: 14px;',
    '  font-weight: 800;',
    '  letter-spacing: 0.5px;',
    '  cursor: pointer;',
    '  box-shadow: 0 4px 20px rgba(240,90,26,0.45);',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  transition: transform .15s, box-shadow .15s;',
    '  white-space: nowrap;',
    '}',
    '#guepack-fab:hover { transform: scale(1.05); box-shadow: 0 6px 28px rgba(240,90,26,0.55); }',
    '#guepack-fab:active { transform: scale(0.97); }',

    '#guepack-overlay {',
    '  display: none;',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 99999;',
    '  background: rgba(10,20,50,0.65);',
    '  backdrop-filter: blur(3px);',
    '  align-items: center;',
    '  justify-content: center;',
    '  animation: gpFadeIn .25s ease;',
    '}',
    '#guepack-overlay.open { display: flex; }',
    '@keyframes gpFadeIn { from { opacity:0; } to { opacity:1; } }',

    '#guepack-modal {',
    '  position: relative;',
    '  width: 100%;',
    '  max-width: 400px;',
    '  height: 90vh;',
    '  max-height: 680px;',
    '  border-radius: 20px;',
    '  overflow: hidden;',
    '  box-shadow: 0 20px 60px rgba(0,0,0,0.4);',
    '  background: #f4f6fb;',
    '  animation: gpSlideUp .3s cubic-bezier(.22,1,.36,1);',
    '}',
    '@keyframes gpSlideUp { from { transform:translateY(40px); opacity:0; } to { transform:translateY(0); opacity:1; } }',

    '#guepack-close {',
    '  position: absolute;',
    '  top: 12px;',
    '  right: 12px;',
    '  z-index: 10;',
    '  width: 30px;',
    '  height: 30px;',
    '  border-radius: 50%;',
    '  background: rgba(255,255,255,0.25);',
    '  border: none;',
    '  color: #fff;',
    '  font-size: 16px;',
    '  line-height: 30px;',
    '  text-align: center;',
    '  cursor: pointer;',
    '  transition: background .2s;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '}',
    '#guepack-close:hover { background: rgba(255,255,255,0.4); }',

    '#guepack-iframe {',
    '  width: 100%;',
    '  height: 100%;',
    '  border: none;',
    '  display: block;',
    '}',

    /* Responsive: en móvil el modal ocupa casi toda la pantalla */
    '@media (max-width: 480px) {',
    '  #guepack-modal {',
    '    max-width: 100%;',
    '    height: 95vh;',
    '    max-height: 95vh;',
    '    border-radius: 20px 20px 0 0;',
    '  }',
    '  #guepack-overlay { align-items: flex-end; }',
    '}'
  ].join('\n')
  document.head.appendChild(style)

  // ── FAB ──────────────────────────────────────────────────────────────────
  var fab = document.createElement('button')
  fab.id = 'guepack-fab'
  fab.innerHTML = '📦 Enviar con GUEPACK'
  fab.setAttribute('aria-label', 'Abrir formulario de envío GUEPACK')
  document.body.appendChild(fab)

  // ── Overlay + modal ───────────────────────────────────────────────────────
  var overlay = document.createElement('div')
  overlay.id = 'guepack-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Solicitar envío GUEPACK')

  var modal = document.createElement('div')
  modal.id = 'guepack-modal'

  var closeBtn = document.createElement('button')
  closeBtn.id = 'guepack-close'
  closeBtn.innerHTML = '✕'
  closeBtn.setAttribute('aria-label', 'Cerrar')

  var iframe = document.createElement('iframe')
  iframe.id = 'guepack-iframe'
  iframe.setAttribute('title', 'GUEPACK – Solicitar envío')
  // El src se asigna al abrir para evitar carga innecesaria
  iframe.src = ''

  modal.appendChild(closeBtn)
  modal.appendChild(iframe)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // ── Lógica ────────────────────────────────────────────────────────────────
  var iframeLoaded = false

  function openWidget() {
    if (!iframeLoaded) {
      iframe.src = WIDGET_URL
      iframeLoaded = true
    }
    overlay.classList.add('open')
    document.body.style.overflow = 'hidden'
    fab.style.display = 'none'
  }

  function closeWidget() {
    overlay.classList.remove('open')
    document.body.style.overflow = ''
    fab.style.display = ''
  }

  fab.addEventListener('click', openWidget)
  closeBtn.addEventListener('click', closeWidget)

  // Cerrar al hacer click fuera del modal
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeWidget()
  })

  // Cerrar con Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeWidget()
  })

  // Escuchar mensaje del iframe cuando se envía un pedido
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'guepack-pedido-enviado') {
      // El pedido fue creado — se puede reaccionar aquí si es necesario
      // Por defecto solo lo registramos en consola
      console.log('[GUEPACK] Pedido enviado:', e.data.folio, '| ID:', e.data.pedidoId)
    }
  })
})()
