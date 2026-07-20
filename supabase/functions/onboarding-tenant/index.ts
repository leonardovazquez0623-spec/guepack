import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const origenesPermitidos = new Set([
  'https://guepack.com',
  'https://www.guepack.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

function encabezadosCors(req: Request) {
  const origen = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': origenesPermitidos.has(origen) ? origen : 'https://guepack.com',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function responder(req: Request, cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...encabezadosCors(req), 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: encabezadosCors(req) })
  if (req.method !== 'POST') return responder(req, { error: 'Método no permitido' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return responder(req, { error: 'No autorizado' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[onboarding-tenant] Faltan secretos de Supabase')
      return responder(req, { error: 'Configuración incompleta del servidor' }, 500)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data: { user }, error: errorUsuario } = await admin.auth.getUser(token)
    if (errorUsuario || !user) return responder(req, { error: 'Token inválido' }, 401)

    const { data: perfil, error: errorPerfil } = await admin
      .from('usuarios')
      .select('es_superadmin')
      .eq('user_id', user.id)
      .maybeSingle()

    if (errorPerfil) {
      console.error('[onboarding-tenant] Error al verificar permisos:', errorPerfil.message)
      return responder(req, { error: 'No fue posible verificar los permisos' }, 500)
    }
    if (!perfil?.es_superadmin) return responder(req, { error: 'Acceso restringido a superadministradores' }, 403)

    const cuerpo = await req.json().catch(() => null)
    const tenantId = cuerpo?.tenant_id
    const soloEstado = cuerpo?.solo_estado === true
    if (tenantId === undefined || tenantId === null || String(tenantId).trim() === '') {
      return responder(req, { error: 'tenant_id es requerido' }, 400)
    }

    const consultarEstado = async () => {
      const [
        precios,
        rangos,
        configuracion,
        repartidores,
        zonas,
      ] = await Promise.all([
        admin.from('precios_generales').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        admin.from('rangos_precio_general').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        admin.from('configuracion').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        admin.from('repartidores').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        admin.from('zonas_cobertura').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ])

      const errorEstado = [precios, rangos, configuracion, repartidores, zonas]
        .map(resultado => resultado.error)
        .find(Boolean)
      if (errorEstado) throw errorEstado

      return {
        precios_configurados: (precios.count || 0) > 0 && (rangos.count || 0) > 0,
        configuracion_base: (configuracion.count || 0) > 0,
        tiene_repartidor: (repartidores.count || 0) > 0,
        tiene_zona: (zonas.count || 0) > 0,
      }
    }

    if (soloEstado) {
      const estadoConfiguracion = await consultarEstado()
      return responder(req, { success: true, tenant_id: tenantId, estado: estadoConfiguracion })
    }

    const { data: tenant, error: errorTenant } = await admin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle()
    if (errorTenant) throw errorTenant
    if (!tenant) return responder(req, { error: 'Tenant no encontrado' }, 404)

    const { count: totalPrecios, error: errorConsultaPrecios } = await admin
      .from('precios_generales')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if (errorConsultaPrecios) throw errorConsultaPrecios

    if (!totalPrecios) {
      const { error } = await admin.from('precios_generales').insert({
        tenant_id: tenantId,
        tarifa_base: 115,
        km_minimo: 5,
        precio_km_extra: 13,
        iva: 0.16,
      })
      if (error) throw error
    }

    const { count: totalRangos, error: errorConsultaRangos } = await admin
      .from('rangos_precio_general')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if (errorConsultaRangos) throw errorConsultaRangos

    if (!totalRangos) {
      const { error } = await admin.from('rangos_precio_general').insert([
        { tenant_id: tenantId, km_desde: 0, km_hasta: 5, precio: 115 },
        { tenant_id: tenantId, km_desde: 5, km_hasta: 10, precio: 180 },
        { tenant_id: tenantId, km_desde: 10, km_hasta: 15, precio: 245 },
        { tenant_id: tenantId, km_desde: 15, km_hasta: 20, precio: 310 },
        { tenant_id: tenantId, km_desde: 20, km_hasta: 25, precio: 375 },
        { tenant_id: tenantId, km_desde: 25, km_hasta: 999, precio: 375 },
      ])
      if (error) throw error
    }

    const { count: totalConfiguracion, error: errorConsultaConfiguracion } = await admin
      .from('configuracion')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if (errorConsultaConfiguracion) throw errorConsultaConfiguracion

    if (!totalConfiguracion) {
      const { error } = await admin.from('configuracion').insert({
        tenant_id: tenantId,
        lluvia: false,
        mensaje_lluvia: 'Servicio con demora por lluvia',
        tiempo_aceptar: 60,
        pausa_rondas: 20,
        max_rondas: 3,
      })
      if (error) throw error
    }

    const estadoConfiguracion = await consultarEstado()
    console.log('[onboarding-tenant] Tenant configurado:', tenantId)
    return responder(req, {
      success: true,
      tenant_id: tenantId,
      estado: estadoConfiguracion,
    })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[onboarding-tenant] Error:', mensaje)
    return responder(req, { error: 'No fue posible configurar el tenant', detalle: mensaje }, 500)
  }
})
