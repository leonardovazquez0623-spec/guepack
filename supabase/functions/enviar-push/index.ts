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

const firebasePrivateKey = Deno.env.get('FIREBASE_PRIVATE_KEY')!.replace(/\\n/g, '\n')
const firebaseClientEmail = Deno.env.get('FIREBASE_CLIENT_EMAIL')!
const firebaseProjectId = Deno.env.get('FIREBASE_PROJECT_ID')!

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const tokenUri = 'https://oauth2.googleapis.com/token'
  const payload = {
    iss: firebaseClientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    exp: now + 3600,
    iat: now
  }

  const encode = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const headerB64  = encode(header)
  const payloadB64 = encode(payload)
  const signingInput = `${headerB64}.${payloadB64}`

  const keyData = firebasePrivateKey
    .replace('-----BEGIN PRIVATE KEY-----\n', '')
    .replace('\n-----END PRIVATE KEY-----\n', '')
    .replace(/\n/g, '')

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))

  let cryptoKey: CryptoKey
  try {
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8', binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    )
  } catch (err: any) {
    console.error('[getAccessToken] Error importando clave privada:', err.message)
    throw new Error('importKey falló: ' + err.message)
  }

  let signature: ArrayBuffer
  try {
    signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signingInput)
    )
  } catch (err: any) {
    console.error('[getAccessToken] Error firmando JWT:', err.message)
    throw new Error('sign falló: ' + err.message)
  }

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${signingInput}.${signatureB64}`

  let tokenData: any
  try {
    const tokenRes = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    })
    console.log('[getAccessToken] OAuth status:', tokenRes.status)
    tokenData = await tokenRes.json()
    console.log('[getAccessToken] OAuth response:', JSON.stringify(tokenData))
    if (!tokenData.access_token) {
      throw new Error('Respuesta sin access_token: ' + JSON.stringify(tokenData))
    }
  } catch (err: any) {
    console.error('[getAccessToken] Error en fetch OAuth:', err.message)
    throw err
  }

  return tokenData.access_token
}

async function sendFCMMessage(fcmToken: string, title: string, body: string, tipo: string, accessToken: string): Promise<any> {
  const firebaseUrl = `https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`
  try {
    const firebaseResponse = await fetch(firebaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body },
          data: { titulo: title, cuerpo: body, tipo: tipo || 'general' },
          android: { notification: { sound: 'default', channel_id: 'guepack_pedidos' } },
          apns: { payload: { aps: { sound: 'default', 'content-available': 1 } } },
          webpush: {
            notification: { title, body, icon: '/logo_icono.png', badge: '/logo_icono.png' },
            fcm_options: { link: 'https://guepack.com' }
          }
        }
      })
    })
    console.log('[FCM] status:', firebaseResponse.status, '| token:', fcmToken.slice(0, 20) + '...')
    const data = await firebaseResponse.json()
    console.log('[FCM] response:', JSON.stringify(data))
    return data
  } catch (err: any) {
    console.error('[FCM] Error llamando Firebase:', err.message)
    throw err
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  // Parsear body
  let token: string, user_id: string, title: string, body: string, tipo: string
  try {
    const parsed = await req.json()
    token   = parsed.token
    user_id = parsed.user_id
    title   = parsed.title
    body    = parsed.body
    tipo    = parsed.tipo
    console.log('[enviar-push] modo:', user_id ? 'user_id=' + user_id : 'token=' + token?.slice(0, 20) + '...', '| title:', title)
  } catch (err: any) {
    console.error('[enviar-push] Error parseando body:', err.message)
    return new Response(JSON.stringify({ error: 'Body inválido', detail: err.message }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'Faltan campos requeridos: title, body' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  if (!token && !user_id) {
    return new Response(JSON.stringify({ error: 'Se requiere token o user_id' }), {
      status: 400,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  // Obtener access token de Firebase
  let accessToken: string
  try {
    accessToken = await getAccessToken()
    console.log('[enviar-push] Access token obtenido OK')
  } catch (err: any) {
    console.error('[enviar-push] Error en getAccessToken:', err.message)
    return new Response(JSON.stringify({ error: 'Error obteniendo token Firebase', detail: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  // Modo user_id: obtener todos los tokens del usuario y enviar a cada uno
  if (user_id) {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: tokenRows, error: tkErr } = await supabase
      .from('usuarios_tokens')
      .select('fcm_token')
      .eq('user_id', user_id)
    console.log('[enviar-push] tokens para user_id', user_id, ':', tokenRows?.length ?? 0, '| error:', tkErr?.message)

    if (!tokenRows?.length) {
      return new Response(JSON.stringify({ sent: 0, message: 'Sin tokens registrados para este usuario' }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    const INVALID_CODES = new Set(['INVALID_REGISTRATION', 'UNREGISTERED', 'SENDER_ID_MISMATCH'])

    const results = await Promise.all(
      tokenRows.map(async ({ fcm_token }) => {
        try {
          const data = await sendFCMMessage(fcm_token, title, body, tipo, accessToken)

          // Detectar token inválido por errorCode en details o por status NOT_FOUND
          const errorCode: string | null =
            data?.error?.details?.find((d: any) => d.errorCode)?.errorCode
            ?? (data?.error?.status === 'NOT_FOUND' ? 'UNREGISTERED' : null)

          if (errorCode && INVALID_CODES.has(errorCode)) {
            console.log(`[enviar-push] token inválido (${errorCode}) — eliminando:`, fcm_token.slice(0, 20))
            await supabase.from('usuarios_tokens').delete().eq('fcm_token', fcm_token)
            return { deleted: true, reason: errorCode, token: fcm_token.slice(0, 20) }
          }

          return data
        } catch (err: any) {
          return { error: err.message, token: fcm_token.slice(0, 20) }
        }
      })
    )

    const sent = results.filter((r: any) => !r?.deleted && !r?.error).length
    return new Response(JSON.stringify({ sent, results }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }

  // Modo token único (backwards compatible)
  try {
    const firebaseData = await sendFCMMessage(token, title, body, tipo, accessToken)
    return new Response(JSON.stringify(firebaseData), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('[enviar-push] Error llamando Firebase:', err.message)
    return new Response(JSON.stringify({ error: 'Error llamando Firebase FCM', detail: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }
})
