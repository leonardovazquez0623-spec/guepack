import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "guepack-app",
  "private_key_id": "dd85718f39a48e22c6b12febb061fec49d73d3c7",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDp+aLJ6YNr9HSm\nKOA5M0jr9k+KEC2L9fjawAgfUbmb6G32CL0rjgsjgGQQQa6TXODnQoJdZ/L44/Qo\nwYNe7qcwnNgZgzgiaVGOVdqCbCeDHNYHntjgGZoWW0WG92eoxRjnmC4sc6YbPGpz\nonrrkh4z7925e26WBnFVPFro1TsxpYICqtMESVAfcM02F/t3Ow6+k7XPFIoyNhXl\nOhjdBpkbUzT+LsM4E69T6myAjUDsfINwuWyUSSTpxJrPbToDWOSC1kDZS9ZqlX+q\nyM7blDAWhXm6Mp7gxkRwZZSzjZVSYGjEqcjTjnay8fJJwQP6Cn6WGaMJTuJ4up1L\nK1W0XlOdAgMBAAECggEAEhRAB+oLRaQ1/0DZUpIr6E+4BasKWe4/tGdyOTlPZkSn\neoNiWqM3KR8anEb2/lwG5Ne2yxDlLWYvz5ZkWEmIkbEM4avKAp6wtpbbs4g35WGt\nCBm2GFriFSgoTy1+zQOt0PdpWfX1t9ULRLQhW2KHAuxd7Z8kBGOrDjMDs0oGsOc7\nOfTV8KbLAOxIALz2H0+WaOkSeILCx2cFBU0DflWzGNyvkID66sfDVlsw99PE7d6f\ntLpLB9xzKNMl3+ChuUkpsi15U2BWZU3Zm6+Ab2o4uD2Nqo6oamKuDMYnqAXzPKns\n2xz16Gvcu0e+oeIyXIwbIvi1jWKrcCryDhmKtuXv4QKBgQD1lRnZ1hJWHF5SV3WY\nTdInc0GlMu1uy/6BPFrCfLkN8/P//ys1BkcRsuruz4WzTocFelm+uybpXzBtz+qD\nQSblcRlMDBKvcWIyqPi9GJRi0qFDfbZsQ52fsaeIs6AQxFdehTn9LdX0wTi9CUlA\nqDnynYUSuRXfkR0x0gjpfHcwJwKBgQDz5nxaXoGcMzwWuS0phIVUDxZxl3CLuDlh\nFFifz90KnrAR9BEiBfxuz5TB4vBCt0IM9Xa+UhUjaef1CONKRrNC1/KRRUC/J+Yc\nZg284zgChk3fR5ckz44hvVEIc7bBfZjwHCj4RCpLY/LxoXzOTXGF84hnkBxBcmny\nF+QZsZn0mwKBgQCrHg5aNAioybGLTHea/Tae2Hd4RYkdd7TJliVjeQZ0y3RL/x+7\nHbmtgm6ioiT2MJRyY7Ne7AcL+5DCI2qztFUG8IyA6bSnXKjgxc4z7ImQZlWJsnHG\n9EJDgMVMwmSY6kY6jTg/yo1Xsr73MR5CmDVwcQPFbQPpuLKQAVrGXjyqZwKBgHh6\ncRDewB1dfaAn5rQsfwPP1CFWUkTiQo2+1CxVLHYTfxvPOStaU6CVL4E6zb3W8mye\nUAKhX0m4BdmXg1bsZ55sN6kk0V/boKKEkuKsRr2QhCT4IyQO1sG5165aInufxA1P\ni7lfSpklDRvozlLGFH67lrS5jguSLd1licpbXZZjAoGAHCgUG0wCBUfzn7lzYsrP\nf02DWLsZa4YdxrRNBVEq23BrwT0U0yfkIoGUX9ePoV4YFVoZiKtMVse8o05P1e0f\nTj6P4QzDDWb40GaN8AQpE8A0lnc+lotFtvR6lmqwXGsl6FhKScz1nz0MTd8/ML/8\nMLlKbrbXXlMJI7j04mb+eME=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@guepack-app.iam.gserviceaccount.com",
  "client_id": "105624839054612898546",
  "token_uri": "https://oauth2.googleapis.com/token"
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: SERVICE_ACCOUNT.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: SERVICE_ACCOUNT.token_uri,
    exp: now + 3600,
    iat: now
  }

  const encode = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const headerB64  = encode(header)
  const payloadB64 = encode(payload)
  const signingInput = `${headerB64}.${payloadB64}`

  const privateKey = SERVICE_ACCOUNT.private_key
  const keyData = privateKey
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
    const tokenRes = await fetch(SERVICE_ACCOUNT.token_uri, {
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
  const firebaseUrl = `https://fcm.googleapis.com/v1/projects/guepack-app/messages:send`
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
    return new Response('ok', { headers: corsHeaders })
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!title || !body) {
    return new Response(JSON.stringify({ error: 'Faltan campos requeridos: title, body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!token && !user_id) {
    return new Response(JSON.stringify({ error: 'Se requiere token o user_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const results = await Promise.all(
      tokenRows.map(({ fcm_token }) =>
        sendFCMMessage(fcm_token, title, body, tipo, accessToken)
          .catch((err: any) => ({ error: err.message, token: fcm_token.slice(0, 20) }))
      )
    )
    return new Response(JSON.stringify({ sent: tokenRows.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Modo token único (backwards compatible)
  try {
    const firebaseData = await sendFCMMessage(token, title, body, tipo, accessToken)
    return new Response(JSON.stringify(firebaseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('[enviar-push] Error llamando Firebase:', err.message)
    return new Response(JSON.stringify({ error: 'Error llamando Firebase FCM', detail: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
