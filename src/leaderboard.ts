// The online board on the Race tab: shows the top cars for a Grand Prix and lets a player enter
// their car. The server re-runs the car itself, so the result shown here is the server's, not ours.
// With no server address (the live site until the server is deployed) the whole panel stays hidden.
import { carToJson, type CarFile } from './carFile'
import { GRAND_PRIXES } from './race'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
const NAME_KEY = 'crashlab.devname'
const TOKEN_KEY = 'crashlab.token'
const NONCE_KEY = 'crashlab.nonce'
// The Grand Prix a player asked to enter from a race result before going off to sign in, so the entry can finish when they come back
const PENDING_KEY = 'crashlab.pendingEntry'

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

// Coming back from Google, the address ends #signin=TOKEN&nonce=N. Keep the token only if the nonce is the one we sent.
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

type Deps = {
  getCar: () => CarFile | null
  getGpId: () => string // the Grand Prix the Race tab is on, so a result goes on the matching board
  goRace: () => void
}

export function createLeaderboard({ getCar, getGpId, goRace }: Deps) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const panel = $('boardOnline')
  if (!API) return { render() {} }
  panel.hidden = false
  $('resultBoard').hidden = false
  takeSignIn()
  let gpIndex = 0

  // the player's chosen board name: undefined while unknown, null when they have not chosen one yet
  let myName: string | null | undefined
  const renderWho = async () => {
    const signed = !!nameIn(store.get(TOKEN_KEY))
    $('onlineSignIn').hidden = signed
    $('onlineSignOut').hidden = !signed
    if (!signed) {
      myName = undefined
      $('onlineNameRow').hidden = true
      $('onlineWho').textContent = 'Sign in to enter the board.'
      $('resultBoardGo').textContent = 'Sign in with Google to enter'
      return
    }
    if (myName === undefined) {
      try {
        const res = await fetch(API + '/me', { headers: headers() })
        if (res.status === 401) {
          store.set(TOKEN_KEY, null) // the server no longer accepts this sign-in
          return renderWho()
        }
        myName = ((await res.json()) as { name: string | null }).name
      } catch {
        $('onlineWho').textContent = 'Signed in. The board is not reachable right now.'
        return
      }
    }
    $('onlineNameRow').hidden = myName !== null
    $('resultBoardGo').textContent = myName ? 'Enter it on the leaderboard' : 'Choose a board name to enter'
    $('onlineWho').textContent = myName ? 'Playing as ' + myName + '. ' : 'Signed in. Choose the name the board will show.'
    if (myName) {
      const change = document.createElement('button')
      change.className = 'btn small'
      change.textContent = 'Change name'
      change.addEventListener('click', () => {
        $('onlineNameRow').hidden = false
        ;($('onlineName') as HTMLInputElement).value = myName ?? ''
        $('onlineName').focus()
      })
      $('onlineWho').append(change)
    }
  }
  $('onlineNameSave').addEventListener('click', async () => {
    const name = ($('onlineName') as HTMLInputElement).value
    try {
      const res = await fetch(API + '/me', { method: 'PUT', headers: headers(), body: JSON.stringify({ name }) })
      const data = (await res.json()) as { name?: string; error?: string }
      if (!res.ok) return say(data.error ?? 'That name could not be saved.', true)
      myName = data.name
      say('Your board name is ' + data.name + '.')
      await renderWho()
      const pending = store.get(PENDING_KEY)
      if (pending) {
        store.set(PENDING_KEY, null)
        return enter(pending)
      }
      refresh()
    } catch {
      say('The board is not reachable right now.', true)
    }
  })
  const signIn = () => {
    const nonce = crypto.randomUUID().replace(/-/g, '')
    store.set(NONCE_KEY, nonce)
    location.href = API + '/auth/google?ret=' + encodeURIComponent(location.origin + location.pathname + location.search) + '&nonce=' + nonce
  }
  $('onlineSignIn').addEventListener('click', signIn)
  $('onlineSignOut').addEventListener('click', () => {
    store.set(TOKEN_KEY, null)
    myName = undefined
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
          const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
          li.append(cell('n', String(e.rank)), cell('who', e.display), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s' + (e.medal ? ' · ' + e.medal : '')))
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
  // Enter the current car on a Grand Prix's board. The server races it and says where it placed.
  async function enter(gpId: string) {
    const car = getCar()
    const i = GRAND_PRIXES.findIndex((g) => g.id === gpId)
    if (i < 0) return
    gpIndex = i
    const tell = (text: string, bad = false) => {
      say(text, bad)
      $('resultBoardMsg').textContent = text
      $('resultBoardMsg').classList.toggle('bad', bad)
    }
    if (!car) return tell('Train a car first.', true)
    tell('Racing your car on the server…')
    try {
      const res = await fetch(API + '/entries', { method: 'POST', headers: headers(), body: JSON.stringify({ gp: gpId, car: carToJson(car) }) })
      const data = (await res.json()) as { error?: string; needName?: boolean; finished?: number; totalTime?: number; medal?: string | null; rank?: number; left?: number }
      if (res.status === 401) renderWho()
      if (res.status === 409 && data.needName) {
        myName = null
        store.set(PENDING_KEY, gpId)
        await renderWho()
        $('onlineName').focus()
      }
      if (!res.ok) return tell(data.error ?? 'The board could not take that car.', true)
      tell('On the board: ' + car.name + ' finished ' + data.finished + ' of 8 in ' + data.totalTime!.toFixed(1) + ' s' + (data.medal ? ' (' + data.medal + ')' : '') + '. You are number ' + data.rank + '. ' + data.left + ' entries left today.')
      refresh()
    } catch {
      tell('The board is not reachable right now.', true)
    }
  }
  $('onlineEnter').addEventListener('click', () => enter(GRAND_PRIXES[gpIndex].id))
  // Under a race result: sign in if needed (the entry finishes when the player comes back), then enter
  $('resultBoardGo').addEventListener('click', async () => {
    const gpId = getGpId()
    if (!nameIn(store.get(TOKEN_KEY))) {
      store.set(PENDING_KEY, gpId)
      return signIn()
    }
    if (myName === null) {
      store.set(PENDING_KEY, gpId)
      $('onlineNameRow').hidden = false
      $('boardOnline').scrollIntoView({ behavior: 'smooth', block: 'center' })
      $('onlineName').focus()
      return say('Choose the name the board will show, and your car goes on the board.')
    }
    enter(gpId)
  })
  // Back from signing in with an entry waiting: finish it, or ask for a board name first
  void (async () => {
    const pending = store.get(PENDING_KEY)
    if (!pending) return
    if (!nameIn(store.get(TOKEN_KEY))) return store.set(PENDING_KEY, null) // sign-in was abandoned
    await renderWho()
    goRace()
    $('boardOnline').scrollIntoView({ block: 'center' })
    if (myName) {
      store.set(PENDING_KEY, null)
      return enter(pending)
    }
    if (myName === null) {
      $('onlineName').focus()
      say('Signed in. Choose the name the board will show, and your car goes on the board.')
    }
  })()
  refresh()
  return { render() {} }
}
