// _shared/skydropx-auth.ts
// Helper compartido: obtiene y cachea el bearer token de Skydropx.
// Se reusa en cualquier Edge Function que necesite llamar a la API de Skydropx.

const SKYDROPX_HOST = Deno.env.get("SKYDROPX_ENV") === "production"
  ? "https://pro.skydropx.com"
  : "https://sb-pro.skydropx.com";

const CLIENT_ID = Deno.env.get("SKYDROPX_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("SKYDROPX_CLIENT_SECRET")!;

export function skydropxHost() {
  return SKYDROPX_HOST;
}

export async function getSkydropxToken(supabaseAdmin: any) {
  // 1. Revisa cache en config_app
  const { data: cached } = await supabaseAdmin
    .from("config_app")
    .select("value")
    .eq("key", "skydropx_token_cache")
    .maybeSingle();

  if (cached?.value) {
    const parsed = JSON.parse(cached.value);
    // margen de 60s antes de que expire para evitar carreras
    if (parsed.expires_at && Date.now() < parsed.expires_at - 60_000) {
      return parsed.access_token as string;
    }
  }

  // 2. Pide token nuevo
  const res = await fetch(`${SKYDROPX_HOST}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Skydropx auth falló (${res.status}): ${errBody}`);
  }

  const json = await res.json();
  const expiresAt = Date.now() + json.expires_in * 1000;

  // 3. Guarda en cache
  await supabaseAdmin
    .from("config_app")
    .upsert(
      {
        key: "skydropx_token_cache",
        value: JSON.stringify({ access_token: json.access_token, expires_at: expiresAt }),
      },
      { onConflict: "key" }
    );

  return json.access_token as string;
}
