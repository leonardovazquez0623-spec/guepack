import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const origenesPermitidos = ['https://guepack.com', 'https://www.guepack.com']

const encabezadosCors = (req: Request) => {
  const origen = req.headers.get('Origin') ?? ''
  const origenPermitido = origenesPermitidos.includes(origen)
    ? origen
    : origenesPermitidos[0]

  return {
    'Access-Control-Allow-Origin': origenPermitido,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type'
  }
}

function respuestaJson(
  req: Request,
  contenido: unknown,
  estado = 200
) {
  return new Response(JSON.stringify(contenido), {
    status: estado,
    headers: {
      ...encabezadosCors(req),
      'Content-Type': 'application/json'
    }
  })
}

function esUuid(valor: unknown): valor is string {
  return (
    typeof valor === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(valor)
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: encabezadosCors(req) })
  }

  if (req.method !== 'POST') {
    return respuestaJson(req, { error: 'Método no permitido' }, 405)
  }

  try {
    let userIdObjetivo: string

    try {
      const cuerpo = await req.json()
      userIdObjetivo = cuerpo.user_id
    } catch {
      return respuestaJson(
        req,
        { error: 'El cuerpo de la solicitud no es válido' },
        400
      )
    }

    if (!esUuid(userIdObjetivo)) {
      return respuestaJson(
        req,
        { error: 'El user_id objetivo no es válido' },
        400
      )
    }

    const tokenJwt = (req.headers.get('Authorization') || '')
      .replace(/^Bearer\s+/i, '')

    if (!tokenJwt) {
      return respuestaJson(req, { error: 'No autorizado' }, 401)
    }

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL') ??
      Deno.env.get('SB_URL')
    const claveServicio =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY')
    const claveAnonima = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !claveServicio || !claveAnonima) {
      console.error(
        '[eliminar-usuario] Faltan variables de entorno requeridas'
      )
      return respuestaJson(
        req,
        { error: 'Configuración interna incompleta' },
        500
      )
    }

    const supabaseUsuario = createClient(supabaseUrl, claveAnonima)
    const {
      data: { user: llamador },
      error: errorLlamador
    } = await supabaseUsuario.auth.getUser(tokenJwt)

    if (errorLlamador || !llamador) {
      return respuestaJson(req, { error: 'No autorizado' }, 401)
    }

    if (llamador.id === userIdObjetivo) {
      return respuestaJson(
        req,
        { error: 'No puedes eliminar tu propia cuenta' },
        403
      )
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      claveServicio,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const {
      data: perfilLlamador,
      error: errorPerfilLlamador
    } = await supabaseAdmin
      .from('usuarios')
      .select('rol, tenant_id, es_superadmin')
      .eq('user_id', llamador.id)
      .maybeSingle()

    if (errorPerfilLlamador) {
      console.error(
        '[eliminar-usuario] No se pudo consultar el perfil del administrador:',
        errorPerfilLlamador
      )
      return respuestaJson(
        req,
        { error: 'No se pudo validar al administrador' },
        500
      )
    }

    if (perfilLlamador?.rol !== 'admin') {
      return respuestaJson(
        req,
        { error: 'Acceso restringido a administradores' },
        403
      )
    }

    const {
      data: perfilObjetivo,
      error: errorPerfilObjetivo
    } = await supabaseAdmin
      .from('usuarios')
      .select('user_id, rol, tenant_id, es_superadmin, email')
      .eq('user_id', userIdObjetivo)
      .maybeSingle()

    if (errorPerfilObjetivo) {
      console.error(
        '[eliminar-usuario] No se pudo consultar el usuario objetivo:',
        errorPerfilObjetivo
      )
      return respuestaJson(
        req,
        { error: 'No se pudo validar el usuario objetivo' },
        500
      )
    }

    if (!perfilObjetivo) {
      return respuestaJson(
        req,
        { error: 'El usuario objetivo no existe' },
        404
      )
    }

    const esSuperadmin = perfilLlamador.es_superadmin === true
    const perteneceAlMismoTenant =
      perfilLlamador.tenant_id != null &&
      perfilLlamador.tenant_id === perfilObjetivo.tenant_id

    if (!esSuperadmin && !perteneceAlMismoTenant) {
      return respuestaJson(
        req,
        { error: 'No puedes eliminar usuarios de otro tenant' },
        403
      )
    }

    const objetivoEsAdministrador =
      perfilObjetivo.rol === 'admin' ||
      perfilObjetivo.es_superadmin === true

    if (!esSuperadmin && objetivoEsAdministrador) {
      return respuestaJson(
        req,
        {
          error:
            'Solo un superadministrador puede eliminar administradores'
        },
        403
      )
    }

    const { data: pedidos, error: errorPedidosConsulta } =
      await supabaseAdmin
        .from('pedidos')
        .select('id')
        .eq('user_id', userIdObjetivo)

    if (errorPedidosConsulta) {
      console.error(
        '[eliminar-usuario] No se pudieron consultar los pedidos relacionados:',
        errorPedidosConsulta
      )
      return respuestaJson(
        req,
        { error: 'No se pudieron consultar los datos relacionados del usuario' },
        500
      )
    }

    const pedidoIds = (pedidos || [])
      .map((pedido: any) => pedido.id)
      .filter(Boolean)

    const { error: errorAuth } =
      await supabaseAdmin.auth.admin.deleteUser(userIdObjetivo)

    if (errorAuth) {
      console.error(
        '[eliminar-usuario] No se pudo eliminar la cuenta de autenticación:',
        errorAuth.message
      )
      return respuestaJson(
        req,
        {
          success: false,
          cuenta_auth_eliminada: false,
          error:
            'No se eliminó la cuenta porque Authentication rechazó la operación'
        },
        500
      )
    }

    const verificarEliminacion = (
      error: any,
      descripcion: string
    ) => {
      if (error) {
        throw new Error(`${descripcion}: ${error.message}`)
      }
    }

    try {
      if (pedidoIds.length) {
        const eliminacionesPedidos = await Promise.all([
          supabaseAdmin
            .from('driver_locations')
            .delete()
            .in('pedido_id', pedidoIds),
          supabaseAdmin
            .from('paradas')
            .delete()
            .in('pedido_id', pedidoIds),
          supabaseAdmin
            .from('mensajes')
            .delete()
            .in('pedido_id', pedidoIds),
          supabaseAdmin
            .from('calificaciones')
            .delete()
            .in('pedido_id', pedidoIds)
        ])

        eliminacionesPedidos.forEach(resultado => {
          verificarEliminacion(
            resultado.error,
            'No se pudieron eliminar datos relacionados con los pedidos'
          )
        })
      }

      const eliminacionesUsuario = await Promise.all([
        supabaseAdmin
          .from('pedidos')
          .delete()
          .eq('user_id', userIdObjetivo),
        supabaseAdmin
          .from('usuarios_tokens')
          .delete()
          .eq('user_id', userIdObjetivo),
        supabaseAdmin
          .from('driver_locations')
          .delete()
          .eq('driver_id', userIdObjetivo),
        supabaseAdmin
          .from('referidos')
          .delete()
          .eq('user_id_referido', userIdObjetivo),
        supabaseAdmin
          .from('eventos_trafico')
          .delete()
          .eq('user_id', userIdObjetivo)
      ])

      eliminacionesUsuario.forEach(resultado => {
        verificarEliminacion(
          resultado.error,
          'No se pudieron eliminar los datos relacionados del usuario'
        )
      })

      if (
        perfilObjetivo.rol === 'repartidor' &&
        perfilObjetivo.email &&
        perfilObjetivo.tenant_id != null
      ) {
        const { error: errorRepartidor } = await supabaseAdmin
          .from('repartidores')
          .delete()
          .eq('email', perfilObjetivo.email)
          .eq('tenant_id', perfilObjetivo.tenant_id)

        verificarEliminacion(
          errorRepartidor,
          'No se pudo eliminar el registro del repartidor'
        )
      }

      const { error: errorUsuario } = await supabaseAdmin
        .from('usuarios')
        .delete()
        .eq('user_id', userIdObjetivo)

      verificarEliminacion(
        errorUsuario,
        'No se pudo eliminar el perfil del usuario'
      )
    } catch (errorLimpieza: any) {
      console.error(
        '[eliminar-usuario] ATENCIÓN: la cuenta de Authentication fue eliminada, pero quedaron datos relacionados:',
        errorLimpieza.message
      )
      return respuestaJson(
        req,
        {
          success: false,
          cuenta_auth_eliminada: true,
          requiere_revision_manual: true,
          error:
            'La cuenta ya no puede iniciar sesión, pero quedaron datos relacionados que requieren limpieza manual'
        },
        500
      )
    }

    console.log(
      '[eliminar-usuario] Usuario y datos relacionados eliminados correctamente'
    )
    return respuestaJson(req, {
      success: true,
      cuenta_auth_eliminada: true
    })
  } catch (error: any) {
    console.error(
      '[eliminar-usuario] Error al eliminar el usuario:',
      error.message
    )
    return respuestaJson(
      req,
      {
        success: false,
        error: 'No fue posible eliminar completamente el usuario'
      },
      500
    )
  }
})
