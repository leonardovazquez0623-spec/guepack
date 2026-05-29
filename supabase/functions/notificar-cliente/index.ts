import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TWILIO_SID = 'AC79eafe8b6fcb3c5261b92f74a4b79f66';
const TWILIO_TOKEN = '9d556306ea9346751c174fce1a3382cc';
const TWILIO_NUMBER = 'whatsapp:+14155238886';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const body = await req.json();
  const telefono = body.telefono;
  const mensaje = body.mensaje;

  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Messages.json';

  const params = new URLSearchParams();
  params.append('From', TWILIO_NUMBER);
  params.append('To', 'whatsapp:+52' + telefono);
  params.append('Body', mensaje);

  const creds = TWILIO_SID + ':' + TWILIO_TOKEN;
  const encoded = btoa(creds);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + encoded,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const data = await response.json();

  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});