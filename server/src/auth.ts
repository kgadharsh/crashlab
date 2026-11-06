// Signed tokens, so the Worker needs no session table: a token says who the player is and until when,
// and only someone holding SESSION_SECRET can make one that verifies.
const enc = new TextEncoder()
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const key = (secret: string) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function sign(secret: string, payload: object): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(payload)))
  return body + '.' + b64(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)))
}

// The payload if the token is genuine and has not expired, otherwise null
export async function verify<T extends { exp: number }>(secret: string, token: string): Promise<T | null> {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  try {
    if (!(await crypto.subtle.verify('HMAC', await key(secret), unb64(sig), enc.encode(body)))) return null
    const payload = JSON.parse(new TextDecoder().decode(unb64(body))) as T
    return typeof payload.exp === 'number' && payload.exp > Date.now() ? payload : null
  } catch {
    return null
  }
}
