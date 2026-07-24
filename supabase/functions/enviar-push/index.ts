import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const origenesPermitidos = ['https://guepack.com', 'https://www.guepack.com']

const encabezadosCors = (req: Request) => {
  const origen = req.headers.get('Origin') ?? ''
  const origenPermitido = origenesPermitidos.includes(origen)
    ? origen
    : origenesPermitidos[0]
  return {
    'Access-Control-Allow-Origin': origenPermitido,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  }
}

const clavePrivadaFirebase = Deno.env.get('FIREBASE_PRIVATE_KEY')!.replace(/\\n/g, '\n')
const correoFirebase = Deno.env.get('FIREBASE_CLIENT_EMAIL')!
const proyectoFirebase = Deno.env.get('FIREBASE_PROJECT_ID')!
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const claveAnonima = Deno.env.get('SUPABASE_ANON_KEY')!
const clavesServicio = [
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  Deno.env.get('SERVICE_ROLE_KEY')
].filter((clave): clave is string => Boolean(clave))
const claveServicio = clavesServicio[0]

const tiposUsuario = new Set([
  'estado_pedido',
  'llegada_parada',
  'parada_agregada',
  'mensaje_chat_recibido',
  'asignacion_liberada',
  'comprobante_deposito'
])

const tiposAdmin = new Set([
  'pedido_disponible_admin',
  'pedido_sin_asignar_admin',
  'notificacion_masiva_clientes'
])

const tiposInternos = new Set([
  'interno_pedido_disponible',
  'interno_pedido_sin_asignar',
  'interno_pago_confirmado',
  'interno_guia_generada'
])

function respuestaJson(req: Request, contenido: unknown, estado = 200) {
  return new Response(JSON.stringify(contenido), {
    status: estado,
    headers: { ...encabezadosCors(req), 'Content-Type': 'application/json' }
  })
}

function idValido(valor: unknown): valor is number {
  return Number.isInteger(valor) && Number(valor) > 0
}

async function obtenerAccessToken(): Promise<string> {
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
  const claveBinaria = Uint8Array.from(atob(datosClave), caracter => caracter.charCodeAt(0))
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  })
  const datos = await respuesta.json()
  if (!respuesta.ok || !datos.access_token) {
    throw new Error('Firebase no devolvió un token de acceso válido')
  }
  return datos.access_token
}

async function enviarMensajeFirebase(
  tokenFcm: string,
  titulo: string,
  cuerpo: string,
  tipo: string,
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
          data: { titulo, cuerpo, tipo: tipo || 'general' },
          android: {
            notification: {
              sound: 'default',
              channel_id: 'guepack_pedidos'
            }
          },
          apns: {
            payload: {
              aps: { sound: 'default', 'content-available': 1 }
            }
          },
          webpush: {
            notification: {
              title: titulo,
              body: cuerpo,
              icon: '/logo_icono.png',
              badge: '/logo_icono.png'
            },
            fcm_options: { link: 'https://guepack.com' }
          }
        }
      })
    }
  )
  return await respuesta.json()
}

async function obtenerUsuarioPorRepartidor(
  supabaseAdmin: any,
  nombre: string,
  tenantId: number
) {
  const { data: repartidor } = await supabaseAdmin
    .from('repartidores')
    .select('email')
    .eq('nombre', nombre)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!repartidor?.email) return null

  const { data: usuario } = await supabaseAdmin
    .from('usuarios')
    .select('user_id')
    .eq('email', repartidor.email)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return usuario?.user_id || null
}

async function obtenerRepartidorAutenticado(
  supabaseAdmin: any,
  usuario: any
) {
  const { data: perfil } = await supabaseAdmin
    .from('usuarios')
    .select('rol, email, tenant_id')
    .eq('user_id', usuario.id)
    .maybeSingle()
  if (perfil?.rol !== 'repartidor' || !perfil.email || !perfil.tenant_id) {
    return null
  }

  const { data: repartidor } = await supabaseAdmin
    .from('repartidores')
    .select('id, nombre, tenant_id')
    .eq('email', perfil.email)
    .eq('tenant_id', perfil.tenant_id)
    .maybeSingle()
  return repartidor || null
}

async function obtenerUsuariosRepartidoresDisponibles(
  supabaseAdmin: any,
  tenantId: number
) {
  const { data: repartidores, error: errorRepartidores } = await supabaseAdmin
    .from('repartidores')
    .select('email')
    .eq('disponible', true)
    .eq('tenant_id', tenantId)

  if (errorRepartidores) {
    throw new Error(
      'No fue posible consultar los repartidores disponibles: ' +
      errorRepartidores.message
    )
  }

  const correos = [...new Set(
    (repartidores || [])
      .map((repartidor: any) => repartidor.email)
      .filter(Boolean)
  )]

  if (!correos.length) return []

  const { data: usuarios, error: errorUsuarios } = await supabaseAdmin
    .from('usuarios')
    .select('user_id')
    .in('email', correos)
    .eq('tenant_id', tenantId)

  if (errorUsuarios) {
    throw new Error(
      'No fue posible consultar los usuarios repartidores: ' +
      errorUsuarios.message
    )
  }

  return [...new Set(
    (usuarios || [])
      .map((usuario: any) => usuario.user_id)
      .filter(Boolean)
  )] as string[]
}

async function enviarAUsuarios(
  supabaseAdmin: any,
  usuarios: string[],
  titulo: string,
  cuerpo: string,
  tipo: string,
  accessToken: string
) {
  const ids = [...new Set(usuarios.filter(Boolean))]
  if (!ids.length) return { sent: 0, results: [] }

  const { data: filasTokens, error } = await supabaseAdmin
    .from('usuarios_tokens')
    .select('user_id, fcm_token')
    .in('user_id', ids)
  if (error) {
    throw new Error(
      'No fue posible consultar los tokens de notificación: ' + error.message
    )
  }
  if (!filasTokens?.length) return { sent: 0, results: [] }

  const codigosInvalidos = new Set([
    'INVALID_REGISTRATION',
    'UNREGISTERED',
    'SENDER_ID_MISMATCH'
  ])
  const resultados = await Promise.all(
    filasTokens.map(async ({ fcm_token }: { fcm_token: string }) => {
      try {
        const resultado = await enviarMensajeFirebase(
          fcm_token,
          titulo,
          cuerpo,
          tipo,
          accessToken
        )
        const codigoError: string | null =
          resultado?.error?.details?.find(
            (detalle: any) => detalle.errorCode
          )?.errorCode ??
          (resultado?.error?.status === 'NOT_FOUND' ? 'UNREGISTERED' : null)
        if (codigoError && codigosInvalidos.has(codigoError)) {
          await supabaseAdmin
            .from('usuarios_tokens')
            .delete()
            .eq('fcm_token', fcm_token)
          return { eliminado: true, motivo: codigoError }
        }
        return resultado
      } catch (error: any) {
        return { error: error.message }
      }
    })
  )
  return {
    sent: resultados.filter(
      (resultado: any) => !resultado?.eliminado && !resultado?.error
    ).length,
    results: resultados
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: encabezadosCors(req) })
  }

  const tokenJwt = (req.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '')
  if (!tokenJwt) return respuestaJson(req, { error: 'No autorizado' }, 401)
  if (!claveServicio) {
    console.error('[enviar-push] No hay una clave de servicio configurada')
    return respuestaJson(req, { error: 'Configuración interna incompleta' }, 500)
  }

  let solicitud: any
  try {
    solicitud = await req.json()
  } catch (error: any) {
    console.error('[enviar-push] Error parseando el cuerpo:', error.message)
    return respuestaJson(req, { error: 'Cuerpo inválido' }, 400)
  }

  const tipoNotificacion = solicitud?.tipo_notificacion
  if (!tipoNotificacion) {
    return respuestaJson(req, { error: 'Falta tipo_notificacion' }, 400)
  }
  if (
    'user_id' in solicitud ||
    'token' in solicitud ||
    'title' in solicitud ||
    'body' in solicitud
  ) {
    return respuestaJson(
      req,
      { error: 'La solicitud contiene campos de destino no permitidos' },
      400
    )
  }

  const usaClaveServicio = clavesServicio.includes(tokenJwt)
  const supabaseAdmin = createClient(supabaseUrl, claveServicio)
  let usuarioAutenticado: any = null
  let perfilAdministrador: any = null

  if (usaClaveServicio) {
    if (!tiposInternos.has(tipoNotificacion)) {
      return respuestaJson(
        req,
        { error: 'Tipo de notificación interna no permitido' },
        403
      )
    }
  } else {
    const tipoPermitidoParaUsuario =
      tiposUsuario.has(tipoNotificacion) ||
      tiposAdmin.has(tipoNotificacion)

    if (!tipoPermitidoParaUsuario) {
      return respuestaJson(
        req,
        { error: 'Tipo de notificación no permitido para usuarios' },
        403
      )
    }
    const supabaseUsuario = createClient(supabaseUrl, claveAnonima)
    const { data: { user }, error } =
      await supabaseUsuario.auth.getUser(tokenJwt)
    if (error || !user) {
      return respuestaJson(req, { error: 'Token inválido' }, 401)
    }
    usuarioAutenticado = user

    if (tiposAdmin.has(tipoNotificacion)) {
      const { data: perfil, error: errorPerfil } = await supabaseAdmin
        .from('usuarios')
        .select('rol, tenant_id, es_superadmin')
        .eq('user_id', user.id)
        .maybeSingle()

      if (errorPerfil) {
        console.error(
          '[enviar-push] No se pudo consultar el perfil administrativo:',
          errorPerfil
        )
        return respuestaJson(
          req,
          { error: 'No se pudo validar el perfil administrativo' },
          500
        )
      }

      if (perfil?.rol !== 'admin') {
        return respuestaJson(
          req,
          { error: 'Esta operación requiere permisos de administrador' },
          403
        )
      }

      perfilAdministrador = perfil
    }
  }

  try {
    let destinatarios: string[] = []
    let titulo = ''
    let cuerpo = ''
    let tipoFirebase = 'general'

    if (tipoNotificacion === 'comprobante_deposito') {
      const comprobanteRuta =
        typeof solicitud.comprobante_ruta === 'string'
          ? solicitud.comprobante_ruta.trim()
          : ''

      if (
        !comprobanteRuta ||
        comprobanteRuta.length > 300 ||
        comprobanteRuta.includes('..')
      ) {
        return respuestaJson(
          req,
          { error: 'La ruta del comprobante no es válida' },
          400
        )
      }

      const repartidor = await obtenerRepartidorAutenticado(
        supabaseAdmin,
        usuarioAutenticado
      )

      if (!repartidor) {
        return respuestaJson(
          req,
          { error: 'No se encontró un repartidor válido para esta sesión' },
          403
        )
      }

      const {
        data: administradores,
        error: errorAdministradores
      } = await supabaseAdmin
        .from('usuarios')
        .select('user_id')
        .eq('rol', 'admin')
        .or(
          `tenant_id.eq.${repartidor.tenant_id},es_superadmin.eq.true`
        )

      if (errorAdministradores) {
        console.error(
          '[enviar-push] No se pudieron consultar los administradores:',
          errorAdministradores
        )
        return respuestaJson(
          req,
          { error: 'No se pudieron obtener los destinatarios' },
          500
        )
      }

      destinatarios = (administradores || [])
        .map((administrador: any) => administrador.user_id)
        .filter(Boolean)

      titulo = '🧾 Nuevo comprobante de depósito'
      cuerpo =
        `${repartidor.nombre || 'Un repartidor'} subió un ` +
        'comprobante de depósito, requiere revisión'
      tipoFirebase = 'admin'
    }

    if (tipoNotificacion === 'parada_agregada') {
      if (!idValido(solicitud.pedido_id) || !idValido(solicitud.parada_id)) {
        return respuestaJson(req, { error: 'Identificadores inválidos' }, 400)
      }
      const [{ data: pedido }, { data: parada }] = await Promise.all([
        supabaseAdmin
          .from('pedidos')
          .select('id, user_id, tenant_id, repartidor')
          .eq('id', solicitud.pedido_id)
          .maybeSingle(),
        supabaseAdmin
          .from('paradas')
          .select('id, pedido_id, direccion')
          .eq('id', solicitud.parada_id)
          .maybeSingle()
      ])
      if (
        !pedido ||
        pedido.user_id !== usuarioAutenticado.id ||
        parada?.pedido_id !== pedido.id ||
        !pedido.repartidor
      ) {
        return respuestaJson(req, { error: 'Operación no autorizada' }, 403)
      }
      const destinatario = await obtenerUsuarioPorRepartidor(
        supabaseAdmin,
        pedido.repartidor,
        pedido.tenant_id
      )
      if (destinatario) destinatarios = [destinatario]
      titulo = '📍 Nueva parada agregada a tu ruta'
      cuerpo = parada!.direccion
      tipoFirebase = 'pedido'
    }

    if (tipoNotificacion === 'mensaje_chat_recibido') {
      if (!idValido(solicitud.pedido_id) || !idValido(solicitud.mensaje_id)) {
        return respuestaJson(req, { error: 'Identificadores inválidos' }, 400)
      }
      const [{ data: pedido }, { data: mensaje }] = await Promise.all([
        supabaseAdmin
          .from('pedidos')
          .select('id, user_id')
          .eq('id', solicitud.pedido_id)
          .maybeSingle(),
        supabaseAdmin
          .from('mensajes')
          .select('id, pedido_id, de, texto, tipo')
          .eq('id', solicitud.mensaje_id)
          .maybeSingle()
      ])
      if (
        pedido?.user_id !== usuarioAutenticado.id ||
        mensaje?.pedido_id !== pedido?.id ||
        mensaje?.de !== 'repartidor' ||
        mensaje?.tipo !== 'chat'
      ) {
        return respuestaJson(req, { error: 'Operación no autorizada' }, 403)
      }
      destinatarios = [usuarioAutenticado.id]
      titulo = '💬 Nuevo mensaje'
      cuerpo = mensaje.texto || 'Tienes un nuevo mensaje'
      tipoFirebase = 'chat'
    }

    if (
      tipoNotificacion === 'estado_pedido' ||
      tipoNotificacion === 'llegada_parada' ||
      tipoNotificacion === 'asignacion_liberada'
    ) {
      if (!idValido(solicitud.pedido_id)) {
        return respuestaJson(req, { error: 'pedido_id inválido' }, 400)
      }
      const repartidor = await obtenerRepartidorAutenticado(
        supabaseAdmin,
        usuarioAutenticado
      )
      const { data: pedido } = await supabaseAdmin
        .from('pedidos')
        .select('id, user_id, tenant_id, repartidor, estado, nombre')
        .eq('id', solicitud.pedido_id)
        .maybeSingle()
      if (
        !repartidor ||
        !pedido ||
        pedido.tenant_id !== repartidor.tenant_id ||
        pedido.repartidor !== repartidor.nombre
      ) {
        return respuestaJson(req, { error: 'Operación no autorizada' }, 403)
      }
      destinatarios = pedido.user_id ? [pedido.user_id] : []

      if (tipoNotificacion === 'asignacion_liberada') {
        titulo = '🔄 Buscando nuevo mensajero'
        cuerpo = `Estamos buscando un nuevo mensajero para tu pedido GK-${pedido.id}`
        tipoFirebase = 'pedido'
      }

      if (tipoNotificacion === 'llegada_parada') {
        if (!idValido(solicitud.parada_id)) {
          return respuestaJson(req, { error: 'parada_id inválido' }, 400)
        }
        const { data: parada } = await supabaseAdmin
          .from('paradas')
          .select('id, pedido_id, orden, estado')
          .eq('id', solicitud.parada_id)
          .maybeSingle()
        if (
          parada?.pedido_id !== pedido.id ||
          parada?.estado !== 'en_domicilio'
        ) {
          return respuestaJson(req, { error: 'Parada no válida' }, 403)
        }
        titulo = '📍 GUEPACK Express'
        cuerpo = `Tu mensajero llegó a la parada #${parada.orden}`
        tipoFirebase = 'pedido'
      }

      if (tipoNotificacion === 'estado_pedido') {
        const nombre = pedido.nombre ? pedido.nombre.split(' ')[0] : ''
        const mensajes: Record<string, { titulo: string; cuerpo: string }> = {
          'Repartidor en domicilio recoleccion': {
            titulo: '📍 GUEPACK Express',
            cuerpo: `Hola ${nombre}. Tu guepartidor llegó a recolectar tu paquete.`
          },
          'Recolectado': {
            titulo: '📦 GUEPACK Express',
            cuerpo: `Hola ${nombre}. Tu paquete fue recolectado, vamos en camino.`
          },
          'En camino a entrega': {
            titulo: '🚚 GUEPACK Express',
            cuerpo: `Hola ${nombre}. Tu paquete va en camino al destino.`
          },
          'Repartidor en domicilio': {
            titulo: '📍 GUEPACK Express',
            cuerpo: `Hola ${nombre}. Tu guepartidor llegó al destino, tienes 7 minutos.`
          },
          'Entregado': {
            titulo: '✅ GUEPACK Express',
            cuerpo: `Hola ${nombre}. ¡Tu paquete fue entregado! Gracias por confiar en GUEPACK.`
          }
        }
        const mensaje = mensajes[pedido.estado]
        if (!mensaje) {
          return respuestaJson(
            req,
            { error: 'El estado no genera una notificación' },
            400
          )
        }
        titulo = mensaje.titulo
        cuerpo = mensaje.cuerpo
        tipoFirebase = 'pedido'
      }
    }

    if (tipoNotificacion === 'interno_pedido_disponible') {
      if (!idValido(solicitud.pedido_id)) {
        return respuestaJson(req, { error: 'pedido_id inválido' }, 400)
      }
      const { data: pedido } = await supabaseAdmin
        .from('pedidos')
        .select('id, tenant_id, direccion_recoleccion')
        .eq('id', solicitud.pedido_id)
        .maybeSingle()
      if (!pedido) return respuestaJson(req, { error: 'Pedido no encontrado' }, 404)

      destinatarios = await obtenerUsuariosRepartidoresDisponibles(
        supabaseAdmin,
        pedido.tenant_id
      )
      titulo = '📦 Nuevo pedido disponible'
      cuerpo = `GK-${pedido.id} · ${pedido.direccion_recoleccion || ''}`
      tipoFirebase = 'pedido'
    }

    if (tipoNotificacion === 'pedido_disponible_admin') {
      if (!idValido(solicitud.pedido_id)) {
        return respuestaJson(req, { error: 'pedido_id inválido' }, 400)
      }

      const { data: pedido, error: errorPedido } = await supabaseAdmin
        .from('pedidos')
        .select('id, tenant_id, direccion_recoleccion')
        .eq('id', solicitud.pedido_id)
        .maybeSingle()

      if (errorPedido) {
        console.error(
          '[enviar-push] No se pudo consultar el pedido:',
          errorPedido
        )
        return respuestaJson(
          req,
          { error: 'No se pudo consultar el pedido' },
          500
        )
      }

      if (!pedido) {
        return respuestaJson(req, { error: 'Pedido no encontrado' }, 404)
      }

      const administraTenant =
        perfilAdministrador?.es_superadmin === true ||
        (
          perfilAdministrador?.tenant_id != null &&
          perfilAdministrador.tenant_id === pedido.tenant_id
        )

      if (!administraTenant) {
        return respuestaJson(
          req,
          { error: 'No tienes permiso para administrar este pedido' },
          403
        )
      }

      destinatarios = await obtenerUsuariosRepartidoresDisponibles(
        supabaseAdmin,
        pedido.tenant_id
      )
      titulo = '📦 Nuevo pedido disponible'
      cuerpo = `GK-${pedido.id} · ${
        pedido.direccion_recoleccion || 'Consulta los detalles del pedido'
      }`
      tipoFirebase = 'pedido'
    }

    if (tipoNotificacion === 'pedido_sin_asignar_admin') {
      if (!idValido(solicitud.pedido_id)) {
        return respuestaJson(req, { error: 'pedido_id inválido' }, 400)
      }

      const { data: pedido, error: errorPedido } = await supabaseAdmin
        .from('pedidos')
        .select('id, tenant_id')
        .eq('id', solicitud.pedido_id)
        .maybeSingle()

      if (errorPedido) {
        console.error(
          '[enviar-push] No se pudo consultar el pedido:',
          errorPedido
        )
        return respuestaJson(
          req,
          { error: 'No se pudo consultar el pedido' },
          500
        )
      }

      if (!pedido) {
        return respuestaJson(req, { error: 'Pedido no encontrado' }, 404)
      }

      const administraTenant =
        perfilAdministrador?.es_superadmin === true ||
        (
          perfilAdministrador?.tenant_id != null &&
          perfilAdministrador.tenant_id === pedido.tenant_id
        )

      if (!administraTenant) {
        return respuestaJson(
          req,
          { error: 'No tienes permiso para administrar este pedido' },
          403
        )
      }

      destinatarios = [usuarioAutenticado.id]
      titulo = `⚠️ Pedido GK-${pedido.id} sin asignar`
      cuerpo = 'Revisión manual requerida — sin repartidores disponibles'
      tipoFirebase = 'admin'
    }

    if (tipoNotificacion === 'notificacion_masiva_clientes') {
      const clienteIdsOriginales = solicitud.cliente_ids
      const tituloSolicitado =
        typeof solicitud.titulo === 'string'
          ? solicitud.titulo.trim()
          : ''
      const mensajeSolicitado =
        typeof solicitud.mensaje === 'string'
          ? solicitud.mensaje.trim()
          : ''

      if (
        !Array.isArray(clienteIdsOriginales) ||
        !clienteIdsOriginales.length
      ) {
        return respuestaJson(
          req,
          { error: 'Debes seleccionar al menos un cliente' },
          400
        )
      }

      const clienteIds = [...new Set(clienteIdsOriginales)]

      if (
        clienteIds.some(
          (id: unknown) => typeof id !== 'string' || !id.trim()
        )
      ) {
        return respuestaJson(
          req,
          {
            error: 'La lista de clientes contiene identificadores no válidos'
          },
          400
        )
      }

      if (!tituloSolicitado || tituloSolicitado.length > 100) {
        return respuestaJson(
          req,
          { error: 'El título debe contener entre 1 y 100 caracteres' },
          400
        )
      }

      if (!mensajeSolicitado || mensajeSolicitado.length > 500) {
        return respuestaJson(
          req,
          { error: 'El mensaje debe contener entre 1 y 500 caracteres' },
          400
        )
      }

      if (
        /[<>]/.test(tituloSolicitado) ||
        /[<>]/.test(mensajeSolicitado)
      ) {
        return respuestaJson(
          req,
          { error: 'El título y el mensaje deben ser texto plano, sin HTML' },
          400
        )
      }

      const { data: clientes, error: errorClientes } = await supabaseAdmin
        .from('usuarios')
        .select('user_id, rol, tenant_id')
        .in('user_id', clienteIds)

      if (errorClientes) {
        console.error(
          '[enviar-push] No se pudieron validar los clientes:',
          errorClientes
        )
        return respuestaJson(
          req,
          { error: 'No se pudieron validar los destinatarios' },
          500
        )
      }

      if ((clientes || []).length !== clienteIds.length) {
        return respuestaJson(
          req,
          { error: 'Uno o más clientes no existen' },
          400
        )
      }

      if (
        (clientes || []).some(
          (cliente: any) => cliente.rol !== 'cliente'
        )
      ) {
        return respuestaJson(
          req,
          { error: 'La lista contiene usuarios que no son clientes' },
          400
        )
      }

      if (
        perfilAdministrador?.es_superadmin !== true &&
        (clientes || []).some(
          (cliente: any) =>
            cliente.tenant_id !== perfilAdministrador?.tenant_id
        )
      ) {
        return respuestaJson(
          req,
          { error: 'Uno o más clientes pertenecen a otro tenant' },
          403
        )
      }

      destinatarios = clienteIds as string[]
      titulo = tituloSolicitado
      cuerpo = mensajeSolicitado
      tipoFirebase = 'admin'
    }

    if (tipoNotificacion === 'interno_pedido_sin_asignar') {
      if (!idValido(solicitud.pedido_id)) {
        return respuestaJson(req, { error: 'pedido_id inválido' }, 400)
      }
      const { data: pedido } = await supabaseAdmin
        .from('pedidos')
        .select('id, tenant_id')
        .eq('id', solicitud.pedido_id)
        .maybeSingle()
      if (!pedido) return respuestaJson(req, { error: 'Pedido no encontrado' }, 404)

      const { data: administradores } = await supabaseAdmin
        .from('usuarios')
        .select('user_id')
        .eq('rol', 'admin')
        .or(`tenant_id.eq.${pedido.tenant_id},es_superadmin.eq.true`)
      destinatarios = (administradores || []).map(
        (usuario: any) => usuario.user_id
      )
      titulo = `⚠️ Pedido GK-${pedido.id} sin asignar`
      cuerpo = 'Sin repartidores disponibles — revisión manual requerida'
      tipoFirebase = 'admin'
    }

    if (tipoNotificacion === 'interno_pago_confirmado') {
      if (!idValido(solicitud.envio_id)) {
        return respuestaJson(req, { error: 'envio_id inválido' }, 400)
      }
      const { data: envio } = await supabaseAdmin
        .from('envios_nacionales')
        .select('id, user_id, paqueteria, pago_verificado')
        .eq('id', solicitud.envio_id)
        .maybeSingle()
      if (!envio?.pago_verificado) {
        return respuestaJson(req, { error: 'Pago no confirmado' }, 409)
      }
      destinatarios = envio.user_id ? [envio.user_id] : []
      titulo = '✅ Pago confirmado'
      cuerpo = `Estamos generando tu guía de ${envio.paqueteria || 'paquetería'}, te avisaremos en cuanto esté lista`
      tipoFirebase = 'envio'
    }

    if (tipoNotificacion === 'interno_guia_generada') {
      if (!idValido(solicitud.envio_id)) {
        return respuestaJson(req, { error: 'envio_id inválido' }, 400)
      }
      const { data: envio } = await supabaseAdmin
        .from('envios_nacionales')
        .select('id, user_id, paqueteria, numero_guia, recoleccion_request_number')
        .eq('id', solicitud.envio_id)
        .maybeSingle()
      if (!envio?.numero_guia) {
        return respuestaJson(
          req,
          { error: 'La guía todavía no está guardada' },
          409
        )
      }
      const recoleccionManual =
        envio.recoleccion_request_number === 'PENDIENTE_MANUAL'
      destinatarios = envio.user_id ? [envio.user_id] : []
      titulo = '📦 ¡Tu guía está lista!'
      cuerpo = recoleccionManual
        ? `Tu guía ${envio.numero_guia} se generó correctamente, pero la recolección deberá agendarse manualmente. Nuestro equipo dará seguimiento.`
        : `Tu envío con ${envio.paqueteria || 'la paquetería'} ya tiene número de guía: ${envio.numero_guia}. Descarga tu guía desde la app.`
      tipoFirebase = 'envio'
    }

    const accessToken = await obtenerAccessToken()
    const resultado = await enviarAUsuarios(
      supabaseAdmin,
      destinatarios,
      titulo,
      cuerpo,
      tipoFirebase,
      accessToken
    )
    return respuestaJson(req, resultado)
  } catch (error: any) {
    console.error(
      '[enviar-push] Error procesando la notificación:',
      error.message
    )
    return respuestaJson(
      req,
      { error: 'No fue posible enviar la notificación' },
      500
    )
  }
})
