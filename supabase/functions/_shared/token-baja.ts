async function hmacHex(secret: string, mensaje: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", key, encoder.encode(mensaje));
  return Array.from(new Uint8Array(firma))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function compararConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function firmarBajaToken(
  userId: string,
  secret: string,
): Promise<string> {
  return hmacHex(secret, `baja:${userId}`);
}

export async function verificarBajaToken(
  userId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const esperado = await hmacHex(secret, `baja:${userId}`);
  return compararConstante(esperado, token);
}
