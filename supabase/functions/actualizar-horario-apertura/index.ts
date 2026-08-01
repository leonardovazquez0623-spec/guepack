import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ORIGEN_PRODUCCION = 'https://guepack.com'

type ResultadoActualizacion = {
  tenant_id: string | number
  horario_apertura: string
  configuracion_creada: boolean
}

function origenPermitido(origen: string): boolean {
  if (
    origen === 'http://localhost:3000' ||
    origen === 'http://127.0.0.1:3000'
  ) {
    return true
  }

  try {
    const url = new URL(origen)

    return (
      url.protocol === 'https:' &&
      (
        url.hostname === 'guepack.com' ||
        url.hostname.endsWith('.guepack.com')
      )
    )
  } catch {
    return false
  }
}

function encabezadosCors(req: Request) {
  const origen = req.headers.get('Origin') ?? ''

  return {
    'Access-Control-Allow-Origin':
      origenPermitido(origen) ? origen : ORIGEN_PRODUCCION,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function responder(
  req: Request,
  contenido: unknown,
  estado = 200,
) {
  return new Response(JSON.stringify(contenido), {
    status: estado,
    headers: {
      ...encabezadosCors(req),
      'Content-Type': 'application/json',
    },
  })
}

function obtenerToken(req: Request): string | null {
  const encabezado = req.headers.get('Authorization') ?? ''
  const coincidencia = encabezado.match(/^Bearer\s+(.+)$/i)

  return coincidencia?.[1]?.trim() || null
}

/**
 * Valida un BIGINT positivo sin convertirlo a number.
 * Así se evita pérdida de precisión en la entrada.
 */
function normalizarTenantId(valor: unknown): string | null {
  if (typeof valor !== 'string') return null

  const tenantId = valor.trim()

  if (!/^[1-9]\d*$/.test(tenantId)) return null

  // Máximo de BIGINT con signo de PostgreSQL.
  if (
    tenantId.length > 19 ||
    (
      tenantId.length === 19 &&
      tenantId > '9223372036854775807'
    )
  ) {
    return null
  }

  return tenantId
}

function horarioAperturaValido(
  valor: unknown,
): valor is string {
  return (
    typeof valor === 'string' &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor)
  )
}

function tienePropiedad(
  valor: Record<string, unknown>,
  propiedad: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(valor, propiedad)
}

function esObjeto(
  valor: unknown,
): valor is Record<string, unknown> {
  return (
    valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor)
  )
}

function esResultadoActualizacion(
  valor: unknown,
): valor is ResultadoActualizacion {
  if (!esObjeto(valor)) return false

  const tenantIdValido =
    typeof valor.tenant_id === 'string' ||
    (
      typeof valor.tenant_id === 'number' &&
      Number.isFinite(valor.tenant_id)
    )

  return (
    tenantIdValido &&
    typeof valor.horario_apertura === 'string' &&
    typeof valor.configuracion_creada === 'boolean'
  )
}

function errorRpc(mensaje: string) {
  if (mensaje.includes('ACTOR_NO_ES_ADMIN_DEL_TENANT')) {
    return [
      403,
      'Acceso restringido a administradores de este tenant',
    ] as const
  }

  if (mensaje.includes('TENANT_NO_EXISTE')) {
    return [
      404,
      'Tenant no encontrado',
    ] as const
  }

  if (mensaje.includes('HORARIO_APERTURA_INVALIDO')) {
    return [
      400,
      'El horario de apertura no es válido',
    ] as const
  }

  return [
    500,
    'No fue posible actualizar el horario de apertura',
  ] as const
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: encabezadosCors(req),
    })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return responder(
      req,
      { error: 'Método no permitido' },
      405,
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        '[actualizar-horario-apertura] Faltan variables de entorno de Supabase',
      )

      return responder(
        req,
        { error: 'Configuración interna incompleta' },
        500,
      )
    }

    const token = obtenerToken(req)

    if (!token) {
      return responder(
        req,
        { error: 'No autorizado' },
        401,
      )
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )

    /*
     * verify_jwt protege la función en el gateway. Esta validación
     * adicional obtiene de forma confiable el user.id del actor.
     */
    const {
      data: { user },
      error: errorUsuario,
    } = await supabaseAdmin.auth.getUser(token)

    if (errorUsuario || !user) {
      return responder(
        req,
        { error: 'Token inválido o vencido' },
        401,
      )
    }

    let tenantId: string
    let horarioApertura: string | undefined

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const tenantIdNormalizado = normalizarTenantId(
        url.searchParams.get('tenant_id'),
      )

      if (!tenantIdNormalizado) {
        return responder(
          req,
          {
            error:
              'tenant_id es requerido y debe enviarse como string BIGINT positivo',
          },
          400,
        )
      }

      tenantId = tenantIdNormalizado
    } else {
      const cuerpo = await req.json().catch(() => null)

      if (!esObjeto(cuerpo)) {
        return responder(
          req,
          { error: 'El cuerpo de la solicitud no es válido' },
          400,
        )
      }

      if (tienePropiedad(cuerpo, 'actor_user_id')) {
        return responder(
          req,
          {
            error:
              'actor_user_id no está permitido; el actor se obtiene del JWT',
          },
          400,
        )
      }

      if (tienePropiedad(cuerpo, 'zona_horaria')) {
        return responder(
          req,
          {
            error:
              'zona_horaria no puede modificarse desde esta operación',
          },
          400,
        )
      }

      const tenantIdNormalizado = normalizarTenantId(
        cuerpo.tenant_id,
      )

      if (!tenantIdNormalizado) {
        return responder(
          req,
          {
            error:
              'tenant_id es requerido y debe enviarse como string BIGINT positivo',
          },
          400,
        )
      }

      if (!horarioAperturaValido(cuerpo.horario_apertura)) {
        return responder(
          req,
          {
            error:
              'horario_apertura debe tener el formato HH:mm entre 00:00 y 23:59',
          },
          400,
        )
      }

      tenantId = tenantIdNormalizado
      horarioApertura = cuerpo.horario_apertura
    }

    /*
     * La autorización se comprueba exclusivamente contra
     * usuario_tenant_roles para soportar administradores multitenant.
     */
    const {
      data: rolTenant,
      error: errorRolTenant,
    } = await supabaseAdmin
      .from('usuario_tenant_roles')
      .select('rol')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .eq('rol', 'admin')
      .maybeSingle()

    if (errorRolTenant) {
      console.error(
        '[actualizar-horario-apertura] Error al verificar el rol:',
        errorRolTenant.message,
      )

      return responder(
        req,
        { error: 'No fue posible verificar los permisos' },
        500,
      )
    }

    if (!rolTenant) {
      return responder(
        req,
        {
          error:
            'Acceso restringido a administradores de este tenant',
        },
        403,
      )
    }

    if (req.method === 'GET') {
      const [
        resultadoTenant,
        resultadoConfiguracion,
      ] = await Promise.all([
        supabaseAdmin
          .from('tenants')
          .select('zona_horaria')
          .eq('id', tenantId)
          .maybeSingle(),

        supabaseAdmin
          .from('configuracion')
          .select('horario_apertura')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
      ])

      if (resultadoTenant.error) {
        console.error(
          '[actualizar-horario-apertura] Error al consultar el tenant:',
          resultadoTenant.error.message,
        )

        return responder(
          req,
          { error: 'No fue posible consultar el tenant' },
          500,
        )
      }

      if (!resultadoTenant.data) {
        return responder(
          req,
          { error: 'Tenant no encontrado' },
          404,
        )
      }

      if (resultadoConfiguracion.error) {
        console.error(
          '[actualizar-horario-apertura] Error al consultar la configuración:',
          resultadoConfiguracion.error.message,
        )

        return responder(
          req,
          { error: 'No fue posible consultar la configuración' },
          500,
        )
      }

      return responder(req, {
        success: true,
        tenant_id: tenantId,
        zona_horaria:
          resultadoTenant.data.zona_horaria ?? null,
        horario_apertura:
          resultadoConfiguracion.data?.horario_apertura ?? null,
        configuracion_existe:
          resultadoConfiguracion.data !== null,
      })
    }

    const {
      data: datosActualizacion,
      error: errorActualizacion,
    } = await supabaseAdmin.rpc(
      'actualizar_horario_apertura_tenant',
      {
        p_actor_user_id: user.id,
        p_tenant_id: tenantId,
        p_horario_apertura: horarioApertura,
      },
    )

    if (errorActualizacion) {
      console.error(
        '[actualizar-horario-apertura] La RPC rechazó la actualización:',
        errorActualizacion.message,
      )

      const [estado, mensaje] = errorRpc(
        errorActualizacion.message,
      )

      return responder(
        req,
        { error: mensaje },
        estado,
      )
    }

    const resultado = Array.isArray(datosActualizacion)
      ? datosActualizacion[0]
      : datosActualizacion

    if (!esResultadoActualizacion(resultado)) {
      console.error(
        '[actualizar-horario-apertura] La RPC respondió con un resultado inesperado:',
        resultado,
      )

      return responder(
        req,
        {
          error:
            'El horario fue procesado, pero no se pudo recuperar el resultado',
        },
        500,
      )
    }

    return responder(req, {
      success: true,
      tenant_id: String(resultado.tenant_id),
      horario_apertura: resultado.horario_apertura,
      configuracion_creada:
        resultado.configuracion_creada,
    })
  } catch (error) {
    console.error(
      '[actualizar-horario-apertura] Error inesperado:',
      error,
    )

    return responder(
      req,
      { error: 'Error interno del servidor' },
      500,
    )
  }
})
