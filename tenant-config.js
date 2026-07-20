(function () {
  'use strict'

  const SUPABASE_URL_TENANT = 'https://zkrnjdsnuyjaxxnluzmn.supabase.co'
  const SUPABASE_KEY_TENANT = 'sb_publishable_nde3IHFs-CJqqY0w5gV77g_FbtKtH7z'

  function esColorHexadecimal(valor) {
    return /^#[0-9a-f]{6}$/i.test(String(valor || ''))
  }

  function obtenerSlugSolicitado() {
    const parametros = new URLSearchParams(window.location.search)
    const slugParametro = parametros.get('tenant') || parametros.get('slug')
    if (slugParametro) return slugParametro.toLowerCase().trim()

    const dominio = window.location.hostname.toLowerCase()
    if (dominio.endsWith('.guepack.com')) {
      const subdominio = dominio.slice(0, -'.guepack.com'.length)
      if (subdominio && subdominio !== 'www') return subdominio
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
    if (!tenant || typeof tenant !== 'object') return
    const raiz = document.documentElement

    if (esColorHexadecimal(tenant.color_primario)) {
      raiz.style.setProperty('--color-primary', tenant.color_primario)
      raiz.style.setProperty('--blue', tenant.color_primario)
    }
    if (esColorHexadecimal(tenant.color_secundario)) {
      raiz.style.setProperty('--color-secondary', tenant.color_secundario)
      raiz.style.setProperty('--orange', tenant.color_secundario)
    }

    if (tenant.nombre) document.title = tenant.nombre

    const logo = urlSegura(tenant.logo_url)
    if (logo) {
      document.querySelectorAll('[data-tenant-logo], img[src*="logo_principal"]').forEach(imagen => {
        imagen.src = logo
        imagen.alt = tenant.nombre_app || tenant.nombre || 'Logo'
      })
    }

    try {
      sessionStorage.setItem('tenant_config', JSON.stringify(tenant))
    } catch (error) {
      console.warn('No se pudo guardar la configuración del tenant en la sesión:', error)
    }
    window.dispatchEvent(new CustomEvent('tenant-config-aplicada', { detail: tenant }))
  }

  async function consultarTenant(identificador) {
    const columna = identificador.tipo === 'dominio' ? 'dominio' : 'slug'
    const consulta = new URLSearchParams({
      select: 'id,nombre,slug,dominio,logo_url,color_primario,color_secundario,nombre_app,ciudad,whatsapp_soporte,datos_bancarios,horario_atencion,activo',
      [columna]: `eq.${identificador.valor}`,
      activo: 'eq.true',
      limit: '1'
    })
    const respuesta = await fetch(`${SUPABASE_URL_TENANT}/rest/v1/tenants?${consulta.toString()}`, {
      headers: {
        apikey: SUPABASE_KEY_TENANT,
        Authorization: `Bearer ${SUPABASE_KEY_TENANT}`
      }
    })
    if (!respuesta.ok) throw new Error(`La consulta del tenant respondió con estado ${respuesta.status}`)
    const tenants = await respuesta.json()
    return tenants[0] || null
  }

  async function cargarConfiguracionTenant() {
    const slugSolicitado = obtenerSlugSolicitado()
    const dominioActual = window.location.hostname.toLowerCase()

    try {
      const guardado = JSON.parse(sessionStorage.getItem('tenant_config') || 'null')
      const coincide = slugSolicitado
        ? guardado?.slug === slugSolicitado
        : guardado?.dominio?.toLowerCase() === dominioActual
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

      const slugDetectado = tenant?.slug || 'guepack'
      console.log('[tenant] detected slug:', slugDetectado)
      if (tenant) applyTenantTheme(tenant)
      return tenant
    } catch (error) {
      console.error('No se pudo cargar la configuración del tenant:', error)
      return null
    }
  }

  window.applyTenantTheme = applyTenantTheme
  window.cargarConfiguracionTenant = cargarConfiguracionTenant
  window.tenantConfigReady = cargarConfiguracionTenant()
})()
