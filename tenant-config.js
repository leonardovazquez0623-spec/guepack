(function () {
  'use strict'

  const SUPABASE_URL_TENANT = 'https://zkrnjdsnuyjaxxnluzmn.supabase.co'
  const SUPABASE_KEY_TENANT = 'sb_publishable_nde3IHFs-CJqqY0w5gV77g_FbtKtH7z'
  const imagenesPredeterminadas = {
    bienvenida: '/enviar_g.png',
    encamino: '/encamino_g.png',
    recolectado: '/recolectado_g.png',
    transito: '/transito_g.png',
    entregado: '/entregado_g.png',
    soporte: '/soporte_g.png'
  }
  window.tenantConfig = null
  window.tenantConfigEstado = Object.freeze({
    estado: 'cargando',
    error: null
  })
  window.tenantImages = { ...imagenesPredeterminadas }

  function normalizarSlug(valor) {
    return String(valor || '').trim().toLowerCase()
  }

  function normalizarDominio(valor) {
    let dominio = String(valor || '')
      .trim()
      .toLowerCase()
      .replace(/\.$/, '')

    if (dominio.startsWith('www.')) dominio = dominio.slice(4)
    return dominio
  }

  function crearErrorTenant(mensaje, datos = {}) {
    const error = new Error(mensaje)
    error.code = datos.code || null
    error.details = datos.details || null
    error.hint = datos.hint || null
    error.status = datos.status || null
    return error
  }

  function mostrarErrorConfiguracionTenant() {
    const montarMensaje = () => {
      if (!document.body || document.getElementById('tenant-config-error')) return

      const contenedor = document.createElement('div')
      contenedor.id = 'tenant-config-error'
      contenedor.setAttribute('role', 'alert')
      contenedor.setAttribute('aria-live', 'assertive')
      contenedor.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
        'background:#0e3070',
        'color:#fff',
        'font-family:Montserrat,Arial,sans-serif',
        'text-align:center'
      ].join(';')

      const contenido = document.createElement('div')
      contenido.style.cssText = 'max-width:440px'

      const titulo = document.createElement('h1')
      titulo.textContent = 'No pudimos cargar esta empresa'
      titulo.style.cssText = 'font-size:22px;margin:0 0 12px'

      const texto = document.createElement('p')
      texto.textContent = 'Revisa tu conexión e inténtalo nuevamente. Si el problema continúa, contacta a soporte.'
      texto.style.cssText = 'font-size:14px;line-height:1.6;margin:0 0 20px'

      const reintentar = document.createElement('button')
      reintentar.type = 'button'
      reintentar.textContent = 'Reintentar'
      reintentar.style.cssText = [
        'border:0',
        'border-radius:10px',
        'padding:12px 20px',
        'background:#f05a1a',
        'color:#fff',
        'font-weight:800',
        'cursor:pointer'
      ].join(';')
      reintentar.addEventListener('click', () => window.location.reload())

      contenido.append(titulo, texto, reintentar)
      contenedor.appendChild(contenido)
      document.body.appendChild(contenedor)
    }

    if (document.body) montarMensaje()
    else window.addEventListener('DOMContentLoaded', montarMensaje, { once: true })
  }

  function registrarFalloTenant(error) {
    const detalle = Object.freeze({
      message: error?.message || 'Error desconocido',
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null,
      status: error?.status || null
    })

    console.error('[tenant] No se pudo resolver la configuración:', detalle)

    window.tenantConfig = null
    window.tenantConfigEstado = Object.freeze({
      estado: 'error',
      error: detalle
    })
    window.tenantImages = { ...imagenesPredeterminadas }

    try {
      sessionStorage.removeItem('tenant_config')
      sessionStorage.removeItem('tenant_images')
    } catch (_) {}

    mostrarErrorConfiguracionTenant()
    window.dispatchEvent(new CustomEvent('tenant-config-error', { detail: detalle }))
  }

  function esColorHexadecimal(valor) {
    return /^#[0-9a-f]{6}$/i.test(String(valor || ''))
  }

  function hexadecimalAHsl(color) {
    const hexadecimal = color.replace('#', '')
    const rojo = parseInt(hexadecimal.slice(0, 2), 16) / 255
    const verde = parseInt(hexadecimal.slice(2, 4), 16) / 255
    const azul = parseInt(hexadecimal.slice(4, 6), 16) / 255
    const maximo = Math.max(rojo, verde, azul)
    const minimo = Math.min(rojo, verde, azul)
    const diferencia = maximo - minimo
    let tono = 0
    const luminosidad = (maximo + minimo) / 2

    if (diferencia !== 0) {
      if (maximo === rojo) tono = ((verde - azul) / diferencia) % 6
      else if (maximo === verde) tono = (azul - rojo) / diferencia + 2
      else tono = (rojo - verde) / diferencia + 4
      tono = Math.round(tono * 60)
      if (tono < 0) tono += 360
    }

    const saturacion = diferencia === 0 ? 0 : diferencia / (1 - Math.abs(2 * luminosidad - 1))
    return { tono, saturacion: saturacion * 100, luminosidad: luminosidad * 100 }
  }

  function hslAHexadecimal(tono, saturacion, luminosidad) {
    const s = Math.max(0, Math.min(100, saturacion)) / 100
    const l = Math.max(0, Math.min(100, luminosidad)) / 100
    const croma = (1 - Math.abs(2 * l - 1)) * s
    const componente = croma * (1 - Math.abs(((tono / 60) % 2) - 1))
    const ajuste = l - croma / 2
    let rojo = 0
    let verde = 0
    let azul = 0

    if (tono < 60) [rojo, verde, azul] = [croma, componente, 0]
    else if (tono < 120) [rojo, verde, azul] = [componente, croma, 0]
    else if (tono < 180) [rojo, verde, azul] = [0, croma, componente]
    else if (tono < 240) [rojo, verde, azul] = [0, componente, croma]
    else if (tono < 300) [rojo, verde, azul] = [componente, 0, croma]
    else [rojo, verde, azul] = [croma, 0, componente]

    const canalHexadecimal = canal => Math.round((canal + ajuste) * 255).toString(16).padStart(2, '0')
    return `#${canalHexadecimal(rojo)}${canalHexadecimal(verde)}${canalHexadecimal(azul)}`
  }

  function darkenColor(color, porcentaje) {
    if (!esColorHexadecimal(color)) return color
    const hsl = hexadecimalAHsl(color)
    const luminosidad = hsl.luminosidad * (1 - Math.max(0, Math.min(100, porcentaje)) / 100)
    return hslAHexadecimal(hsl.tono, hsl.saturacion, luminosidad)
  }

  function lightenColor(color, porcentaje) {
    if (!esColorHexadecimal(color)) return color
    const hsl = hexadecimalAHsl(color)
    const proporcion = Math.max(0, Math.min(100, porcentaje)) / 100
    const luminosidad = hsl.luminosidad + (100 - hsl.luminosidad) * proporcion
    return hslAHexadecimal(hsl.tono, hsl.saturacion, luminosidad)
  }

  function obtenerSlugSolicitado() {
    const parametros = new URLSearchParams(window.location.search)
    const slugParametro = normalizarSlug(parametros.get('tenant') || parametros.get('slug'))
    if (slugParametro) return slugParametro

    const dominio = normalizarDominio(window.location.hostname)
    if (dominio.endsWith('.guepack.com')) {
      const subdominio = dominio.slice(0, -'.guepack.com'.length)
      if (subdominio) return normalizarSlug(subdominio)
    }
    return null
  }

  function urlSegura(valor) {
    try {
      const url = new URL(valor, window.location.origin)
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null
    } catch (_) {
      return null
    }
  }

  function applyTenantTheme(tenant) {
    if (!tenant?.id || !tenant?.slug || !tenant?.dominio) {
      throw crearErrorTenant('CONFIGURACION_TENANT_INCOMPLETA', {
        code: 'CONFIGURACION_TENANT_INCOMPLETA'
      })
    }

    window.tenantConfig = tenant
    window.tenantConfigEstado = Object.freeze({
      estado: 'listo',
      tenant_id: tenant.id,
      error: null
    })
    const raiz = document.documentElement

    if (esColorHexadecimal(tenant.color_primario)) {
      const primarioOscuro = darkenColor(tenant.color_primario, 20)
      const primarioClaro = lightenColor(tenant.color_primario, 85)
      raiz.style.setProperty('--color-primary', tenant.color_primario)
      raiz.style.setProperty('--color-primary-dark', primarioOscuro)
      raiz.style.setProperty('--color-primary-light', primarioClaro)
      raiz.style.setProperty('--blue', tenant.color_primario)
      raiz.style.setProperty('--blue-dark', primarioOscuro)
      raiz.style.setProperty('--blue-light', lightenColor(tenant.color_primario, 20))
      raiz.style.setProperty('--text', primarioOscuro)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primarioOscuro)
    }
    if (esColorHexadecimal(tenant.color_secundario)) {
      const secundarioOscuro = darkenColor(tenant.color_secundario, 20)
      const secundarioClaro = lightenColor(tenant.color_secundario, 85)
      raiz.style.setProperty('--color-secondary', tenant.color_secundario)
      raiz.style.setProperty('--color-secondary-dark', secundarioOscuro)
      raiz.style.setProperty('--color-secondary-light', secundarioClaro)
      raiz.style.setProperty('--orange', tenant.color_secundario)
      raiz.style.setProperty('--orange-light', lightenColor(tenant.color_secundario, 20))
    }

    window.tenantImages = {
      bienvenida: tenant.img_bienvenida || '/enviar_g.png',
      encamino: tenant.img_encamino || '/encamino_g.png',
      recolectado: tenant.img_recolectado || '/recolectado_g.png',
      transito: tenant.img_transito || '/transito_g.png',
      entregado: tenant.img_entregado || '/entregado_g.png',
      soporte: tenant.img_soporte || '/soporte_g.png'
    }
    aplicarImagenesEnDocumento()

    if (tenant.nombre) document.title = tenant.nombre

    const favicon = urlSegura(tenant.favicon_url)
    if (favicon) {
      const enlaceFavicon = document.querySelector("link[rel='icon']") || document.createElement('link')
      enlaceFavicon.rel = 'icon'
      enlaceFavicon.href = favicon
      document.head.appendChild(enlaceFavicon)
    }

    const logo = urlSegura(tenant.logo_url)
    if (logo) {
      document.querySelectorAll('[data-tenant-logo], img[src*="logo_principal"]').forEach(imagen => {
        imagen.src = logo
        imagen.alt = tenant.nombre_app || tenant.nombre || 'Logo'
      })
    }

    try {
      sessionStorage.setItem('tenant_config', JSON.stringify(tenant))
      sessionStorage.setItem('tenant_images', JSON.stringify(window.tenantImages))
    } catch (error) {
      console.warn('No se pudo guardar la configuración del tenant en la sesión:', error)
    }
    window.dispatchEvent(new CustomEvent('tenant-config-aplicada', { detail: tenant }))
    window.dispatchEvent(new Event('tenantLoaded'))
  }

  function aplicarImagenesEnDocumento() {
    document.querySelectorAll('[data-tenant-image]').forEach(imagen => {
      const nombre = imagen.dataset.tenantImage
      const origen = window.tenantImages?.[nombre]
      if (origen) imagen.src = origen
      imagen.classList.toggle('tenant-image-uploaded', Boolean(origen && origen !== imagenesPredeterminadas[nombre]))
    })
  }

  async function consultarTenant(identificador) {
    const columna = identificador.tipo === 'dominio' ? 'dominio' : 'slug'
    const valor = identificador.tipo === 'dominio'
      ? normalizarDominio(identificador.valor)
      : normalizarSlug(identificador.valor)

    const consulta = new URLSearchParams({
      select: 'id,nombre,slug,dominio,plan,tipo,logo_url,favicon_url,color_primario,color_secundario,nombre_app,ciudad,whatsapp_soporte,horario_atencion,img_bienvenida,img_encamino,img_recolectado,img_transito,img_entregado,img_soporte,activo',
      [columna]: `eq.${valor}`,
      activo: 'eq.true',
      limit: '1'
    })
    const respuesta = await fetch(`${SUPABASE_URL_TENANT}/rest/v1/tenants_publico?${consulta.toString()}`, {
      headers: {
        apikey: SUPABASE_KEY_TENANT,
        Authorization: `Bearer ${SUPABASE_KEY_TENANT}`
      }
    })

    const resultado = await respuesta.json().catch(() => null)

    if (!respuesta.ok) {
      throw crearErrorTenant(
        resultado?.message || `La consulta del tenant respondió con estado ${respuesta.status}`,
        {
          code: resultado?.code,
          details: resultado?.details,
          hint: resultado?.hint,
          status: respuesta.status
        }
      )
    }

    if (!Array.isArray(resultado)) {
      throw crearErrorTenant('RESPUESTA_TENANT_INVALIDA', {
        code: 'RESPUESTA_TENANT_INVALIDA',
        status: respuesta.status
      })
    }

    const tenants = resultado
    return tenants[0] || null
  }

  async function cargarConfiguracionTenant() {
    const slugSolicitado = obtenerSlugSolicitado()
    const dominioActual = normalizarDominio(window.location.hostname)

    try {
      const guardado = JSON.parse(sessionStorage.getItem('tenant_config') || 'null')
      const coincide = slugSolicitado
        ? normalizarSlug(guardado?.slug) === slugSolicitado
        : normalizarDominio(guardado?.dominio) === dominioActual
      if (coincide) applyTenantTheme(guardado)
    } catch (_) {
      try {
        sessionStorage.removeItem('tenant_config')
      } catch (_) {}
    }

    try {
      let tenant = null

      if (slugSolicitado) {
        tenant = await consultarTenant({ tipo: 'slug', valor: slugSolicitado })
      }

      if (!tenant && dominioActual) {
        tenant = await consultarTenant({ tipo: 'dominio', valor: dominioActual })
      }

      if (!tenant) {
        tenant = await consultarTenant({ tipo: 'slug', valor: 'guepack' })
      }

      if (!tenant) {
        throw crearErrorTenant('TENANT_NO_RESUELTO', {
          code: 'TENANT_NO_RESUELTO',
          details: `Host: ${dominioActual || '(vacío)'}`
        })
      }

      console.log('[tenant] detected slug:', tenant.slug)
      applyTenantTheme(tenant)
      return tenant
    } catch (error) {
      registrarFalloTenant(error)
      throw error
    }
  }

  window.applyTenantTheme = applyTenantTheme
  window.darkenColor = darkenColor
  window.lightenColor = lightenColor
  window.cargarConfiguracionTenant = cargarConfiguracionTenant

  const promesaConfiguracionTenant = cargarConfiguracionTenant()
  window.tenantConfigReady = promesaConfiguracionTenant
  // Los consumidores que esperan la promesa conservan el rechazo y detienen
  // su flujo. Este catch evita reportarlo además como unhandled rejection.
  promesaConfiguracionTenant.catch(() => {})

  aplicarImagenesEnDocumento()
})()
