import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PHONE_NUMBER_ID = '1198005173387148'
const ACCESS_TOKEN = 'EAAasbYvxKBYBRhXSQuMVLM0derXR3EkpLUmpmifuK9xmyk0H04xlsy7XDq1yAGC0sHCclm1XncBGZAZBKHlgP9dnpNBkudYislYcRyHZCvjptOQnWItrQZBarZATTlevjrRmrA9XZBgEXGQpo9BVYb7MoMTAj8E5Sunro1TYxsKQ9VxkpQsnYK2xZAHQ5SPWdpFKHmk6UrDkTh7Q6QZCXVmF1lAKKDc0HgxQAqTuTHVhttnjqbh6J2WRWOESxXXkIgYvRSclXCAXAOqouTToDAFDNvMH9QZDZD'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const body = await req.json()
  const telefono = body.telefono
  const mensaje = body.mensaje

  const url = 'https://graph.facebook.com/v18.0/' + PHONE_NUMBER_ID + '/messages'

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: '52' + telefono,
      type: 'text',
      text: { body: mensaje }
    })
  })

  const data = await response.json()

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})