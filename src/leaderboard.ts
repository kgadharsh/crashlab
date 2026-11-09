// The online board on the Race tab: shows the top cars for a Grand Prix and lets a player enter
// their car. The server re-runs the car itself, so the result shown here is the server's, not ours.
// With no server address (the live site until the server is deployed) the whole panel stays hidden.
import { carFromJson, carToJson, type CarFile } from './carFile'
import { fetchBoardEntries } from './boardData'
import { reveal } from './fold'
import { CAUSE_LABEL, GRAND_PRIXES, adviceFor, dailyGp, dayLabel, summarise, weekName, weeklyGp, type Cause, type GrandPrix, type TrackResult } from './race'

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

type Row = { rank: number; id: number; display: string; finished: number; totalTime: number; medal: string | null; trophies?: number[]; runs?: number | null }
// how many training runs went into a board car, so grinding Keep training shows (blank for cars from before it was counted)
const runsOf = (e: Row) => (e.runs ? ' · ' + e.runs + (e.runs === 1 ? ' run' : ' runs') : '')
// This week's Grand Prix as the server describes it (never its seed), and finished weeks with their seeds and top 3
type Podium = { place: number; id: number; display: string; finished: number; totalTime: number }
type Daily = { day: number; seed: number; name: string; wet: boolean; night?: boolean; ice?: boolean; endsAt: number; limit: number; past: { day: number; seed: number; podium: Podium[] }[] }
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
// Your standing on each board, for the profile
export type BoardStat = { name: string; place: number | null; of: number; mine: string | null; leader: { name: string; score: string } | null }
export type BoardStats = { boards: BoardStat[]; trophies: number[] | null }

type Deps = {
  getCar: () => CarFile | null
  getGpId: () => string // the Grand Prix the Race tab is on, so a result goes on the matching board
  goRace: (section?: 'gp' | 'daily' | 'weekly') => void
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
  if (!API) return { showResult() {}, identity: (): Identity => ({ kind: 'offline' }), signIn() {}, openBoard() {}, boardStats: async (): Promise<BoardStats | null> => null, dailyToday: (): GrandPrix | null => null }
  panel.hidden = false
  $('resultBoard').hidden = false
  $('weeklyPanel').hidden = false
  $('dailyPanel').hidden = false
  $('hubDaily').hidden = false
  $('hubWeekly').hidden = false
  takeSignIn()
  let gpIndex = 0
  let weekly: Weekly | null = null
  let weeklyLeft: number | undefined // entries left this week, once the server has said
  let daily: Daily | null = null
  let dailyLeft: number | undefined // entries left today, once the server has said

  // the player's chosen board name: undefined while unknown, null when they have not chosen one yet
  let myName: string | null | undefined
  const renderWho = async () => {
    const signed = !!nameIn(store.get(TOKEN_KEY))
    $('onlineSignIn').hidden = signed
    $('onlineSignOut').hidden = !signed
    if (!signed) {
      myName = undefined
      weeklyLeft = undefined
      dailyLeft = undefined
      renderWeekly()
      renderDaily()
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
        const me = (await res.json()) as { name: string | null; ranks?: Ranks; weekly?: { rank: number | null; left: number }; daily?: { rank: number | null; left: number } }
        myName = me.name
        if (me.weekly) weeklyLeft = me.weekly.left
        if (me.daily) dailyLeft = me.daily.left
        if (me.ranks) sinceLastVisit({ ...me.ranks, ...(weekly && me.weekly ? { ['w:' + weekly.week]: me.weekly.rank } : {}) })
        renderWeekly()
        renderDaily()
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
  // ---------- ENTRIES IN OFFICIAL TRAINING ----------
  // how each track went: only finished or not while the day or week is running, everything once it is over
  type TrackBrief = { ok: boolean } | { time: number | null; progress: number; cause: Cause | null }
  type Job = { id: number; gp: string; name: string; status: string; ahead: number; entry: number | null; over: boolean; tracks: TrackBrief[] | null; finished: number | null; totalTime: number | null; medal: string | null }
  const gpName = (id: string) => (id.startsWith('w:') ? 'the Weekly Challenge (' + weekName(Number(id.slice(2))).toLowerCase() + ')' : id.startsWith('d:') ? 'the Daily Challenge (' + dayLabel(Number(id.slice(2))) + ')' : GRAND_PRIXES.find((g) => g.id === id)?.name ?? id)
  let jobTimer: number | undefined
  let lastJobs: Job[] = []
  // The finished day or week a job was entered in (its tracks are public now), if it is still in the lists the server sends
  const pastGp = (id: string): GrandPrix | null => {
    if (daily && typeof daily.seed === 'number' && id === 'd:' + daily.day) return dailyGp(daily.day, daily.seed) // today's tracks are open too
    if (id.startsWith('d:')) return (daily?.past ?? []).filter((p) => 'd:' + p.day === id).map((p) => dailyGp(p.day, p.seed))[0] ?? null
    if (id.startsWith('w:')) return (weekly?.past ?? []).filter((p) => 'w:' + p.week === id).map((p) => weeklyGp(p.week, p.seed))[0] ?? null
    return GRAND_PRIXES.find((g) => g.id === id) ?? null
  }
  // One entry: where it is in training, or how it did, track by track, with advice and a way to watch it once the tracks are open
  function jobView(j: Job): HTMLElement {
    const box = Object.assign(document.createElement('div'), { className: 'job' })
    const state =
      j.status === 'queued' ? 'waiting' + (j.ahead ? ', ' + j.ahead + ' ahead' : ', next') : j.status === 'training' ? 'being trained now' : j.status === 'failed' ? 'could not be trained' : j.finished + ' of 8' + (j.finished === 8 && j.totalTime !== null ? ' in ' + j.totalTime.toFixed(1) + ' s' : '') + (j.medal ? ' (' + j.medal + ')' : '') + ', on the board'
    box.append(Object.assign(document.createElement('div'), { className: 'jobline', textContent: j.name + ' for ' + gpName(j.gp) + ': ' + state }))
    if (j.status !== 'done' || !j.tracks) return box
    const strip = Object.assign(document.createElement('div'), { className: 'strip8' })
    j.tracks.forEach((t, i) => {
      const ok = 'ok' in t ? t.ok : t.time !== null
      strip.append(Object.assign(document.createElement('span'), { className: ok ? 'ok' : 'bad', textContent: String(i + 1), title: 'Track ' + (i + 1) + (ok ? ' finished' : ' not finished') }))
    })
    box.append(strip)
    const full = j.tracks.every((t) => 'cause' in t)
    if (!full) {
      if (j.tracks.some((t) => 'ok' in t && !t.ok)) box.append(Object.assign(document.createElement('div'), { className: 'jobnote', textContent: "This week's tracks are secret until it ends. Then you can see what went wrong and watch the car race them." }))
      return box
    }
    const tracks = j.tracks as { time: number | null; progress: number; cause: Cause | null }[]
    const gp = pastGp(j.gp)
    const why = tracks.flatMap((t, i) => (t.cause ? ['track ' + (i + 1) + ' ' + CAUSE_LABEL[t.cause]] : []))
    if (why.length) {
      const result = summarise(tracks.map((t): TrackResult => ({ ...t, at: null })))
      box.append(Object.assign(document.createElement('div'), { className: 'jobnote', textContent: why.join(' · ') + '. ' + adviceFor(result, gp ?? GRAND_PRIXES[0]) }))
    }
    if (j.over && j.entry && gp) {
      const watch = Object.assign(document.createElement('button'), { className: 'btn small', textContent: 'Watch it race' })
      watch.addEventListener('click', () => loadRival({ rank: 0, id: j.entry!, display: myName ?? 'You', finished: j.finished ?? 0, totalTime: j.totalTime ?? 0, medal: null }, gp.day !== undefined || gp.week !== undefined ? gp : gp.id))
      box.append(watch)
    }
    return box
  }
  // Each section lists its own entries: the Daily and Weekly sections as well as the Leaderboard
  function renderJobs() {
    const kinds: [string, (j: Job) => boolean][] = [
      ['onlineJobs', (j) => !j.gp.startsWith('d:') && !j.gp.startsWith('w:')],
      ['dailyJobs', (j) => j.gp.startsWith('d:')],
      ['weeklyJobs', (j) => j.gp.startsWith('w:')],
    ]
    for (const [id, keep] of kinds) {
      const mine = lastJobs.filter(keep).slice(0, 3)
      $(id).replaceChildren(...(mine.length ? [Object.assign(document.createElement('div'), { className: 'jobhead', textContent: 'Your entries' }), ...mine.map(jobView)] : []))
    }
  }
  let wasPending = false
  async function refreshJobs() {
    window.clearTimeout(jobTimer)
    if (!nameIn(store.get(TOKEN_KEY))) {
      lastJobs = []
      return renderJobs()
    }
    let jobs: Job[] = []
    try {
      const res = await fetch(API + '/me', { headers: headers() })
      if (!res.ok) return
      jobs = ((await res.json()) as { jobs?: Job[] }).jobs ?? []
    } catch {
      return
    }
    lastJobs = jobs
    renderJobs()
    const pending = jobs.some((j) => j.status === 'queued' || j.status === 'training')
    if (wasPending && !pending) {
      refresh() // something just came off the trainer: show the board with it
      refreshWeekly()
      refreshDaily()
    }
    wasPending = pending
    if (pending) jobTimer = window.setTimeout(refreshJobs, 60000)
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
  function showNameForm(panelId: 'dailyPanel' | 'weeklyPanel' | 'boardOnline') {
    const row = $('onlineNameRow')
    const panel = $(panelId)
    const anchor = panelId === 'dailyPanel' ? $('dailyGo') : panelId === 'weeklyPanel' ? $('weeklyGo') : $('onlineWho')
    row.hidden = false
    if (row.parentElement !== panel) panel.insertBefore(row, anchor.nextSibling)
    show('onlineNameRow').scrollIntoView({ behavior: 'smooth', block: 'center' })
    $('onlineName').focus()
  }

  const rowsFor: Record<string, Row[]> = {} // the last board fetched for each Grand Prix

  async function refresh() {
    const gp = GRAND_PRIXES[gpIndex]
    for (const [id, i] of [['onlineDry', 0], ['onlineWet', 1]] as const) {
      $(id).classList.toggle('on', gpIndex === i)
      $(id).setAttribute('aria-pressed', String(gpIndex === i))
    }
    try {
      const entries = await fetchBoardEntries<Row>(API + '/board?gp=' + gp.id)
      rowsFor[gp.id] = entries
      if (lastShown?.gpId === gp.id) reshow()
      $('onlineRows').replaceChildren(
        ...entries.map((e) => {
          const li = document.createElement('li')
          const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
          li.append(cell('n', String(e.rank)), whoCell(e), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s' + (e.medal ? ' · ' + e.medal : '') + runsOf(e)))
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
      $('onlineEmpty').hidden = entries.length > 0
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
    const isDaily = gpId === 'daily'
    const i = GRAND_PRIXES.findIndex((g) => g.id === gpId)
    if (i < 0 && !isWeekly && !isDaily) return
    if (!isWeekly && !isDaily) gpIndex = i
    const tell = isWeekly
      ? (text: string, bad = false) => sayWeekly(text, bad)
      : isDaily
      ? (text: string, bad = false) => sayDaily(text, bad)
      : (text: string, bad = false) => {
          say(text, bad)
          $('resultBoardMsg').textContent = text
          $('resultBoardMsg').classList.toggle('bad', bad)
        }
    if (!car) return tell('Train a car first.', true)
    tell('Entering your setup…')
    try {
      // the setup goes in, not the trained car: the game trains every setup itself, the same way for everyone
      const res = await fetch(API + '/entries', { method: 'POST', headers: headers(), body: JSON.stringify({ gp: gpId, build: car.build, name: car.name }) })
      const data = (await res.json()) as { error?: string; needName?: boolean; queued?: boolean; ahead?: number; left?: number }
      if (res.status === 401) renderWho()
      if (res.status === 409 && data.needName) {
        myName = null
        store.set(PENDING_KEY, gpId)
        await renderWho()
        showNameForm(isWeekly ? 'weeklyPanel' : isDaily ? 'dailyPanel' : 'boardOnline')
        tell('Choose the name the board will show, and your car goes on the board.')
      }
      if (!res.ok) return tell(data.error ?? 'The board could not take that car.', true)
      const queue = data.ahead ? ' ' + data.ahead + (data.ahead === 1 ? ' setup is' : ' setups are') + ' ahead of it.' : ''
      if (isWeekly) {
        weeklyLeft = data.left
        store.set('crashlab.enteredWeekly', '1') // it unlocks headlights in the skill tree
        tell('Entered: ' + car.name + "'s setup is queued for official training." + queue + " Its result shows on this week's board within about 30 minutes.")
        onEntered?.()
        refreshJobs()
        return refreshWeekly()
      }
      if (isDaily) {
        dailyLeft = data.left
        tell('Entered: ' + car.name + "'s setup is queued for official training." + queue + " Its result shows on today's board within about 30 minutes.")
        onEntered?.()
        refreshJobs()
        return refreshDaily()
      }
      tell('Entered: ' + car.name + "'s setup is queued for official training." + queue + ' Its result shows on the board within about 30 minutes. ' + data.left + (data.left === 1 ? ' entry' : ' entries') + ' left today.')
      onEntered?.()
      refreshJobs()
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
      showNameForm('boardOnline')
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
    goRace(pending === 'weekly' ? 'weekly' : pending === 'daily' ? 'daily' : 'gp')
    show(pending === 'weekly' ? 'weeklyPanel' : pending === 'daily' ? 'dailyPanel' : 'boardOnline').scrollIntoView({ block: 'center' })
    if (myName) {
      store.set(PENDING_KEY, null)
      return enter(pending)
    }
    if (myName === null) {
      showNameForm(pending === 'weekly' ? 'weeklyPanel' : pending === 'daily' ? 'dailyPanel' : 'boardOnline')
      const message = pending === 'weekly' ? 'Signed in. Choose the name the board will show, and your car goes on the Weekly Challenge.' : pending === 'daily' ? 'Signed in. Choose the name the board will show, and your car goes on the Daily Challenge.' : 'Signed in. Choose the name the board will show, and your car goes on the board.'
      const messageId = pending === 'weekly' ? 'weeklyMsg' : pending === 'daily' ? 'dailyMsg' : 'onlineMsg'
      $(messageId).textContent = message
      $(messageId).classList.remove('bad')
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
    const past = gpId.startsWith('w:') || gpId.startsWith('d:') // a finished week or day: no entering, only how it compares with that board
    $('resultBoardAsk').textContent = past ? 'Against that board' : 'Put this setup on the leaderboard? The game trains it itself, the same way for everyone, so its official result can differ from this race.'
    $('resultBoardGo').hidden = past
    const key = gpId + ':' + r.finished + ':' + r.totalTime
    if (key === shownFor) return // render runs often; work this out once per result
    lastShown = { gpId, r }
    shownFor = key
    void refreshDaily()
    void refreshWeekly()
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
    const where = past ? 'This would have placed #' + (ahead.length + 1) + (gpId.startsWith('d:') ? ' that day.' : ' that week.') : mine && yours === mine ? 'Your board entry is #' + (ahead.length + 1) + ' and stays there.' : 'This race would place #' + (ahead.length + 1) + (ahead.length >= rows.length && rows.length >= 50 ? ' or lower' : '') + '.'
    const above = ahead[ahead.length - 1]
    if (!above) return (place.textContent = where + (rows.length ? ' That is the top of the board.' : ' The board is empty, so you would be first.'))
    const target =
      above.finished > yours.finished
        ? 'Finishing ' + (above.finished - yours.finished) + ' more ' + (above.finished - yours.finished === 1 ? 'track' : 'tracks')
        : (Math.floor((yours.totalTime - above.totalTime) * 10) / 10 + 0.1).toFixed(1) + ' s faster'
    place.textContent = where + ' ' + target + ' puts you above ' + above.display + ' (#' + above.rank + ').'
  }

  // ---------- THE DAILY CHALLENGE ----------
  const sayDaily = (text: string, bad = false) => {
    $('dailyMsg').textContent = text
    $('dailyMsg').classList.toggle('bad', bad)
  }
  const twistOf = (g: { wet: boolean; night?: boolean; ice?: boolean }) => (g.wet ? 'wet road' : g.night ? 'night' : 'icy road')
  function renderDaily() {
    if (!daily) return
    const signed = !!nameIn(store.get(TOKEN_KEY))
    $('dailyEnds').textContent = 'ends in ' + timeLeft(daily.endsAt - Date.now())
    $('dailyLine').textContent =
      daily.name + ': 8 tracks in one style, all ' + (daily.wet ? 'on a wet road' : daily.night ? 'at night' : 'on an icy road') + '. Everyone races the same tracks, and they are open: race them yourself first, then enter your setup. ' +
      (daily.limit === 1 ? 'You get one entry, so make it count. ' : 'Your best of ' + daily.limit + ' entries counts. ') + 'No trophies: you are ranked on today\'s board, and a new challenge starts at midnight UTC.' +
      (signed && dailyLeft !== undefined ? ' You have ' + dailyLeft + (dailyLeft === 1 ? ' entry' : ' entries') + ' left today.' : '')
    $('hubDailyLimit').textContent = daily.limit + ' a day'
    $('hubDailyEnds').textContent = 'ends in ' + timeLeft(daily.endsAt - Date.now())
    $('hubDailyNow').textContent = daily.name + ' · ' + twistOf(daily) + (signed && dailyLeft !== undefined ? ' · ' + dailyLeft + (dailyLeft === 1 ? ' entry' : ' entries') + ' left' : '')
    const go = $<HTMLButtonElement>('dailyGo')
    go.textContent = !signed ? 'Sign in with Google to enter' : myName === null ? 'Choose a board name to enter' : 'Enter your car'
    go.disabled = signed && dailyLeft === 0
  }
  async function refreshDaily() {
    try {
      const res = await fetch(API + '/daily')
      if (!res.ok) throw new Error('bad reply')
      daily = (await res.json()) as Daily
      const rows = await fetchBoardEntries<Row>(API + '/board?gp=d:' + daily.day)
      $('dailyRows').replaceChildren(
        ...rows.map((e) => {
          const li = document.createElement('li')
          const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
          li.append(cell('n', String(e.rank)), cell('who', e.display), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s' + runsOf(e)), document.createElement('span'))
          return li
        }),
      )
      $('dailyEmpty').hidden = rows.length > 0
      $('dailyPast').replaceChildren(
        ...daily.past.map((p) => {
          const gp = dailyGp(p.day, p.seed)
          const box = document.createElement('div')
          const head = Object.assign(document.createElement('p'), { className: 'tip', textContent: gp.name + ' · ' + twistOf(gp) + (p.podium.length ? '' : ' · nobody entered') })
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
      renderDaily()
      renderJobs()
    } catch {
      sayDaily('The Daily Challenge is not reachable right now.', true)
    }
  }
  // today's tracks as a Grand Prix, once the server has sent them (they are open to everyone)
  const dailyToday = (): GrandPrix | null => (daily && typeof daily.seed === 'number' ? dailyGp(daily.day, daily.seed) : null) // an older server sends no seed
  $('dailyGo').addEventListener('click', () => {
    if (!nameIn(store.get(TOKEN_KEY))) {
      store.set(PENDING_KEY, 'daily')
      return signIn()
    }
    if (myName === null) {
      store.set(PENDING_KEY, 'daily')
      showNameForm('dailyPanel')
      return sayDaily('Choose the name the board will show, and your car goes into the Daily Challenge.')
    }
    enter('daily')
  })

  // ---------- THE WEEKLY GRAND PRIX ----------
  const sayWeekly = (text: string, bad = false) => {
    $('weeklyMsg').textContent = text
    $('weeklyMsg').classList.toggle('bad', bad)
  }
  function whoCell(e: { display: string; trophies?: number[] }) {
    const who = Object.assign(document.createElement('span'), { className: 'who', textContent: e.display })
    const t = trophyText(e.trophies)
    if (t) who.append(Object.assign(document.createElement('span'), { className: 'troph', textContent: ' ' + t, title: 'Weekly Challenge trophies' }))
    return who
  }
  function renderWeekly() {
    if (!weekly) return
    const signed = !!nameIn(store.get(TOKEN_KEY))
    $('weeklyEnds').textContent = 'ends in ' + timeLeft(weekly.endsAt - Date.now())
    $('weeklyLine').textContent =
      weekly.name + ': 8 new tracks on a ' + (weekly.wet ? 'wet' : 'dry') + ' road' + (weekly.night ? ', at night' : '') + (weekly.ice ? ', with ice patches' : '') + ', that nobody sees until the week is over, so no car has practised on them. ' +
      'Your best of ' + weekly.limit + ' entries counts, and the top 3 win a trophy that stays next to their name.' +
      (signed && weeklyLeft !== undefined ? ' You have ' + weeklyLeft + (weeklyLeft === 1 ? ' entry' : ' entries') + ' left this week.' : '')
    $('hubWeeklyLimit').textContent = weekly.limit + ' a week'
    $('hubWeeklyEnds').textContent = 'ends in ' + timeLeft(weekly.endsAt - Date.now())
    $('hubWeeklyNow').textContent = weekly.name + ' · ' + (weekly.wet ? 'wet' : 'dry') + (weekly.night && weekly.ice ? ', night + ice' : weekly.night ? ', night' : weekly.ice ? ', ice' : '') + (signed && weeklyLeft !== undefined ? ' · ' + weeklyLeft + (weeklyLeft === 1 ? ' entry' : ' entries') + ' left' : '')
    const go = $<HTMLButtonElement>('weeklyGo')
    go.textContent = !signed ? 'Sign in with Google to enter' : myName === null ? 'Choose a board name to enter' : 'Enter your car'
    go.disabled = signed && weeklyLeft === 0
  }
  async function refreshWeekly() {
    try {
      const res = await fetch(API + '/weekly')
      if (!res.ok) throw new Error('bad reply')
      weekly = (await res.json()) as Weekly
      const rows = await fetchBoardEntries<Row>(API + '/board?gp=w:' + weekly.week)
      $('weeklyRows').replaceChildren(
        ...rows.map((e) => {
          const li = document.createElement('li')
          const cell = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text })
          li.append(cell('n', String(e.rank)), whoCell(e), cell('res', e.finished + ' of 8 · ' + e.totalTime.toFixed(1) + ' s' + runsOf(e)), document.createElement('span'))
          return li
        }),
      )
      $('weeklyEmpty').hidden = rows.length > 0
      renderPast(weekly)
      renderWeekly()
      renderJobs()
    } catch {
      sayWeekly('The Weekly Challenge is not reachable right now.', true)
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
        const open = Object.assign(document.createElement('button'), { className: 'btn small', textContent: 'Open past week' })
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
      showNameForm('weeklyPanel')
      return sayWeekly('Choose the name the board will show, and your car goes into the Weekly Challenge.')
    }
    enter('weekly')
  })

  refresh()
  refreshWeekly()
  refreshDaily()
  refreshJobs()
  const identity = (): Identity => (!nameIn(store.get(TOKEN_KEY)) ? { kind: 'out' } : myName === undefined ? { kind: 'checking' } : myName === null ? { kind: 'noname' } : { kind: 'in', name: myName })
  const openBoard = () => {
    goRace('gp')
    show('boardOnline').scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  // Your place on each board (the fixed Grand Prix and this week's), how you did there, and who leads it
  async function boardStats(): Promise<BoardStats | null> {
    const score = (e: Row) => e.finished + ' of 8' + (e.finished === 8 ? ' · ' + e.totalTime.toFixed(1) + ' s' : '')
    const boards = [...GRAND_PRIXES.map((g) => ({ id: g.id, name: g.name })), ...(weekly ? [{ id: 'w:' + weekly.week, name: 'This week' }] : [])]
    let trophies: number[] | null = null
    const out: BoardStat[] = []
    for (const b of boards) {
      let rows: Row[] = rowsFor[b.id] ?? []
      try {
        const res = await fetch(API + '/board?gp=' + b.id)
        rows = rowsFor[b.id] = ((await res.json()) as { entries?: Row[] }).entries ?? []
      } catch {
        if (!rowsFor[b.id]) return null
      }
      const mine = myName ? rows.find((e) => e.display === myName) : undefined
      if (mine?.trophies) trophies = mine.trophies
      out.push({ name: b.name, place: mine?.rank ?? null, of: rows.length, mine: mine ? score(mine) : null, leader: rows[0] ? { name: rows[0].display, score: score(rows[0]) } : null })
    }
    return { boards: out, trophies }
  }
  return { showResult, identity, signIn, openBoard, boardStats, dailyToday }
}
