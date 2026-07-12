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

  // Verifica JWT del usuario antes de llamar a Anthropic
  const authHeader = req.headers.get('Authorization')
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader ?? '' } } }
  )
  const { data: { user }, error: userErr } = await supabaseUser.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  const { messages } = await req.json()
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: 'Eres el asistente de soporte de GUEPACK Express, una paquetería local en Guadalajara, México. Ayuda a los clientes con dudas sobre: estados de pedidos, precios (base $115 hasta 5km, $13/km extra), horarios (Lunes-Viernes 10am-5:30pm), cancelaciones (gratis en 5 min, $25 después), zonas de cobertura GDL/Zapopan/Tlaquepaque. Si no puedes resolver el problema o el cliente pide hablar con humano, responde exactamente: [ESCALAR]. Responde siempre en español, de forma amable y concisa. Máximo 3 oraciones.',
      messages: messages
    })
  })

  const data = await response.json()

  if (!response.ok) {
    return new Response(JSON.stringify({
      respuesta: 'Error: ' + (data.error?.message || 'Error desconocido'),
      error: data
    }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  const respuesta = data.content?.[0]?.text || 'Lo siento, no pude procesar tu mensaje.'

  return new Response(JSON.stringify({ respuesta }), {
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
  })
})
