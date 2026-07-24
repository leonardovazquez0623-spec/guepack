import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const origenesPermitidos = new Set([
  'https://guepack.com',
  'https://www.guepack.com'
])

function obtenerEncabezadosCors(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? ''
  if (!origenesPermitidos.has(origen)) return {}
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Headers': 'content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  }
}

function responder(req: Request, contenido: unknown, estado = 200) {
  return new Response(JSON.stringify(contenido), {
    status: estado,
    headers: {
      ...obtenerEncabezadosCors(req),
      'Content-Type': 'application/json'
    }
  })
}

Deno.serve(async req => {
  const origen = req.headers.get('Origin') ?? ''
  if (origen && !origenesPermitidos.has(origen)) {
    return responder(req, { error: 'Origen no permitido' }, 403)
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: obtenerEncabezadosCors(req) })
  }

  if (req.method !== 'POST') {
    return responder(req, { error: 'Método no permitido' }, 405)
  }

  try {
    let cuerpo: any
    try {
      cuerpo = await req.json()
    } catch {
      return responder(req, { error: 'La solicitud no es válida' }, 400)
    }

    const tokenRastreo =
      typeof cuerpo?.token_rastreo === 'string'
        ? cuerpo.token_rastreo.trim()
        : ''
    const tokenFcm =
      typeof cuerpo?.fcm_token === 'string'
        ? cuerpo.fcm_token.trim()
        : ''

    if (
      !tokenRastreo ||
      tokenRastreo.length > 500 ||
      !tokenFcm ||
      tokenFcm.length > 500
    ) {
      return responder(req, { error: 'La solicitud no es válida' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const claveServicio =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY')

    if (!supabaseUrl || !claveServicio) {
      console.error(
        '[registrar-notificacion-rastreo] Faltan variables de entorno requeridas'
      )
      return responder(req, { error: 'Configuración interna incompleta' }, 500)
    }

    const supabaseAdmin = createClient(supabaseUrl, claveServicio, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    const { data: pedido, error: errorPedido } = await supabaseAdmin
      .from('pedidos')
      .select('id')
      .eq('token_rastreo', tokenRastreo)
      .limit(1)
      .maybeSingle()

    if (errorPedido) {
      console.error(
        '[registrar-notificacion-rastreo] No se pudo validar el token de rastreo:',
        errorPedido.message
      )
      return responder(
        req,
        { error: 'No fue posible registrar la notificación' },
        500
      )
    }

    if (!pedido) {
      return responder(
        req,
        { error: 'No fue posible registrar la notificación' },
        404
      )
    }

    const { error: errorRegistro } = await supabaseAdmin
      .from('tokens_rastreo')
      .upsert(
        {
          pedido_id: pedido.id,
          fcm_token: tokenFcm
        },
        {
          onConflict: 'fcm_token'
        }
      )

    if (errorRegistro) {
      console.error(
        '[registrar-notificacion-rastreo] No se pudo guardar la suscripción:',
        errorRegistro.message
      )
      return responder(
        req,
        { error: 'No fue posible registrar la notificación' },
        500
      )
    }

    return responder(req, { success: true })
  } catch (error: any) {
    console.error(
      '[registrar-notificacion-rastreo] Error inesperado:',
      error.message
    )
    return responder(
      req,
      { error: 'No fue posible registrar la notificación' },
      500
    )
  }
})
