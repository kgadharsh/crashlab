// The Race tab: your car drives the Grand Prix tracks one after another while the timing tower
// fills in, then the result, medal, personal best and one piece of advice.
import type { CarFile } from './carFile'
import { genomeToBrain } from './genome'
import { CHECKPOINTS, createCar, drive, type Brain, type Car } from './sim'
import { brainShape, specOf, type CarSpec } from './setup'
import {
  BRONZE_FINISHES, CAUSE_LABEL, GRAND_PRIXES, RACE_COUNT, dayOf, isSecretGp, adviceFor, better, finishLap, gpTrack, lapIsOver, medalFor, medalRules, raceCar, summarise, versus,
  type GrandPrix, type Medal, type RaceResult, type TrackResult,
} from './race'
import { logEvent, recordChallenge } from './playLog'
import { loadFewest, recordFewest } from './board'
import { drawMine } from './perks'
import { icon } from './icons'
import { COL, H, W, clear, drawCar, drawCrash, drawMinimap, drawRays, drawTrack, follow, withCamera, type Camera } from './draw'

// A friend's car to beat (with its result in each Grand Prix on this device), or why their link could not be used
export type Challenge = { car: CarFile; results: RaceResult[] } | { error: string }

export type RaceDeps = {
  onResult?: (gpId: string, result: { finished: number; totalTime: number } | null) => void // a race finished or its result is shown again (null: a new race started)
  ctx: CanvasRenderingContext2D
  cam: Camera
  getCar: () => CarFile | null
  isStale: () => boolean
  getChallenge: () => Challenge | null
  // the rival ladder (rivals.ts): the next ready-made car to beat in Grand Prix 1, and what to do when it is beaten
  ladder: { next: () => { car: CarFile; index: number } | null; raced: (result: RaceResult) => void; list: () => { name: string; score: string; beaten: boolean }[] }
  // the car lent to a player with none, and the rival it races (rivals.ts)
  starter: { car: CarFile; rival: CarFile; tracks: number }
  onStarterDone?: () => void // the starter car's race is over
  getLook: () => number
  goTo: (tab: 'garage' | 'practice') => void
  hudText: (text: string, x: number, y: number, size: number, colour?: string, align?: CanvasTextAlign) => void
  setStrip: (cells: [string, string][]) => void
}

type Best = { finished: number; totalTime: number; name: string }
type Live = {
  gp: GrandPrix // the Grand Prix this race belongs to
  car: CarFile
  brain: Brain
  spec: CarSpec
  index: number // the track being driven
  lap: Car
  results: TrackResult[]
  hold: number // steps left to linger on a finished lap
  summary: RaceResult | null // set when the whole race is over
  newBest: boolean
  ghost: Ghost | null // a friend's car from a challenge link, driving the same track beside yours
  wait: number // steps spent waiting at the end of a track for the ghost to finish
  lights: number // steps left in the start lights: they come on one at a time, then go out and the race starts
  opp: Opponent | null // the car this race is against, fixed when the race starts: beating a rival moves the ladder on
  watching: boolean // no car of your own: the friend's car is the one racing, and nothing is recorded
  loan: boolean // no car of your own and no friend's: the starter car races a rival, and nothing is recorded either
  count: number // how many tracks this race has: all of them, except the starter car's short race
}
// The car a race is run against: a friend's from a challenge link, or else the next rival on the ladder (rung: which one)
type Opponent = { car: CarFile; results: RaceResult[]; rung?: number }
type Ghost = { car: CarFile; brain: Brain; spec: CarSpec; lap: Car; done: boolean }
const GHOST_WAIT = 240 // at most 4 more seconds at the end of a track for the ghost to finish its lap

const bestKey = (gp: GrandPrix) => 'crashlab.best.' + gp.id // the first Grand Prix keeps the key it always had
const GP_KEY = 'crashlab.gp'
const SPEEDS = [1, 4, 16]
const HOLD = 90 // 1.5 seconds on each finished lap
const MEDAL_COLOUR: Record<Exclude<Medal, null>, string> = { gold: '#ffcc33', silver: '#c7ced8', bronze: '#cd8a4f' }

export function loadBest(gp: GrandPrix): Best | null {
  try {
    const text = localStorage.getItem(bestKey(gp))
    return text ? (JSON.parse(text) as Best) : null
  } catch {
    return null
  }
}
function saveBest(gp: GrandPrix, b: Best) {
  try {
    localStorage.setItem(bestKey(gp), JSON.stringify(b))
  } catch {
    /* storage blocked: the best only lasts this visit */
  }
}
function loadGpIndex(): number {
  try {
    const n = Number(localStorage.getItem(GP_KEY))
    return Number.isInteger(n) && n >= 0 && n < GRAND_PRIXES.length ? n : 0
  } catch {
    return 0
  }
}

// The big word on a result with no medal: weekly races have none (their trophies go by place on the week's board)
const headline = (s: RaceResult, gp: GrandPrix) => (isSecretGp(gp) ? s.finished + ' OF ' + RACE_COUNT : 'NO MEDAL')

const time = (s: number | null) => (s === null ? '--.--' : s.toFixed(2))
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// A race's score in a few characters: the time when all 8 finished, else how many did
const scoreOf = (r: RaceResult, of = RACE_COUNT) => (r.finished === of ? r.totalTime.toFixed(1) + ' s' : r.finished + '/' + of)
// How far the winner was ahead: tracks finished count first, then time
function lead(win: RaceResult, lose: RaceResult): string {
  if (win.finished !== lose.finished) {
    const n = win.finished - lose.finished
    return ': ' + n + (n === 1 ? ' more track' : ' more tracks') + ' finished'
  }
  return ' by ' + (lose.totalTime - win.totalTime).toFixed(1) + ' s'
}
const emojiRow = (r: RaceResult, gp: GrandPrix) => r.tracks.map((t) => (t.time === null ? '⬛' : t.time <= gp.goldTime / RACE_COUNT ? '🟩' : '🟨')).join('')
// The words after a race against a friend's car: who won and by how much, both rows of squares, and the next move
export function duelText(me: string, them: string, gp: GrandPrix, mine: RaceResult, theirs: RaceResult, link: string): string {
  const won = better(mine, theirs)
  const lost = better(theirs, mine)
  const head = won ? '"' + me + '" beat "' + them + '"' + lead(mine, theirs) + ' ⚔️' : lost ? '"' + them + '" beat "' + me + '"' + lead(theirs, mine) + '. Rematch coming 🔧' : 'Dead heat between "' + me + '" and "' + them + '"'
  return ['CRASHLAB · ' + gp.name, head, emojiRow(mine, gp) + '  ' + me + ' · ' + scoreOf(mine), emojiRow(theirs, gp) + '  ' + them + ' · ' + scoreOf(theirs), won ? 'Your move:' : lost ? 'Think you can beat us both?' : 'Settle it:', link].join('\n')
}

// The words that go with a shared car, for a message or a post: no spoilers, only the pattern of the race and a dare
export function cardText(carName: string, gp: GrandPrix, s: RaceResult, link: string): string {
  const quick = gp.goldTime / RACE_COUNT
  const squares = s.tracks.map((t) => (t.time === null ? '⬛' : t.time <= quick ? '🟩' : '🟨')).join('')
  const medal = medalFor(s, gp)
  const badge = medal ? { gold: '🥇', silver: '🥈', bronze: '🥉' }[medal] + ' ' + medal.toUpperCase() : s.finished + '/' + RACE_COUNT
  return ['CRASHLAB · ' + gp.name, '"' + carName + '" · ' + badge + (s.finished === RACE_COUNT ? ' · ' + s.totalTime.toFixed(1) + ' s' : ''), squares, (gp.day !== undefined ? 'Same eight tracks for everyone. Can yours beat it?' : 'My car drives tracks it has never seen. Can yours beat it?'), link].join('\n')
}

export function createRaceView(d: RaceDeps) {
  let live: Live | null = null
  let speed = 4
  let gpIndex = loadGpIndex()
  // a finished week's Grand Prix, opened from the Weekly panel: the third choice, while it is loaded
  let pastWeek: GrandPrix | null = null
  const gp = () => (gpIndex === GRAND_PRIXES.length && pastWeek ? pastWeek : GRAND_PRIXES[gpIndex])
  const choices = () => (pastWeek ? [...GRAND_PRIXES, pastWeek] : GRAND_PRIXES)
  // the challenge car's result in a Grand Prix: worked out on load for the fixed ones, and once on demand for a past week
  const rivalRuns = new WeakMap<CarFile, Map<string, RaceResult>>()
  function rivalResult(ch: { car: CarFile; results: RaceResult[] }, g: GrandPrix): RaceResult {
    const i = GRAND_PRIXES.indexOf(g)
    if (i >= 0 && ch.results[i]) return ch.results[i]
    let runs = rivalRuns.get(ch.car)
    if (!runs) rivalRuns.set(ch.car, (runs = new Map()))
    let r = runs.get(g.id)
    if (!r) runs.set(g.id, (r = raceCar(ch.car, g)))
    return r
  }
  let best = loadBest(gp())

  // Which Grand Prix is chosen: its name, rules and buttons (the race itself is chosen by gp())
  function renderGp() {
    $('gpTitle').textContent = gp().name
    $('gpAside').textContent = isSecretGp(gp()) ? '8 open tracks' : '8 secret tracks' // a finished or daily set is open to everyone
    $('medalRules').textContent = isSecretGp(gp())
      ? gp().day !== undefined
        ? gp().day === dayOf(Date.now())
          ? 'Today\'s Daily Challenge tracks are open to everyone. Race them as often as you like to see how your car copes, then enter your setup in the panel below to get ranked on the board.'
          : 'These were a past day\'s tracks. Race them as often as you like.'
        : 'These were last week\'s secret tracks. They are open now: race them as often as you like. This week\'s are still secret.'
      : medalRules(gp())
    $('gp2').hidden = !pastWeek
    if (pastWeek) $('gp2').innerHTML = pastWeek.day !== undefined ? '<i aria-hidden="true">' + icon('zap') + '</i><b></b><small>' + (pastWeek.day === dayOf(Date.now()) ? 'Today · open to all' : 'Past day · open now') + '</small>' : '<i aria-hidden="true">📅</i><b></b><small>Past week · open now</small>'
    if (pastWeek) $('gp2').querySelector('b')!.textContent = pastWeek.name
    choices().forEach((_, i) => {
      const b = $('gp' + i)
      b.classList.toggle('on', i === gpIndex)
      b.setAttribute('aria-pressed', String(i === gpIndex))
    })
  }
  function selectGp(i: number) {
    if (i === gpIndex || (live && !live.summary)) return // not in the middle of a race
    gpIndex = i
    try {
      if (i < GRAND_PRIXES.length) localStorage.setItem(GP_KEY, String(i))
    } catch {
      /* storage blocked: the choice only lasts this visit */
    }
    live = null
    best = loadBest(gp())
    renderGp()
    render()
  }

  // Who a race in this Grand Prix is against: a friend's car from a challenge link comes first; otherwise, in
  // Grand Prix 1, the next rival on the ladder. A rival's result is worked out the first time it is needed.
  const ladderOpps = new Map<number, Opponent>()
  function opponent(g: GrandPrix = gp()): Opponent | null {
    const ch = d.getChallenge()
    if (ch && !('error' in ch)) return ch
    if (ch || g !== GRAND_PRIXES[0]) return null
    const next = d.ladder.next()
    if (!next) return null
    let o = ladderOpps.get(next.index)
    if (!o) ladderOpps.set(next.index, (o = { car: next.car, results: [], rung: next.index }))
    return o
  }
  const rivalCar = () => opponent()?.car ?? null
  // With no car and no friend's challenge, Grand Prix 1 lends the starter car, so there is a race to run straight away
  const loanNow = () => (!d.getCar() && !d.getChallenge() && gp() === GRAND_PRIXES[0] ? d.starter : null)
  function makeGhost(rival: CarFile, track: ReturnType<typeof gpTrack>): Ghost {
    const spec = specOf(rival.build)
    return { car: rival, brain: genomeToBrain(rival.genome, brainShape(rival.build)), spec, lap: createCar(track, spec), done: false }
  }

  // The start lights over the race screen: off while nothing is racing, one more lit every fifth of a second,
  // all five held for a moment, then out. Once the race is under way they are put away.
  const LIGHTS = 78 // steps of the page clock: five lights at 12 steps each, then a hold
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)')
  function showLights(r: Live | null) {
    const gantry = $('gantry')
    gantry.hidden = !!r && r.lights <= 0
    const lit = r && r.lights > 0 ? Math.min(5, Math.floor((LIGHTS - r.lights) / 12) + 1) : 0
    ;[...gantry.children].forEach((lamp, i) => lamp.classList.toggle('lit', i < lit))
  }

  // the starter car's race is over: the next step is the Garage, so the big button leads there
  const lentOver = () => !!live?.loan && !!live.summary && !d.getCar()
  function start() {
    if (lentOver()) return d.goTo('garage')
    const own = d.getCar()
    const loan = loanNow()
    const opp: Opponent | null = loan ? { car: loan.rival, results: [] } : opponent()
    const rival = opp?.car ?? null
    // with no car of your own, the starter car races, or a challenge link's car can be watched
    const car = own ?? loan?.car ?? rival
    if (!car) return
    const spec = specOf(car.build)
    live = {
      gp: gp(),
      car,
      brain: genomeToBrain(car.genome, brainShape(car.build)),
      spec,
      index: 0,
      lap: createCar(gpTrack(gp(), 0), spec),
      results: [],
      hold: 0,
      summary: null,
      newBest: false,
      ghost: (own || loan) && rival ? makeGhost(rival, gpTrack(gp(), 0)) : null,
      wait: 0,
      opp,
      lights: REDUCED.matches ? 0 : LIGHTS,
      watching: !own,
      loan: !!loan,
      count: loan ? loan.tracks : RACE_COUNT,
    }
    follow(d.cam, live.lap, true)
    render()
  }

  function endLap(r: Live) {
    r.results.push(finishLap(r.lap))
    r.hold = HOLD
    render()
  }

  function nextTrack(r: Live) {
    r.index++
    if (r.index >= r.count) return finish(r)
    r.lap = createCar(gpTrack(r.gp, r.index), r.spec)
    if (r.ghost) r.ghost = makeGhost(r.ghost.car, gpTrack(r.gp, r.index))
    r.wait = 0
    follow(d.cam, r.lap, true)
  }

  function finish(r: Live) {
    r.index = r.count - 1
    r.summary = summarise(r.results)
    // watching a friend's car records nothing: it is not your race
    if (r.watching) {
      render()
      if (r.loan) d.onStarterDone?.()
      return
    }
    // a race against a friend's car from a challenge link counts as won or lost
    // and one against a ladder rival moves the ladder past every rival this result beats
    const won = !!r.opp && better(r.summary, rivalResult(r.opp, r.gp))
    if (r.opp && r.opp.rung === undefined) recordChallenge(won)
    else if (r.opp) d.ladder.raced(r.summary)
    logEvent({ k: 'race', gp: r.gp.name, finished: r.summary.finished, time: r.summary.totalTime, medal: medalFor(r.summary, r.gp), of: RACE_COUNT })
    const medal = medalFor(r.summary, r.gp)
    if (medal && r.car.generations) recordFewest(r.gp.id, medal, r.car.generations)
    if (!best || better(r.summary, best)) {
      best = { finished: r.summary.finished, totalTime: r.summary.totalTime, name: r.car.name }
      saveBest(r.gp, best)
      r.newBest = true
    }
    render()
  }

  // The big word after the starter car's race: whether it beat the rival it was lent to race
  const lentHeadline = (r: Live) => (better(r.summary!, oppResult(r)) ? 'STARTER CAR WON' : 'STARTER CAR LOST')
  // The opponent's result over the tracks this race had: the starter car's short race counts only its own tracks
  const oppResult = (r: Live): RaceResult => {
    const whole = rivalResult(r.opp!, r.gp)
    return r.count === RACE_COUNT ? whole : summarise(whole.tracks.slice(0, r.count))
  }

  // Drive the rest of the race without showing it
  function skip() {
    const r = live
    if (!r || r.summary) return
    r.lights = 0
    if (r.results.length === r.index) {
      while (!lapIsOver(r.lap)) drive(r.lap, r.brain)
      r.results.push(finishLap(r.lap))
    }
    while (r.results.length < r.count) {
      const lap = createCar(gpTrack(r.gp, r.results.length), r.spec)
      while (!lapIsOver(lap)) drive(lap, r.brain)
      r.lap = lap
      r.results.push(finishLap(lap))
    }
    finish(r)
  }

  // One 1/60 s step of the page clock
  function tick() {
    const r = live
    if (!r || r.summary) return
    if (r.lights > 0) {
      r.lights--
      showLights(r)
      return
    }
    const stepGhost = () => {
      const g = r.ghost
      if (!g || g.done) return
      drive(g.lap, g.brain)
      if (lapIsOver(g.lap)) g.done = true
    }
    if (r.hold > 0) {
      for (let k = 0; k < speed; k++) stepGhost()
      if (--r.hold > 0) return
      // the ghost gets a little longer to finish its lap, so you see who was quicker
      if (r.ghost && !r.ghost.done && r.wait < GHOST_WAIT) {
        r.hold = 1
        r.wait += speed
        return
      }
      return nextTrack(r)
    }
    for (let k = 0; k < speed; k++) {
      drive(r.lap, r.brain)
      stepGhost()
      if (lapIsOver(r.lap)) return endLap(r)
    }
  }

  // ---------- THE SIDE PANEL ----------
  function render() {
    const car = d.getCar()
    if (car && live?.loan && live.summary) live = null // a car of your own now: the starter car's result is put away
    showLights(live)
    const racing = !!live && !live.summary
    const loan = loanNow()
    const rival = loan ? null : rivalCar()
    const go = $<HTMLButtonElement>('raceGo')
    go.disabled = (!car && !rival && !loan) || racing
    // with no car of your own, the starter car can be raced, or a friend's challenge car watched, straight away
    go.textContent = loan ? (lentOver() ? 'Build your own car →' : 'Race a starter car') : !car && rival ? 'Watch ' + rival.name + ' race' : live?.summary ? 'Race again' : 'Race your car'
    $<HTMLButtonElement>('raceSkip').disabled = !racing
    choices().forEach((_, i) => ($<HTMLButtonElement>('gp' + i).disabled = racing)) // the Grand Prix cannot change mid-race
    $('raceSpeed').textContent = 'Speed ' + speed + '×'
    $('raceMsg').textContent = loan
      ? lentOver()
        ? 'That was a starter car. Build your own in the Garage and come back to beat ' + loan.rival.name + '.'
        : 'You have no car yet, so here is a starter car. Race it against ' + loan.rival.name + ' over ' + loan.tracks + ' tracks, then build your own.'
      : !car
      ? rival
        ? 'You have no car yet. Watch ' + rival.name + ' drive these tracks, then train a car in Practice to beat it.'
        : 'Train a car in Practice first.'
      : d.isStale()
        ? 'Racing ' + car.name + ', as trained. Your latest garage changes are not in it yet.'
        : 'Racing ' + car.name + '.'
    const results = live?.results ?? []
    $('tower').replaceChildren(
      ...Array.from({ length: live?.count ?? RACE_COUNT }, (_, i) => {
        const li = document.createElement('li')
        const r = results[i]
        const n = document.createElement('span')
        n.className = 'n'
        n.textContent = String(i + 1)
        const mark = document.createElement('span')
        const text = document.createElement('span')
        text.className = 't'
        if (r) {
          mark.className = 'st ' + (r.time !== null ? 'ok' : 'bad')
          mark.innerHTML = icon(r.time !== null ? 'check' : 'x')
          text.textContent = r.time !== null ? time(r.time) + ' s' : CAUSE_LABEL[r.cause!] + ' · ' + Math.round(r.progress * 100) + '%'
        } else if (racing && i === live!.index) {
          li.className = 'now'
          mark.className = 'st'
          mark.innerHTML = icon('right')
          text.textContent = 'driving…'
        } else {
          mark.className = 'st'
          mark.textContent = '·'
          text.textContent = '—'
        }
        li.append(n, mark, text)
        return li
      }),
    )
    const sum = summarise(results)
    $('raceTotal').textContent = results.length ? sum.finished + '/' + results.length + ' finished · ' + sum.totalTime.toFixed(1) + ' s' : ''
    const s = live?.summary
    $('resultPanel').hidden = !s
    if (!s) {
      // a new race has started: the last result's share message is about an older race
      $('resultMsg').textContent = ''
      $('resultBoardMsg').textContent = ''
      d.onResult?.(gp().id, null)
      $('resultLink').hidden = true
    }
    if (s) {
      const medal = medalFor(s, live!.gp)
      const m = $('medal')
      m.textContent = live!.loan ? lentHeadline(live!) : medal ? medal.toUpperCase() : headline(s, live!.gp)
      m.style.color = medal ? MEDAL_COLOUR[medal] : isSecretGp(live!.gp) ? COL.text : COL.muted
      const gens = live!.car.generations
      const watched = live!.watching
      const lent = live!.loan
      $('resultLine').textContent = (lent ? 'The starter car: ' : watched ? 'That was ' + live!.car.name + "'s car: " : '') + s.finished + ' of ' + live!.count + ' finished · ' + s.totalTime.toFixed(1) + ' s total' + (gens && !watched ? ' · trained for ' + gens + ' rounds' : '')
      $('advice').textContent = lent
        ? 'That was a short race of ' + live!.count + ' tracks; a Grand Prix has ' + RACE_COUNT + '. The starter car has had only 4% of a full training. Train your own, which takes a minute or two, and come back to beat ' + live!.opp!.car.name + '.'
        : watched ? 'Now build and train your own car in the Garage and Practice, then race it here to beat it.' : adviceFor(s, live!.gp, live!.car.build.weather === 'wet')
      $('resultShare').hidden = watched
      $('resultPanel').toggleAttribute('data-watched', watched) // not your car's race: nothing to put on a board (style.css)
      // the one line that says how close this was: the gap to gold, or what the next medal takes
      const left = RACE_COUNT - s.finished
      const tracks = (n: number) => n + ' more ' + (n === 1 ? 'track' : 'tracks')
      $('resultGap').textContent =
        watched || isSecretGp(live!.gp)
          ? ''
          : medal === 'gold'
            ? 'Gold medal, ' + Math.max(0, live!.gp.goldTime - s.totalTime).toFixed(1) + ' s ahead.'
            : medal === 'silver'
              ? Math.max(0.1, s.totalTime - live!.gp.goldTime).toFixed(1) + ' s behind the gold medal.'
              : s.finished >= BRONZE_FINISHES
                ? 'Finish ' + tracks(left) + ' for silver.'
                : 'Finish ' + tracks(BRONZE_FINISHES - s.finished) + ' for bronze.'
      $('advice').classList.toggle('warn', !watched && left > 0) // the red edge is for a car that crashed out, not for a clean run
      if (!watched) d.onResult?.(live!.gp.id, s)
      // the share card: one coloured square a track, green for a quick lap, amber for a slow one, dark for a crash
      const quick = live!.gp.goldTime / RACE_COUNT
      const squares = (res: RaceResult) => res.tracks.map((t) => Object.assign(document.createElement('i'), { className: 'sq ' + (t.time === null ? 'bad' : t.time <= quick ? 'fast' : 'ok') }))
      $('scGp').textContent = live!.gp.name.toUpperCase()
      const oppNow = live!.opp
      const duel = oppNow && (!watched || lent) ? { name: oppNow.car.name, res: oppResult(live!) } : null
      $('scGrid').classList.toggle('duel', !!duel)
      if (duel) {
        // head to head: a row of squares for each car, and who won by how much
        const won = better(s, duel.res)
        const lost = better(duel.res, s)
        const row = (who: string, res: RaceResult) => {
          const div = Object.assign(document.createElement('div'), { className: 'sc-row' })
          div.append(Object.assign(document.createElement('span'), { className: 'sc-who', textContent: who }), ...squares(res), Object.assign(document.createElement('span'), { className: 'sc-t', textContent: scoreOf(res, live!.count) }))
          return div
        }
        $('scGrid').replaceChildren(row(live!.car.name, s), row(duel.name, duel.res))
        $('scName').textContent = live!.car.name + ' vs ' + duel.name
        $('scMedal').textContent = won ? 'WON' : lost ? 'LOST' : 'DEAD HEAT'
        $('scMedal').style.color = won ? COL.good : lost ? COL.bad : COL.text
        $('scLine').textContent = won ? 'Beat ' + duel.name + lead(s, duel.res) : lost ? duel.name + ' won' + lead(duel.res, s) : 'Exactly level with ' + duel.name
        $('resultPractice').textContent = lost ? 'Retrain and rematch →' : 'Go to Practice →'
        $('resultPractice').className = lost && !lent ? 'btn small primary' : 'btn small'
      } else {
        $('scGrid').replaceChildren(...squares(s))
        $('scName').textContent = live!.car.name
        $('scMedal').textContent = medal ? medal.toUpperCase() : s.finished + ' OF ' + RACE_COUNT
        $('scMedal').style.color = medal ? MEDAL_COLOUR[medal] : COL.text
        $('scLine').textContent = s.finished === RACE_COUNT ? s.totalTime.toFixed(1) + ' s over ' + RACE_COUNT + (live!.gp.day !== undefined ? ' tracks' : ' secret tracks') : s.finished + ' of ' + RACE_COUNT + (live!.gp.day !== undefined ? ' tracks' : ' secret tracks') + ' finished'
        $('resultPractice').textContent = 'Go to Practice →'
        $('resultPractice').className = 'btn small'
      }
      // after the starter car's race there is one way on: the Garage, to build a car of your own
      $('resultPractice').hidden = lent
      $('resultGarage').textContent = lent ? 'Build your own car →' : 'Edit setup in Garage →'
      $('resultGarage').className = lent ? 'btn primary' : 'btn small'
    }
    $('shareCard').hidden = !s
    // a friend's challenge, and how your latest race compares with it
    const ch = d.getChallenge()
    $('challengePanel').hidden = !ch
    if (ch && 'error' in ch) {
      $('challengeLine').textContent = ch.error + ' Ask your friend to send it again.'
      $('challengeVs').textContent = ''
    } else if (ch) {
      const rival = rivalResult(ch, gp())
      const rivalMedal = medalFor(rival, gp())
      $('challengeLine').textContent =
        (rivalMedal ? ch.car.name + ' got ' + rivalMedal.toUpperCase() + ' in ' + gp().name + ': ' : ch.car.name + "'s result in " + gp().name + ': ') + rival.finished + ' of ' + RACE_COUNT + ' finished · ' + rival.totalTime.toFixed(1) + ' s total.' +
        (car ? ' Race your car on the same tracks: its car drives beside yours as a ghost.' : ' Watch it race now, then train a car in Practice to beat it.')
      $('challengeVs').textContent = live?.summary ? versus(live.summary, rival, ch.car.name) : ''
    }
    // the rival ladder: Grand Prix 1 only, and out of the way while a friend's challenge is loaded
    const rungs = d.ladder.list()
    const next = d.ladder.next()
    $('ladderPanel').hidden = !!ch || gp() !== GRAND_PRIXES[0]
    $('ladderCount').textContent = rungs.filter((r) => r.beaten).length + ' of ' + rungs.length + ' beaten'
    $('ladderList').replaceChildren(
      ...rungs.map((r, i) => {
        const li = document.createElement('li')
        const isNext = !!next && next.index === i && !r.beaten
        li.className = r.beaten ? 'beaten' : isNext ? 'next' : ''
        const mark = Object.assign(document.createElement('span'), { className: 'st' + (r.beaten ? ' ok' : '') })
        if (r.beaten) mark.innerHTML = icon('check')
        else mark.textContent = String(i + 1)
        li.append(mark, Object.assign(document.createElement('b'), { textContent: r.name }), Object.assign(document.createElement('span'), { className: 't', textContent: r.score }))
        return li
      }),
    )
    const lastOpp = live?.summary && !live.watching ? live.opp : null
    $('ladderLine').textContent =
      lastOpp && lastOpp.rung !== undefined
        ? versus(live!.summary!, rivalResult(lastOpp, live!.gp), lastOpp.car.name) + (rungs[lastOpp.rung].beaten && next && next.index !== lastOpp.rung ? ' Next rival: ' + next.car.name + '.' : '')
        : !next
          ? ''
          : rungs.every((r) => r.beaten)
            ? 'Every rival beaten. ' + next.car.name + ' still drives beside you as a ghost.'
            : car
              ? next.car.name + ' drives beside your car as a ghost. Beat its result to move up.'
              : loan
                ? 'Race the starter car now, then build your own car to climb the ladder.'
                : 'Watch ' + next.car.name + ' race now, then train a car in Practice to beat it.'
    const fewest = loadFewest(gp().id)
    const fewestText = (['gold', 'silver', 'bronze'] as const).filter((m) => fewest[m] !== undefined).map((m) => m + ' in ' + fewest[m]).join(' · ')
    $('pb').textContent =
      (best
        ? (live?.newBest ? 'New personal best! ' : 'Personal best: ') + best.finished + '/' + RACE_COUNT + ' · ' + best.totalTime.toFixed(1) + ' s · ' + best.name
        : 'No personal best yet.') + (fewestText ? '. Fewest rounds to a medal: ' + fewestText + '.' : '')
  }

  // ---------- THE BIG SCREEN ----------
  function draw() {
    const { ctx, cam, hudText } = d
    clear(ctx)
    const r = live
    if (!r && idle) {
      hudText(idle.title, W / 2, H / 2 - 20, 56, COL.text, 'center')
      hudText(idle.sub, W / 2, H / 2 + 20, 18, COL.muted, 'center')
      d.setStrip([['Tracks', String(RACE_COUNT)], ['Finished', '–'], ['Total time', '–'], ['Personal best', '–']])
      return
    }
    if (!r) {
      hudText(gp().name.toUpperCase(), W / 2, H / 2 - 20, 56, COL.text, 'center')
      hudText(gp().day !== undefined ? RACE_COUNT + ' OPEN TRACKS · RACE THEM AS OFTEN AS YOU LIKE' : RACE_COUNT + ' TRACKS YOUR CAR HAS NEVER SEEN', W / 2, H / 2 + 14, 18, COL.muted, 'center')
      hudText(d.getCar() ? 'PRESS RACE YOUR CAR' : loanNow() ? 'PRESS RACE A STARTER CAR' : 'TRAIN A CAR IN PRACTICE FIRST', W / 2, H / 2 + 50, 16, COL.accent, 'center')
      d.setStrip([['Tracks', String(RACE_COUNT)], ['Finished', '–'], ['Total time', '–'], ['Personal best', best ? best.finished + '/' + RACE_COUNT : '–']])
      return
    }
    const lap = r.lap
    const result = r.results[r.index]
    follow(cam, lap)
    withCamera(ctx, cam, () => {
      drawTrack(ctx, lap.track)
      if (result?.at) drawCrash(ctx, result.at.x, result.at.y)
      const g = r.ghost
      if (g && !g.lap.dead && !g.done && !r.summary) {
        ctx.globalAlpha = 0.5
        drawCar(ctx, g.lap, 34, 18, COL.tele, 0)
        ctx.globalAlpha = 1
      }
      if (!lap.dead) {
        if (!result) drawRays(ctx, lap)
        if (r.watching && !r.loan) drawCar(ctx, lap, 34, 18, COL.tele, 0) // the friend's car is not yours, so not in your paint
        else drawMine(ctx, lap, 34, 18, d.getLook())
      }
    })
    drawMinimap(ctx, lap.track, cam, lap)
    const sum = summarise(r.results)
    if (r.summary) {
      // the whole race is over: the result on top of the last track
      const medal = medalFor(r.summary, r.gp)
      ctx.fillStyle = 'rgba(7,9,12,0.72)'
      ctx.fillRect(0, 0, W, H)
      hudText(r.loan ? lentHeadline(r) : medal ? medal.toUpperCase() : headline(r.summary, r.gp), W / 2, H / 2 - 16, 64, r.loan ? COL.text : medal ? MEDAL_COLOUR[medal] : isSecretGp(r.gp) ? COL.text : COL.muted, 'center')
      hudText(r.summary.finished + ' / ' + r.count + ' FINISHED  ·  ' + r.summary.totalTime.toFixed(1) + ' S', W / 2, H / 2 + 22, 22, COL.text, 'center')
      if (r.newBest) hudText('NEW PERSONAL BEST', W / 2, H / 2 + 54, 18, COL.accent, 'center')
      if (r.loan) hudText('BUILD YOUR OWN CAR TO BEAT ' + r.opp!.car.name.toUpperCase(), W / 2, H / 2 + 54, 18, COL.accent, 'center')
      else if (r.opp && !r.watching) hudText(versus(r.summary, rivalResult(r.opp, r.gp), r.opp.car.name).toUpperCase(), W / 2, H / 2 + 86, 18, COL.text, 'center')
    } else {
      hudText('TRACK ' + (r.index + 1) + ' / ' + r.count, 16, 42, 34)
      const road = [r.gp.wet ? 'WET ROAD' : '', r.gp.night ? 'NIGHT' : '', r.gp.ice ? 'ICE PATCHES' : ''].filter(Boolean).join(' · ')
      if (road) hudText(road, W - 16, 42, 24, COL.tele, 'right')
      hudText(time(result?.time ?? lap.steps / 60), 16, 74, 30, result ? (result.time !== null ? COL.good : COL.bad) : COL.text)
      if (result) hudText(result.time !== null ? 'FINISHED' : CAUSE_LABEL[result.cause!].toUpperCase(), W / 2, 60, 30, result.time !== null ? COL.good : COL.bad, 'center')
      hudText(speed + '× SPEED', W - 16, H - 16, 16, COL.muted, 'right')
      if (r.watching) hudText(r.loan ? 'STARTER CAR · BUILD YOUR OWN AFTER THIS RACE' : 'WATCHING ' + r.car.name.toUpperCase(), W / 2, H - 16, 16, COL.tele, 'center')
      const g = r.ghost
      if (g) {
        const gt = g.done ? (g.lap.passed >= CHECKPOINTS ? time(g.lap.steps / 60) : 'CRASHED') : time(g.lap.steps / 60)
        hudText('GHOST ' + g.car.name.toUpperCase() + '  ' + gt, 16, 104, 16, COL.tele)
      }
    }
    d.setStrip([
      ['Track', Math.min(r.index + 1, r.count) + '<small>/' + r.count + '</small>'],
      ['Finished', sum.finished + '<small>/' + r.results.length + '</small>'],
      ['Total time', sum.totalTime.toFixed(1) + '<small> s</small>'],
      // something to race against on every track: how far the finished tracks are ahead of or behind the time that wins the gold medal
      // (a Grand Prix with no gold line keeps the lap counter)
      r.gp.goldTime > 0
        ? ['Gold medal', sum.finished ? goldGap(sum.totalTime - (r.gp.goldTime * sum.finished) / RACE_COUNT) : '–']
        : ['Lap', r.summary ? '–' : Math.round((100 * Math.min(lap.passed, CHECKPOINTS)) / CHECKPOINTS) + '<small>%</small>'],
    ])
  }

  // How the finished tracks stand against the time that wins the gold medal: seconds ahead (green) or behind (red)
  function goldGap(d: number): string {
    const gap = Math.abs(d).toFixed(1)
    if (gap === '0.0') return 'Level'
    return '<span class="' + (d > 0 ? 'behind' : 'ahead') + '">' + gap + '<small> s ' + (d > 0 ? 'behind' : 'ahead') + '</small></span>'
  }

  ;[...GRAND_PRIXES, null].forEach((_, i) => $('gp' + i).addEventListener('click', () => selectGp(i)))
  renderGp()
  $('raceGo').addEventListener('click', start)
  $('resultGarage').addEventListener('click', () => d.goTo('garage'))
  $('resultPractice').addEventListener('click', () => d.goTo('practice'))
  $('raceSkip').addEventListener('click', skip)
  $('raceSpeed').addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    render()
  })

  // Close the finished week or day that was opened, back to the fixed Grand Prix (not while a race is running)
  function clearPast() {
    if (!pastWeek || (live && !live.summary)) return
    pastWeek = null
    if (gpIndex >= GRAND_PRIXES.length) {
      gpIndex = 0
      live = null
      best = loadBest(gp())
    }
    renderGp()
    render()
  }
  // What the big screen says while no race is on, when a challenge is chosen but no track set is open yet
  let idle: { title: string; sub: string } | null = null
  const setIdle = (i: { title: string; sub: string } | null) => {
    idle = i
  }
  const selectGpId = (id: string) => selectGp(Math.max(0, choices().findIndex((g) => g.id === id)))
  // Open a finished week's tracks as a third choice and switch to it
  function showPastWeek(g: GrandPrix) {
    if (live && !live.summary) return
    if (pastWeek?.id !== g.id) {
      pastWeek = g
      if (gpIndex === GRAND_PRIXES.length) gpIndex = -1 // so selectGp below treats it as a change
    }
    selectGp(GRAND_PRIXES.length)
  }
  // The words that go with the share card, for a message or a post: no spoilers, only the pattern and a dare
  function shareText(link: string): string | null {
    const s = live?.summary
    if (!s || !live || live.watching) return null
    // a friend knows the car they sent, so the words are about the duel; a ladder rival means nothing to them
    const o = live.opp
    if (o && o.rung === undefined) return duelText(live.car.name, o.car.name, live.gp, s, rivalResult(o, live.gp), link)
    return cardText(live.car.name, live.gp, s, link)
  }
  // Start a race now unless one is under way: used when a car is picked from a board to race against, so the race
  // against its ghost runs at once and the last result is not left on screen as if it were the answer
  const startNow = () => {
    if (live && !live.summary) return
    start()
  }
  return { tick, draw, render, gpId: () => gp().id, selectGpId, showPastWeek, clearPast, setIdle, shareText, startNow }
}
