import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowedOrigins = ['https://guepack.com', 'https://www.guepack.com']

const corsHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') ?? ''
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    let user_id: string
    try {
      const body = await req.json()
      user_id = body.user_id
    } catch {
      return new Response(JSON.stringify({ error: 'Body inválido' }), {
        status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id es requerido' }), {
        status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    // Verifica JWT y que el caller sea admin
    const authHeader = req.headers.get('Authorization')
    const supabaseUrl = Deno.env.get('SB_URL') ?? 'https://zkrnjdsnuyjaxxnluzmn.supabase.co'
    const serviceKey  = Deno.env.get('SERVICE_ROLE_KEY')!

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader ?? '' } } }
    )
    const { data: { user: caller }, error: callerErr } = await supabaseUser.auth.getUser()
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const { data: perfil } = await supabaseAdmin
      .from('usuarios')
      .select('rol')
      .eq('user_id', caller.id)
      .single()

    if (perfil?.rol !== 'admin') {
      return new Response(JSON.stringify({ error: 'Acceso restringido a administradores' }), {
        status: 403, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    console.log('Intentando eliminar user_id:', user_id)

    const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id)

    console.log('Resultado deleteUser - error:', error?.message ?? 'ninguno')

    if (error) {
      console.error('[eliminar-usuario] error:', error.message)
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    console.log('[eliminar-usuario] eliminado OK:', user_id)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('[eliminar-usuario] ERROR FATAL:', err.message, err.stack)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }
})
