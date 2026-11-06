// The online board on the Race tab: shows the top cars for a Grand Prix and lets a player enter
// their car. The server re-runs the car itself, so the result shown here is the server's, not ours.
// With no server address (the live site until the server is deployed) the whole panel stays hidden.
import { carToJson, type CarFile } from './carFile'
import { GRAND_PRIXES } from './race'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
const NAME_KEY = 'crashlab.devname'
const TOKEN_KEY = 'crashlab.token'
const NONCE_KEY = 'crashlab.nonce'

type Row = { rank: number; id: number; display: string; finished: number; totalTime: number; medal: string | null }

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode: sign-in lasts until the page closes */ } },
}

// The player named in a sign-in token (the server checks the token itself; this is only for showing the name)
function nameIn(token: string | null): string | null {
  if (!token) return null
  try {
    const body = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))) as { display?: string; exp?: number }
    return typeof p.display === 'string' && typeof p.exp === 'number' && p.exp > Date.now() ? p.display : null
  } catch {
    return null
  }
}

// Coming back from GitHub, the address ends #signin=TOKEN&nonce=N. Keep the token only if the nonce is the one we sent.
function takeSignIn() {
  const m = location.hash.match(/^#signin=([\w.-]+)&nonce=([\w-]+)$/)
  if (!m) return
  history.replaceState(null, '', location.pathname + location.search)
  if (m[2] === store.get(NONCE_KEY)) store.set(TOKEN_KEY, m[1])
  store.set(NONCE_KEY, null)
}

function headers(): Record<string, string> {
  const token = store.get(TOKEN_KEY)
  if (token && nameIn(token)) return { Authorization: 'Bearer ' + token }
  // A development build with no sign-in can name a player to the local server
  return import.meta.env.DEV ? { 'X-Dev-Player': store.get(NAME_KEY) || 'player' } : {}
}

export function createLeaderboard(getCar: () => CarFile | null) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const panel = $('boardOnline')
  if (!API) return { render() {} }
  panel.hidden = false
  takeSignIn()
  let gpIndex = 0

  const renderWho = () => {
    const name = nameIn(store.get(TOKEN_KEY))
    $('onlineWho').textContent = name ? 'Signed in as ' + name + '.' : 'Sign in to enter the board.'
    $('onlineSignIn').hidden = !!name
    $('onlineSignOut').hidden = !name
  }
  $('onlineSignIn').addEventListener('click', () => {
    const nonce = crypto.randomUUID().replace(/-/g, '')
    store.set(NONCE_KEY, nonce)
    location.href = API + '/auth/github?ret=' + encodeURIComponent(location.origin + location.pathname + location.search) + '&nonce=' + nonce
  })
  $('onlineSignOut').addEventListener('click', () => {
    store.set(TOKEN_KEY, null)
    renderWho()
    say('Signed out.')
  })
  renderWho()

  const say = (text: string, bad = false) => {
    $('onlineMsg').textContent = text
    $('onlineMsg').classList.toggle('bad', bad)
  }

  async function refresh() {
    const gp = GRAND_PRIXES[gpIndex]
    $('onlineDry').className = gpIndex === 0 ? 'btn small primary' : 'btn small'
    $('onlineWet').className = gpIndex === 1 ? 'btn small primary' : 'btn small'
    try {
      const res = await fetch(API + '/board?gp=' + gp.id)
      const data = (await res.json()) as { entries?: Row[]; error?: string }
      if (!res.ok || !data.entries) throw new Error(data.error ?? 'bad reply')
      $('onlineRows').replaceChildren(
        ...data.entries.map((e) => {
          const li = document.createElement('li')
          const medal = e.medal ? ' · ' + e.medal : ''
          li.textContent = e.rank + '. ' + e.display + ' — ' + e.finished + ' of 8, ' + e.totalTime.toFixed(1) + ' s' + medal
          return li
        }),
      )
      $('onlineEmpty').hidden = data.entries.length > 0
    } catch {
      $('onlineRows').replaceChildren()
      $('onlineEmpty').hidden = true
      say('The board is not reachable right now.', true)
    }
  }

  $('onlineDry').addEventListener('click', () => ((gpIndex = 0), refresh()))
  $('onlineWet').addEventListener('click', () => ((gpIndex = 1), refresh()))
  $('onlineEnter').addEventListener('click', async () => {
    const car = getCar()
    if (!car) return say('Train a car first.', true)
    say('Racing your car on the server…')
    try {
      const res = await fetch(API + '/entries', { method: 'POST', headers: headers(), body: JSON.stringify({ gp: GRAND_PRIXES[gpIndex].id, car: carToJson(car) }) })
      const data = (await res.json()) as { error?: string; finished?: number; totalTime?: number; medal?: string | null; rank?: number; left?: number }
      if (res.status === 401) renderWho()
      if (!res.ok) return say(data.error ?? 'The board could not take that car.', true)
      say('The server scored ' + car.name + ': ' + data.finished + ' of 8 in ' + data.totalTime!.toFixed(1) + ' s' + (data.medal ? ' (' + data.medal + ')' : '') + '. You are number ' + data.rank + ' on the board. ' + data.left + ' entries left today.')
      refresh()
    } catch {
      say('The board is not reachable right now.', true)
    }
  })
  refresh()
  return { render() {} }
}
