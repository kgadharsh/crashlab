// The online board on the Race tab: shows the top cars for a Grand Prix and lets a player enter
// their car. The server re-runs the car itself, so the result shown here is the server's, not ours.
// With no server address (the live site until the server is deployed) the whole panel stays hidden.
import { carFromJson, carToJson, type CarFile } from './carFile'
import { reveal } from './fold'
import { CAUSE_LABEL, GRAND_PRIXES, weeklyGp, type Cause, type GrandPrix } from './race'

export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
const NAME_KEY = 'crashlab.devname'
const TOKEN_KEY = 'crashlab.token'
const NONCE_KEY = 'crashlab.nonce'
// The Grand Prix a player asked to enter from a race result before going off to sign in, so the entry can finish when they come back
const PENDING_KEY = 'crashlab.pendingEntry'
// The player's place on each board when they last looked, so a return visit can say who passed them
const RANKS_KEY = 'crashlab.ranks'
type Ranks = Record<string, number | null>
type Score = { finished: number; totalTime: number }
const beats = (a: Score, b: Score) => a.finished !== b.finished ? a.finished > b.finished : a.totalTime < b.totalTime

type Row = { rank: number; id: number; display: string; finished: number; totalTime: number; medal: string | null; trophies?: number[] }
// This week's Grand Prix as the server describes it (never its seed), and finished weeks with their seeds and top 3
type Podium = { place: number; id: number; display: string; finished: number; totalTime: number }
type Weekly = { week: number; name: string; wet: boolean; night?: boolean; ice?: boolean; endsAt: number; limit: number; past: { week: number; seed: number; podium: Podium[] }[] }
const TROPHY = ['🥇', '🥈', '🥉']
// Weekly trophies after a name, e.g. 🥇2 🥉1
const trophyText = (t?: number[]) => (t ?? []).flatMap((n, i) => (n ? [TROPHY[i] + (n > 1 ? n : '')] : [])).join(' ')
function timeLeft(ms: number): string {
  const h = Math.max(0, Math.floor(ms / 3600000))
  return h >= 24 ? Math.floor(h / 24) + ' d ' + (h % 24) + ' h' : h >= 1 ? h + ' h' : 'under an hour'
}

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

// Who the player is on the board, for the profile
export type Identity = { kind: 'offline' | 'out' | 'checking' | 'noname' } | { kind: 'in'; name: string }

type Deps = {
  getCar: () => CarFile | null
  getGpId: () => string // the Grand Prix the Race tab is on, so a result goes on the matching board
  goRace: () => void
  notify: (text: string) => void // a message in the bar at the bottom of the screen
  raceAgainst: (rival: CarFile, gp: string | GrandPrix) => void // make a board car the one to beat (a past week comes as its Grand Prix)
  openWeek: (gp: GrandPrix) => void // race a finished week's tracks
  onEntered?: () => void // a car has just been taken onto a board
}

export function createLeaderboard({ getCar, getGpId, goRace, notify, raceAgainst, openWeek, onEntered }: Deps) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  // an element the player must see now: its panel opens if it is folded
  const show = (id: string) => {
    const el = $(id)
    reveal(el.closest('.panel') ?? el)
    return el
  }
  const panel = $('boardOnline')
  if (!API) return { showResult() {}, identity: (): Identity => ({ kind: 'offline' }), signIn() {}, openBoard() {} }
  panel.hidden = false
  $('resultBoard').hidden = false
  $('weeklyPanel').hidden = false
  takeSignIn()
  let gpIndex = 0
  let weekly: Weekly | null = null
  let weeklyLeft: number | undefined // entries left this week, once the server has said

  // the player's chosen board name: undefined while unknown, null when they have not chosen one yet
  let myName: string | null | undefined
  const renderWho = async () => {
    const signed = !!nameIn(store.get(TOKEN_KEY))
    $('onlineSignIn').hidden = signed
    $('onlineSignOut').hidden = !signed
    if (!signed) {
      myName = undefined
      weeklyLeft = undefined
      renderWeekly()
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
        const me = (await res.json()) as { name: string | null; ranks?: Ranks; weekly?: { rank: number | null; left: number } }
        myName = me.name
        if (me.weekly) weeklyLeft = me.weekly.left
        if (me.ranks) sinceLastVisit({ ...me.ranks, ...(weekly && me.weekly ? { ['w:' + weekly.week]: me.weekly.rank } : {}) })
        renderWeekly()
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
      reshow()
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
  // Players who passed you while you were away: compare each board place with the one remembered from last time
  function sinceLastVisit(now: Ranks) {
    let before: Ranks = {}
    try {
      before = JSON.parse(store.get(RANKS_KEY) ?? '{}') as Ranks
    } catch {
      /* nothing remembered */
    }
    const boards = [...GRAND_PRIXES, ...(weekly ? [{ id: 'w:' + weekly.week, name: "this week's Grand Prix" }] : [])]
    const news = boards.flatMap((gp) => {
      const was = before[gp.id]
      const is = now[gp.id]
      if (typeof was !== 'number' || typeof is !== 'number' || is <= was) return []
      const n = is - was
      return [n + (n === 1 ? ' player' : ' players') + ' passed you on ' + gp.name + ': you are now #' + is + '.']
    })
    if (news.length) notify('Since your last visit, ' + news.join(' And ') + ' Race again to win your place back.')
    store.set(RANKS_KEY, JSON.stringify(now))
  }
  function rememberRank(gpId: string, rank: number) {
    let ranks: Ranks = {}
    try {
      ranks = JSON.parse(store.get(RANKS_KEY) ?? '{}') as Ranks
    } catch {
      /* start afresh */
    }
    ranks[gpId] = rank
    store.set(RANKS_KEY, JSON.stringify(ranks))
  }

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
    reshow()
    say('Signed out.')
  })
  renderWho()

  const say = (text: string, bad = false) => {
    $('onlineMsg').textContent = text
    $('onlineMsg').classList.toggle('bad', bad)
  }

  const rowsFor: Record<string, Row[]> = {} // the last board fetched for each Grand Prix

  async function refresh() {
    const gp = GRAND_PRIXES[gpIndex]
    for (const [id, i] of [['onlineDry', 0], ['onlineWet', 1]] as const) {
      $(id).classList.toggle('on', gpIndex === i)
      $(id).setAttribute('aria-pressed', String(gpIndex === i))
    }
    try {
      const res = await fetch(API + '/board?gp=' + gp.id)
      const data = (await res.json()) as { entries?: Row[]; error?: string }
      if (!res.ok || !data.entries) throw new Error(data.error ?? 'bad reply')
      rowsFor[gp.id] = data.entries
      if (lastShown?.gpId === gp.id) reshow()
      $('onlineRows').replaceChildren(
        ...data.entries.map((e) => {
          const li = document.createElement('li')
          const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
          li.append(cell('n', String(e.rank)), whoCell(e), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s' + (e.medal ? ' · ' + e.medal : '')))
          if (e.display !== myName) {
            const race = document.createElement('button')
            race.className = 'btn small'
            race.textContent = 'Race'
            race.setAttribute('aria-label', 'Race against ' + e.display)
            race.addEventListener('click', () => loadRival(e, gp.id))
            li.append(race)
          } else li.append(document.createElement('span'))
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

  // Fetch a board car and make it the one to beat. It is checked like any car file before it is used.
  async function loadRival(e: Row, gpId: string | GrandPrix) {
    say('Loading ' + e.display + "'s car…")
    try {
      const res = await fetch(API + '/entries/' + e.id)
      const data = (await res.json()) as { car?: unknown; error?: string }
      if (!res.ok || !data.car) return say(data.error ?? 'That car could not be loaded.', true)
      const rival = carFromJson(carToJson(data.car as CarFile))
      if ('error' in rival) return say('That car could not be used: ' + rival.error, true)
      rival.name = e.display // shown as the player, not their car's own name
      raceAgainst(rival, gpId)
      say(e.display + "'s car is the one to beat. Race your car to see who wins.")
    } catch {
      say('The board is not reachable right now.', true)
    }
  }

  $('onlineDry').addEventListener('click', () => ((gpIndex = 0), refresh()))
  $('onlineWet').addEventListener('click', () => ((gpIndex = 1), refresh()))
  // Enter the current car on a Grand Prix's board. The server races it and says where it placed.
  async function enter(gpId: string) {
    const car = getCar()
    const isWeekly = gpId === 'weekly'
    const i = GRAND_PRIXES.findIndex((g) => g.id === gpId)
    if (i < 0 && !isWeekly) return
    if (!isWeekly) gpIndex = i
    const tell = isWeekly
      ? (text: string, bad = false) => sayWeekly(text, bad)
      : (text: string, bad = false) => {
          say(text, bad)
          $('resultBoardMsg').textContent = text
          $('resultBoardMsg').classList.toggle('bad', bad)
        }
    if (!car) return tell('Train a car first.', true)
    tell('Racing your car on the server…')
    try {
      const res = await fetch(API + '/entries', { method: 'POST', headers: headers(), body: JSON.stringify({ gp: gpId, car: carToJson(car) }) })
      const data = (await res.json()) as { error?: string; needName?: boolean; finished?: number; totalTime?: number; medal?: string | null; rank?: number; left?: number; tracks?: { time: number | null; progress: number; cause: Cause | null }[] }
      if (res.status === 401) renderWho()
      if (res.status === 409 && data.needName) {
        myName = null
        store.set(PENDING_KEY, gpId)
        await renderWho()
        show('onlineNameRow').scrollIntoView({ behavior: 'smooth', block: 'center' })
        $('onlineName').focus()
      }
      if (!res.ok) return tell(data.error ?? 'The board could not take that car.', true)
      if (isWeekly) {
        weeklyLeft = data.left
        store.set('crashlab.enteredWeekly', '1') // it unlocks headlights in the skill tree
        if (weekly && data.rank) rememberRank('w:' + weekly.week, data.rank)
        tell(car.name + ' finished ' + data.finished + ' of 8 in ' + data.totalTime!.toFixed(1) + ' s. You are #' + data.rank + ' this week.')
        onEntered?.()
        showTracks(data.tracks ?? [])
        return refreshWeekly()
      }
      if (data.rank) rememberRank(gpId, data.rank)
      tell('On the board: ' + car.name + ' finished ' + data.finished + ' of 8 in ' + data.totalTime!.toFixed(1) + ' s' + (data.medal ? ' (' + data.medal + ')' : '') + '. You are number ' + data.rank + '. ' + data.left + ' entries left today.')
      onEntered?.()
      await refresh()
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
      show('boardOnline').scrollIntoView({ behavior: 'smooth', block: 'center' })
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
    show(pending === 'weekly' && myName ? 'weeklyPanel' : 'boardOnline').scrollIntoView({ block: 'center' })
    if (myName) {
      store.set(PENDING_KEY, null)
      return enter(pending)
    }
    if (myName === null) {
      $('onlineName').focus()
      say('Signed in. Choose the name the board will show, and your car goes on the board.')
    }
  })()
  // Under a race result: where it would place, and what it takes to pass the car just above
  let shownFor = ''
  let lastShown: { gpId: string; r: Score } | null = null
  // the board or who is signed in changed: work the shown result out again
  const reshow = () => {
    shownFor = ''
    if (lastShown) showResult(lastShown.gpId, lastShown.r)
  }
  async function showResult(gpId: string, r: Score | null) {
    if (!r) {
      shownFor = ''
      lastShown = null
      $('resultBoardPlace').textContent = ''
      return
    }
    const past = gpId.startsWith('w:') // a finished week: no entering, only how it compares with that week's board
    $('resultBoardAsk').textContent = past ? 'Against that week\'s board' : 'Put this on the leaderboard?'
    $('resultBoardGo').hidden = past
    const key = gpId + ':' + r.finished + ':' + r.totalTime
    if (key === shownFor) return // render runs often; work this out once per result
    lastShown = { gpId, r }
    shownFor = key
    const place = $('resultBoardPlace')
    place.textContent = ''
    // compare with the board as it is now, not as it was when the page opened
    try {
      const res = await fetch(API + '/board?gp=' + gpId)
      rowsFor[gpId] = ((await res.json()) as { entries?: Row[] }).entries ?? []
    } catch {
      if (!rowsFor[gpId]) return
    }
    if (key !== shownFor) return
    const rows = rowsFor[gpId]
    const mine = myName ? rows.find((e) => e.display === myName) : undefined
    const others = rows.filter((e) => e !== mine)
    const yours = mine && !beats(r, mine) ? mine : r // your board entry stays if this run is not better
    const ahead = others.filter((e) => beats(e, yours))
    const where = past ? 'This would have placed #' + (ahead.length + 1) + ' that week.' : mine && yours === mine ? 'Your board entry is #' + (ahead.length + 1) + ' and stays there.' : 'This would place #' + (ahead.length + 1) + (ahead.length >= rows.length && rows.length >= 50 ? ' or lower' : '') + '.'
    const above = ahead[ahead.length - 1]
    if (!above) return (place.textContent = where + (rows.length ? ' That is the top of the board.' : ' The board is empty, so you would be first.'))
    const target =
      above.finished > yours.finished
        ? 'Finishing ' + (above.finished - yours.finished) + ' more ' + (above.finished - yours.finished === 1 ? 'track' : 'tracks')
        : (Math.floor((yours.totalTime - above.totalTime) * 10) / 10 + 0.1).toFixed(1) + ' s faster'
    place.textContent = where + ' ' + target + ' puts you above ' + above.display + ' (#' + above.rank + ').'
  }

  // ---------- THE WEEKLY GRAND PRIX ----------
  const sayWeekly = (text: string, bad = false) => {
    $('weeklyMsg').textContent = text
    $('weeklyMsg').classList.toggle('bad', bad)
  }
  function whoCell(e: { display: string; trophies?: number[] }) {
    const who = Object.assign(document.createElement('span'), { className: 'who', textContent: e.display })
    const t = trophyText(e.trophies)
    if (t) who.append(Object.assign(document.createElement('span'), { className: 'troph', textContent: ' ' + t, title: 'Weekly Grand Prix trophies' }))
    return who
  }
  // How each secret track went (the server sends no positions, so the tracks stay secret)
  function showTracks(tracks: { time: number | null; progress: number; cause: Cause | null }[]) {
    $('weeklyTracks').hidden = !tracks.length
    $('weeklyTracks').replaceChildren(
      ...tracks.map((t, i) => {
        const li = document.createElement('li')
        const span = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
        li.append(
          span('n', String(i + 1)),
          span('st ' + (t.time !== null ? 'ok' : 'bad'), t.time !== null ? '✓' : '✕'),
          span('t', t.time !== null ? t.time.toFixed(2) + ' s' : CAUSE_LABEL[t.cause!] + ' · ' + Math.round(t.progress * 100) + '%'),
        )
        return li
      }),
    )
  }
  function renderWeekly() {
    if (!weekly) return
    const signed = !!nameIn(store.get(TOKEN_KEY))
    $('weeklyEnds').textContent = 'ends in ' + timeLeft(weekly.endsAt - Date.now())
    $('weeklyLine').textContent =
      weekly.name + ': 8 new tracks on a ' + (weekly.wet ? 'wet' : 'dry') + ' road' + (weekly.night ? ', at night' : '') + (weekly.ice ? ', with ice patches' : '') + ', that nobody sees until the week is over, so no car has practised on them. ' +
      'Your best of ' + weekly.limit + ' entries counts, and the top 3 win a trophy that stays next to their name.' +
      (signed && weeklyLeft !== undefined ? ' You have ' + weeklyLeft + (weeklyLeft === 1 ? ' entry' : ' entries') + ' left this week.' : '')
    const go = $<HTMLButtonElement>('weeklyGo')
    go.textContent = !signed ? 'Sign in with Google to enter' : myName === null ? 'Choose a board name to enter' : 'Enter your car'
    go.disabled = signed && weeklyLeft === 0
  }
  async function refreshWeekly() {
    try {
      const res = await fetch(API + '/weekly')
      if (!res.ok) throw new Error('bad reply')
      weekly = (await res.json()) as Weekly
      const board = (await (await fetch(API + '/board?gp=w:' + weekly.week)).json()) as { entries?: Row[] }
      const rows = board.entries ?? []
      $('weeklyRows').replaceChildren(
        ...rows.map((e) => {
          const li = document.createElement('li')
          const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
          li.append(cell('n', String(e.rank)), whoCell(e), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s'), document.createElement('span'))
          return li
        }),
      )
      $('weeklyEmpty').hidden = rows.length > 0
      renderPast(weekly)
      renderWeekly()
    } catch {
      sayWeekly('The Weekly Grand Prix is not reachable right now.', true)
    }
  }
  // Finished weeks: their top 3, whose cars anyone can now race on that week's tracks
  function renderPast(w: Weekly) {
    $('weeklyPast').replaceChildren(
      ...w.past.map((p) => {
        const gp = weeklyGp(p.week, p.seed)
        const box = document.createElement('div')
        const head = Object.assign(document.createElement('p'), { className: 'tip', textContent: gp.name + (gp.wet ? ' · wet' : ' · dry') + (gp.night ? ' · night' : '') + (gp.ice ? ' · ice' : '') + (p.podium.length ? '' : ' · nobody entered') })
        head.style.cssText = 'color:var(--text);font-weight:600;margin-top:12px'
        const open = Object.assign(document.createElement('button'), { className: 'btn small', textContent: 'Race these tracks' })
        open.addEventListener('click', () => openWeek(gp))
        head.append(' ', open)
        const list = Object.assign(document.createElement('ol'), { className: 'rank' })
        list.append(
          ...p.podium.map((e) => {
            const li = document.createElement('li')
            const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
            const race = Object.assign(document.createElement('button'), { className: 'btn small', textContent: 'Race' })
            race.setAttribute('aria-label', 'Race against ' + e.display + ' on ' + gp.name)
            race.addEventListener('click', () => loadRival({ ...e, rank: e.place, medal: null }, gp))
            li.append(cell('n', TROPHY[e.place - 1]), cell('who', e.display), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s'), race)
            return li
          }),
        )
        box.append(head, list)
        return box
      }),
    )
  }
  $('weeklyGo').addEventListener('click', () => {
    if (!nameIn(store.get(TOKEN_KEY))) {
      store.set(PENDING_KEY, 'weekly')
      return signIn()
    }
    if (myName === null) {
      store.set(PENDING_KEY, 'weekly')
      $('onlineNameRow').hidden = false
      show('onlineNameRow').scrollIntoView({ behavior: 'smooth', block: 'center' })
      $('onlineName').focus()
      return say('Choose the name the board will show, and your car goes into the Weekly Grand Prix.')
    }
    enter('weekly')
  })

  refresh()
  refreshWeekly()
  const identity = (): Identity => (!nameIn(store.get(TOKEN_KEY)) ? { kind: 'out' } : myName === undefined ? { kind: 'checking' } : myName === null ? { kind: 'noname' } : { kind: 'in', name: myName })
  const openBoard = () => {
    goRace()
    show('boardOnline').scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  return { showResult, identity, signIn, openBoard }
}
