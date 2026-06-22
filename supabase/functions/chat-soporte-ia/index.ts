Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    })
  }

  const { messages } = await req.json()
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  console.log('API KEY existe:', !!ANTHROPIC_API_KEY)
  console.log('API KEY primeros chars:', ANTHROPIC_API_KEY?.substring(0, 10))

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
  console.log('Anthropic response status:', response.status)
  console.log('Anthropic response data:', JSON.stringify(data))

  if (!response.ok) {
    return new Response(JSON.stringify({
      respuesta: 'Error: ' + (data.error?.message || 'Error desconocido'),
      error: data
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  const respuesta = data.content?.[0]?.text || 'Lo siento, no pude procesar tu mensaje.'

  return new Response(JSON.stringify({ respuesta }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  })
})
