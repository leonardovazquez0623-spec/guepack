import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PHONE_NUMBER_ID = '1198005173387148'
const ACCESS_TOKEN = 'EAAasbYvxKBYBRtbZATE7716JawwTXu36jtjuByfbSKHr2JFfGwlwq6mNNPnfgpoDAZA1Hhp1mjS5ZBkl9p8BkWlGNHZCeNC8h5Vo8F6yZCd0X2HtgLm8Fmn8QCiSZAfmB8f9HBZB3FLxyGalLwqJTcVZAHVQGI55bAfMH1hwz1UwrwqLHgB5GmiiVqBf55o8GDCXs4vy3tFhXcABiU6yO8fdKVmSXeIqvZAQysBTSnXEhCmRuZCjRyQkRZAYA5xN23gK3yVSRy7ObnzQGyuSqcXhZBuZBwkiy'

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