import "@supabase/functions-js/edge-runtime.d.ts";
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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  const tokenJwt = authHeader.replace(/^Bearer\s+/i, '')
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY')
  if (tokenJwt !== claveServicio) {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    )
    const { data: { user }, error } = await supabaseClient.auth.getUser(tokenJwt)
    if (error || !user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401,
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }
  }

  try {
    let pedido_id: number, ronda: number
    try {
      const body = await req.json()
      pedido_id = Number(body.pedido_id)
      ronda     = Number(body.ronda)
    } catch {
      return new Response(JSON.stringify({ error: 'Body inválido' }), {
        status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    if (!pedido_id || !ronda) {
      return new Response(JSON.stringify({ error: 'pedido_id y ronda son requeridos' }), {
        status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    console.log('[procesar] pedido_id:', pedido_id, 'ronda:', ronda)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SERVICE_ROLE_KEY')!
    const supabase    = createClient(supabaseUrl, serviceKey)

    console.log(`[procesar-asignacion] pedido=${pedido_id} ronda=${ronda}`)

    // ── 1. Verificar si ya fue aceptado ─────────────────────────────────────────
    const { data: pedido, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, repartidor, estado, direccion_recoleccion')
      .eq('id', pedido_id)
      .single()

    console.log('[procesar] pedido estado actual:', pedido?.repartidor, pedido?.estado)

    if (pedErr || !pedido) {
      console.warn('[procesar-asignacion] pedido no encontrado:', pedErr?.message)
      return new Response(JSON.stringify({ skipped: true, reason: 'pedido no encontrado' }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    if (pedido.repartidor) {
      console.log('[procesar-asignacion] ya aceptado por', pedido.repartidor, '— cancelando rondas pendientes')
      await supabase.from('rondas_pendientes')
        .update({ procesado: true })
        .eq('pedido_id', pedido_id)
        .eq('procesado', false)
      return new Response(JSON.stringify({ skipped: true, reason: 'ya aceptado' }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    // ── 2. Leer configuración de rondas ─────────────────────────────────────────
    const { data: cfgRows } = await supabase
      .from('config_app')
      .select('key, value')
      .in('key', ['tiempo_aceptar', 'pausa_rondas', 'max_rondas'])
    const cfg: Record<string, string> = {}
    cfgRows?.forEach((r: any) => { cfg[r.key] = r.value })
    const tiempoAceptar = parseInt(cfg.tiempo_aceptar || '60', 10)
    const pausaRondas   = parseInt(cfg.pausa_rondas   || '20', 10)
    const maxRondas     = parseInt(cfg.max_rondas     || '3',  10)
    console.log(`[procesar-asignacion] config — tiempo_aceptar:${tiempoAceptar} pausa_rondas:${pausaRondas} max_rondas:${maxRondas}`)

    // ── 3. Obtener repartidores disponibles ─────────────────────────────────────
    const { data: repas } = await supabase
      .from('repartidores')
      .select('email, nombre')
      .eq('disponible', true)
    console.log(`[procesar-asignacion] repartidores disponibles: ${repas?.length ?? 0}`)
    console.log('[procesar] repartidores disponibles:', repas?.length, repas)

    if (!repas?.length) {
      console.log('[procesar-asignacion] sin repartidores — notificando admin')
      await _notificarAdmins(supabase, supabaseUrl, serviceKey, pedido_id)
      return new Response(JSON.stringify({ ronda, sinRepartidores: true }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    // ── 4. Enviar push a repartidores ────────────────────────────────────────────
    const emails = repas.map((r: any) => r.email).filter(Boolean)
    console.log('[procesar-asignacion] buscando user_ids para emails:', emails)

    const { data: users, error: usersErr } = await supabase
      .from('usuarios')
      .select('user_id, email')
      .in('email', emails)

    if (usersErr) console.error('[procesar-asignacion] error query usuarios:', usersErr.message)
    const usersConId = (users || []).filter((u: any) => u.user_id)
    console.log(`[procesar-asignacion] user_ids encontrados: ${usersConId.length} de ${emails.length} emails`)
    if (usersConId.length === 0) console.warn('[procesar-asignacion] ⚠️ ningún repartidor tiene user_id en usuarios — push no se enviará')

    const notifBody = `GK-${pedido_id} · ${pedido.direccion_recoleccion || ''}`
    const pushHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + Deno.env.get('SERVICE_ROLE_KEY')
    }

    await Promise.all(
      usersConId.map(async (u: any) => {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/enviar-push`, {
            method: 'POST',
            headers: pushHeaders,
            body: JSON.stringify({ user_id: u.user_id, title: '📦 Nuevo pedido disponible', body: notifBody, tipo: 'pedido' })
          })
          const responseStatus = res.status
          const responseBody = await res.text()
          console.log('[procesar] resultado enviar-push:', responseStatus, responseBody)
          let json: any = {}
          try {
            json = responseBody ? JSON.parse(responseBody) : {}
          } catch {
            json = { respuesta: responseBody }
          }
          if (!res.ok) {
            console.error(`[procesar-asignacion] enviar-push HTTP ${res.status} para ${u.email}:`, JSON.stringify(json))
          } else {
            console.log(`[procesar-asignacion] push OK para ${u.email} — enviados: ${json.sent ?? 1}`)
          }
        } catch (e: any) {
          console.error('[procesar-asignacion] fetch error a enviar-push para', u.email, ':', e.message)
        }
      })
    )
    console.log(`[procesar-asignacion] push procesados para ${usersConId.length} repartidores`)

    // ── 5. Actualizar ronda_asignacion en el pedido ──────────────────────────────
    await supabase.from('pedidos').update({ ronda_asignacion: ronda }).eq('id', pedido_id)

    // ── 6. Programar siguiente ronda o notificar agotamiento ─────────────────────
    if (ronda < maxRondas) {
      const delaySegundos = tiempoAceptar + pausaRondas
      const ejecutarEn = new Date(Date.now() + delaySegundos * 1000).toISOString()
      await supabase.from('rondas_pendientes').insert({
        pedido_id,
        ronda: ronda + 1,
        ejecutar_en: ejecutarEn,
        procesado: false
      })
      console.log(`[procesar-asignacion] ronda ${ronda + 1} programada para ${ejecutarEn}`)
    } else {
      console.log('[procesar-asignacion] todas las rondas agotadas — notificando admin')
      await _notificarAdmins(supabase, supabaseUrl, serviceKey, pedido_id)
    }

    return new Response(
      JSON.stringify({ ok: true, ronda, siguienteRonda: ronda < maxRondas ? ronda + 1 : null }),
      { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[procesar-asignacion] ERROR FATAL:', err.message, err.stack)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }
})

async function _notificarAdmins(supabase: any, supabaseUrl: string, serviceKey: string, pedidoId: number) {
  const { data: admins, error: admErr } = await supabase
    .from('usuarios')
    .select('user_id')
    .eq('rol', 'admin')
  if (admErr) console.error('[procesar-asignacion] error query admins:', admErr.message)
  const adminsConId = (admins || []).filter((u: any) => u.user_id)
  console.log(`[procesar-asignacion] notificando ${adminsConId.length} admins para pedido ${pedidoId}`)

  await Promise.all(
    adminsConId.map(async (u: any) => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/enviar-push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + Deno.env.get('SERVICE_ROLE_KEY')
          },
          body: JSON.stringify({
            user_id: u.user_id,
            title: `⚠️ Pedido GK-${pedidoId} sin asignar`,
            body: 'Sin repartidores disponibles — revisión manual requerida',
            tipo: 'admin'
          })
        })
        const responseStatus = res.status
        const responseBody = await res.text()
        console.log('[procesar] resultado enviar-push:', responseStatus, responseBody)
        let json: any = {}
        try {
          json = responseBody ? JSON.parse(responseBody) : {}
        } catch {
          json = { respuesta: responseBody }
        }
        if (!res.ok) {
          console.error(`[procesar-asignacion] admin push HTTP ${res.status}:`, JSON.stringify(json))
        } else {
          console.log(`[procesar-asignacion] admin push OK — enviados: ${json.sent ?? 1}`)
        }
      } catch (e: any) {
        console.error('[procesar-asignacion] admin fetch error:', e.message)
      }
    })
  )
}
