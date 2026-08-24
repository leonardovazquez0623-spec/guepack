const ORIGEN_FALLBACK = 'https://guepack.com'

export function esOrigenPermitido(origen: string | null): boolean {
  if (!origen) return false
  try {
    const hostname = new URL(origen).hostname
    return hostname === 'guepack.com' || hostname.endsWith('.guepack.com')
  } catch {
    return false
  }
}

export function origenPermitidoOFallback(origen: string | null): string {
  return esOrigenPermitido(origen) ? (origen as string) : ORIGEN_FALLBACK
}
