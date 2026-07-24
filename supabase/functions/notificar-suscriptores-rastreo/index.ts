import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const origenesPermitidos = new Set([
  'https://guepack.com',
  'https://www.guepack.com'
])

const textosPorEstado: Record<string, string> = {
  'Repartidor en domicilio recoleccion':
    'Tu mensajero está en tu domicilio para recolectar el paquete.',
  'Recolectado':
    '¡Tu paquete está en manos de tu mensajero!',
  'En camino a entrega':
    'Tu paquete va en camino al destino.',
  'Repartidor en domicilio':
    'Tu mensajero llegó al domicilio de entrega.',
  'Entregado':
    '¡Tu paquete fue entregado exitosamente!'
}

function obtenerEncabezadosCors(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? ''
  if (!origenesPermitidos.has(origen)) return {}
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Headers':
      'authorization, content-type, x-client-info, apikey',
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

function pedidoIdValido(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isSafeInteger(valor) &&
    valor > 0
  )
}

async function obtenerTokenAccesoFirebase(
  clavePrivadaFirebase: string,
  correoFirebase: string
): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000)
  const cabecera = { alg: 'RS256', typ: 'JWT' }
  const urlToken = 'https://oauth2.googleapis.com/token'
  const carga = {
    iss: correoFirebase,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: urlToken,
    exp: ahora + 3600,
    iat: ahora
  }

  const codificar = (objeto: object) =>
    btoa(JSON.stringify(objeto))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

  const entradaFirma = `${codificar(cabecera)}.${codificar(carga)}`
  const datosClave = clavePrivadaFirebase
    .replace('-----BEGIN PRIVATE KEY-----\n', '')
    .replace('\n-----END PRIVATE KEY-----\n', '')
    .replace(/\n/g, '')
  const claveBinaria = Uint8Array.from(
    atob(datosClave),
    caracter => caracter.charCodeAt(0)
  )
  const claveCriptografica = await crypto.subtle.importKey(
    'pkcs8',
    claveBinaria,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const firma = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    claveCriptografica,
    new TextEncoder().encode(entradaFirma)
  )
  const firmaCodificada = btoa(
    String.fromCharCode(...new Uint8Array(firma))
  )
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const jwt = `${entradaFirma}.${firmaCodificada}`

  const respuesta = await fetch(urlToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' +
      '&assertion=' +
      jwt
  })
  const datos = await respuesta.json()

  if (!respuesta.ok || !datos.access_token) {
    throw new Error('Firebase no devolvió un token de acceso válido')
  }

  return datos.access_token
}

async function enviarMensajeFirebase(
  proyectoFirebase: string,
  tokenFcm: string,
  titulo: string,
  cuerpo: string,
  accessToken: string
) {
  const respuesta = await fetch(
    `https://fcm.googleapis.com/v1/projects/${proyectoFirebase}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify({
        message: {
          token: tokenFcm,
          notification: { title: titulo, body: cuerpo },
          data: {
            titulo,
            cuerpo,
            tipo: 'rastreo'
          },
          android: {
            notification: {
              sound: 'default',
              channel_id: 'guepack_pedidos'
            }
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                'content-available': 1
              }
            }
          },
          webpush: {
            notification: {
              title: titulo,
              body: cuerpo,
              icon: '/logo_icono.png',
              badge: '/logo_icono.png'
            },
            fcm_options: {
              link: 'https://guepack.com'
            }
          }
        }
      })
    }
  )

  return await respuesta.json()
}

function obtenerCodigoErrorFirebase(resultado: any): string | null {
  const codigoDetalle = resultado?.error?.details?.find(
    (detalle: any) => detalle.errorCode
  )?.errorCode

  if (codigoDetalle) return codigoDetalle
  if (resultado?.error?.status === 'NOT_FOUND') return 'UNREGISTERED'
  return null
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: obtenerEncabezadosCors(req) })
  }

  if (req.method !== 'POST') {
    return responder(req, { error: 'Método no permitido' }, 405)
  }

  try {
    const tokenJwt = (req.headers.get('Authorization') || '')
      .replace(/^Bearer\s+/i, '')
    const clavesServicio = [
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      Deno.env.get('SERVICE_ROLE_KEY')
    ].filter((clave): clave is string => Boolean(clave))
    const claveServicio = clavesServicio[0]
    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    if (!claveServicio || !supabaseUrl) {
      console.error(
        '[notificar-suscriptores-rastreo] Faltan variables de Supabase'
      )
      return responder(req, { error: 'Configuración interna incompleta' }, 500)
    }

    if (!tokenJwt || !clavesServicio.includes(tokenJwt)) {
      return responder(req, { error: 'No autorizado' }, 401)
    }

    let solicitud: any
    try {
      solicitud = await req.json()
    } catch {
      return responder(req, { error: 'La solicitud no es válida' }, 400)
    }

    const pedidoId = solicitud?.pedido_id
    const estado =
      typeof solicitud?.estado === 'string'
        ? solicitud.estado.trim()
        : ''

    if (
      !pedidoIdValido(pedidoId) ||
      !estado ||
      estado.length > 100
    ) {
      return responder(
        req,
        { error: 'Los datos de la solicitud no son válidos' },
        400
      )
    }

    const textoEstado = textosPorEstado[estado]
    if (!textoEstado) {
      return responder(
        req,
        { error: 'El estado no genera una notificación de rastreo' },
        400
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, claveServicio, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    const { data: tokens, error: errorTokens } = await supabaseAdmin
      .from('tokens_rastreo')
      .select('fcm_token')
      .eq('pedido_id', pedidoId)

    if (errorTokens) {
      console.error(
        '[notificar-suscriptores-rastreo] No se pudieron consultar los suscriptores:',
        errorTokens.message
      )
      return responder(
        req,
        { error: 'No se pudieron consultar los suscriptores' },
        500
      )
    }

    const tokensUnicos = [...new Set(
      (tokens || [])
        .map((fila: any) => fila.fcm_token)
        .filter(Boolean)
    )] as string[]

    if (!tokensUnicos.length) {
      return responder(req, { sent: 0 })
    }

    const {
      data: reservaRealizada,
      error: errorReserva
    } = await supabaseAdmin.rpc(
      'reservar_notificacion_rastreo',
      {
        p_pedido_id: pedidoId,
        p_estado: estado
      }
    )

    if (errorReserva) {
      console.error(
        '[notificar-suscriptores-rastreo] No se pudo reservar la notificación:',
        errorReserva.message
      )
      return responder(
        req,
        { error: 'No se pudo controlar la deduplicación' },
        500
      )
    }

    if (reservaRealizada !== true) {
      return responder(req, {
        sent: 0,
        duplicado: true
      })
    }

    const clavePrivadaCruda = Deno.env.get('FIREBASE_PRIVATE_KEY')
    const correoFirebase = Deno.env.get('FIREBASE_CLIENT_EMAIL')
    const proyectoFirebase = Deno.env.get('FIREBASE_PROJECT_ID')

    if (!clavePrivadaCruda || !correoFirebase || !proyectoFirebase) {
      console.error(
        '[notificar-suscriptores-rastreo] Faltan variables de Firebase'
      )
      return responder(req, { error: 'Configuración interna incompleta' }, 500)
    }

    const clavePrivadaFirebase =
      clavePrivadaCruda.replace(/\\n/g, '\n')
    const accessToken = await obtenerTokenAccesoFirebase(
      clavePrivadaFirebase,
      correoFirebase
    )
    const titulo = `GK-${pedidoId} actualizado`
    const codigosInvalidos = new Set([
      'INVALID_REGISTRATION',
      'UNREGISTERED',
      'SENDER_ID_MISMATCH'
    ])

    const resultados = await Promise.all(
      tokensUnicos.map(async tokenFcm => {
        try {
          const resultado = await enviarMensajeFirebase(
            proyectoFirebase,
            tokenFcm,
            titulo,
            textoEstado,
            accessToken
          )
          const codigoError = obtenerCodigoErrorFirebase(resultado)

          if (codigoError && codigosInvalidos.has(codigoError)) {
            const { error: errorEliminacion } = await supabaseAdmin
              .from('tokens_rastreo')
              .delete()
              .eq('fcm_token', tokenFcm)

            if (errorEliminacion) {
              console.error(
                '[notificar-suscriptores-rastreo] No se pudo eliminar un token inválido:',
                errorEliminacion.message
              )
            }

            return {
              enviado: false,
              eliminado: true,
              motivo: codigoError
            }
          }

          if (resultado?.error) {
            return {
              enviado: false,
              error:
                resultado.error.message ||
                'Firebase rechazó el mensaje'
            }
          }

          return { enviado: true }
        } catch (error: any) {
          return {
            enviado: false,
            error: error.message
          }
        }
      })
    )

    const enviados = resultados.filter(
      resultado => resultado.enviado === true
    ).length
    const fallidos = resultados.filter(
      resultado =>
        resultado.enviado !== true &&
        resultado.eliminado !== true
    ).length

    return responder(req, {
      sent: enviados,
      fallidos
    })
  } catch (error: any) {
    console.error(
      '[notificar-suscriptores-rastreo] Error inesperado:',
      error.message
    )
    return responder(
      req,
      { error: 'No fue posible enviar las notificaciones' },
      500
    )
  }
})
