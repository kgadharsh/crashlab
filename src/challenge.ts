// A challenge link carries a whole car in the part of the web address after the #, so a friend can
// race it with no server. The car is checked like any car file before it is used, and its result is
// worked out again on the friend's own device, so both cars run on the same engine.
import { carFromJson, carToJson, type CarFile } from './carFile'

const PREFIX = '#challenge='
const MAX_CODE = 12000 // a car with nine rays is about 3000 characters; much longer is not a car

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): string {
  const base = code.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base + '='.repeat((4 - (base.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

// The part of the address that holds the car (add it to the game's address to make the link)
export const challengeCode = (car: CarFile): string => PREFIX + toBase64Url(carToJson(car))

// Read the car out of an address's # part. Returns null when there is no challenge in it, or a
// plain-words reason when there is one that cannot be used.
export function carFromChallenge(hash: string): CarFile | { error: string } | null {
  if (!hash.startsWith(PREFIX)) return null
  const code = hash.slice(PREFIX.length)
  if (!code || code.length > MAX_CODE) return { error: 'That challenge link is not a whole car.' }
  let text: string
  try {
    text = fromBase64Url(code)
  } catch {
    return { error: 'That challenge link is damaged.' }
  }
  const car = carFromJson(text)
  // the car file's wording talks about files; a link was not one
  if ('error' in car && car.error.startsWith('That file')) return { error: 'That challenge link is damaged.' }
  return car
}

// ---------- SHORT LINKS ----------
// The server keeps a shared car under a 10-character code, so the link is short: the game's address plus #c=code.
// If the server cannot be reached, sharing falls back to the long link above, which needs no server.
export const SHORT_PREFIX = '#c='
const withTimeout = (ms: number) => {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}
export async function shortCode(car: CarFile, api: string): Promise<string | null> {
  if (!api) return null
  try {
    const res = await fetch(api + '/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ car: carToJson(car) }), signal: withTimeout(5000) })
    const data = (await res.json()) as { code?: string }
    return res.ok && data.code ? data.code : null
  } catch {
    return null
  }
}
export async function carFromShort(hash: string, api: string): Promise<CarFile | { error: string } | null> {
  if (!hash.startsWith(SHORT_PREFIX)) return null
  const code = hash.slice(SHORT_PREFIX.length)
  if (!/^[A-Za-z0-9_-]{10}$/.test(code)) return { error: 'That challenge link is damaged.' }
  if (!api) return { error: 'Challenge links need the board server, which is not set up here.' }
  try {
    const res = await fetch(api + '/challenges/' + code, { signal: withTimeout(8000) })
    const data = (await res.json()) as { car?: string; error?: string }
    if (!res.ok || !data.car) return { error: data.error ?? 'That challenge link could not be opened.' }
    return carFromJson(data.car)
  } catch {
    return { error: 'The challenge could not be loaded. Check your connection and open the link again.' }
  }
}
