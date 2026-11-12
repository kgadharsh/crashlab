// The Race tab: your car drives the Grand Prix tracks one after another while the timing tower
// fills in, then the result, medal, personal best and one piece of advice.
import type { CarFile } from './carFile'
import { genomeToBrain } from './genome'
import { CHECKPOINTS, createCar, drive, type Brain, type Car } from './sim'
import { brainShape, specOf, type CarSpec } from './setup'
import {
  CAUSE_LABEL, GRAND_PRIXES, RACE_COUNT, dayOf, isSecretGp, adviceFor, better, finishLap, gpTrack, lapIsOver, medalFor, medalRules, raceCar, summarise, versus,
  type GrandPrix, type Medal, type RaceResult, type TrackResult,
} from './race'
import { logEvent, recordChallenge } from './playLog'
import { loadFewest, recordFewest } from './board'
import { drawMine } from './perks'
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
  watching: boolean // no car of your own: the friend's car is the one racing, and nothing is recorded
}
type Ghost = { car: CarFile; brain: Brain; spec: CarSpec; lap: Car; done: boolean }
const GHOST_WAIT = 240 // at most 4 more seconds at the end of a track for the ghost to finish its lap

const bestKey = (gp: GrandPrix) => 'crashlab.best.' + gp.id // the first Grand Prix keeps the key it always had
const GP_KEY = 'crashlab.gp'
const SPEEDS = [1, 4, 16]
const HOLD = 90 // 1.5 seconds on each finished lap
const MEDAL_COLOUR: Record<Exclude<Medal, null>, string> = { gold: '#e5a83c', silver: '#c7ced8', bronze: '#cd8a4f' }

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
const scoreOf = (r: RaceResult) => (r.finished === RACE_COUNT ? r.totalTime.toFixed(1) + ' s' : r.finished + '/' + RACE_COUNT)
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
    if (i >= 0) return ch.results[i]
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
    if (pastWeek) $('gp2').innerHTML = pastWeek.day !== undefined ? '<i aria-hidden="true">⚡</i><b></b><small>' + (pastWeek.day === dayOf(Date.now()) ? 'Today · open to all' : 'Past day · open now') + '</small>' : '<i aria-hidden="true">📅</i><b></b><small>Past week · open now</small>'
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

  // the friend's car from a challenge link, if there is one that could be read
  const rivalCar = () => {
    const ch = d.getChallenge()
    return ch && !('error' in ch) ? ch.car : null
  }
  function makeGhost(rival: CarFile, track: ReturnType<typeof gpTrack>): Ghost {
    const spec = specOf(rival.build)
    return { car: rival, brain: genomeToBrain(rival.genome, brainShape(rival.build)), spec, lap: createCar(track, spec), done: false }
  }

  function start() {
    const own = d.getCar()
    const rival = rivalCar()
    // with no car of your own, a challenge link's car can still be watched
    const car = own ?? rival
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
      ghost: own && rival ? makeGhost(rival, gpTrack(gp(), 0)) : null,
      wait: 0,
      watching: !own,
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
    if (r.index >= RACE_COUNT) return finish(r)
    r.lap = createCar(gpTrack(r.gp, r.index), r.spec)
    if (r.ghost) r.ghost = makeGhost(r.ghost.car, gpTrack(r.gp, r.index))
    r.wait = 0
    follow(d.cam, r.lap, true)
  }

  function finish(r: Live) {
    r.index = RACE_COUNT - 1
    r.summary = summarise(r.results)
    // watching a friend's car records nothing: it is not your race
    if (r.watching) return render()
    // a race against a friend's car from a challenge link counts as won or lost
    const ch = d.getChallenge()
    if (ch && !('error' in ch)) recordChallenge(better(r.summary, rivalResult(ch, r.gp)))
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

  // Drive the rest of the race without showing it
  function skip() {
    const r = live
    if (!r || r.summary) return
    if (r.results.length === r.index) {
      while (!lapIsOver(r.lap)) drive(r.lap, r.brain)
      r.results.push(finishLap(r.lap))
    }
    while (r.results.length < RACE_COUNT) {
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
    const racing = !!live && !live.summary
    const rival = rivalCar()
    const go = $<HTMLButtonElement>('raceGo')
    go.disabled = (!car && !rival) || racing
    // with no car of your own, a friend's challenge car can be watched straight away
    go.textContent = !car && rival ? 'Watch ' + rival.name + ' race' : live?.summary ? 'Race again' : 'Race your car'
    $<HTMLButtonElement>('raceSkip').disabled = !racing
    choices().forEach((_, i) => ($<HTMLButtonElement>('gp' + i).disabled = racing)) // the Grand Prix cannot change mid-race
    $('raceSpeed').textContent = 'Speed ' + speed + '×'
    $('raceMsg').textContent = !car
      ? rival
        ? 'You have no car yet. Watch ' + rival.name + ' drive these tracks, then train a car in Practice to beat it.'
        : 'Train a car in Practice first.'
      : d.isStale()
        ? 'Racing ' + car.name + ', as trained. Your latest garage changes are not in it yet.'
        : 'Racing ' + car.name + '.'
    const results = live?.results ?? []
    $('tower').replaceChildren(
      ...Array.from({ length: RACE_COUNT }, (_, i) => {
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
          mark.textContent = r.time !== null ? '✓' : '✕'
          text.textContent = r.time !== null ? time(r.time) + ' s' : CAUSE_LABEL[r.cause!] + ' · ' + Math.round(r.progress * 100) + '%'
        } else if (racing && i === live!.index) {
          li.className = 'now'
          mark.className = 'st'
          mark.textContent = '▸'
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
      m.textContent = medal ? medal.toUpperCase() : headline(s, live!.gp)
      m.style.color = medal ? MEDAL_COLOUR[medal] : isSecretGp(live!.gp) ? COL.text : COL.muted
      const gens = live!.car.generations
      const watched = live!.watching
      $('resultLine').textContent = (watched ? 'That was ' + live!.car.name + "'s car: " : '') + s.finished + ' of ' + RACE_COUNT + ' finished · ' + s.totalTime.toFixed(1) + ' s total' + (gens && !watched ? ' · trained for ' + gens + ' rounds' : '')
      $('advice').textContent = watched ? 'Now build and train your own car in the Garage and Practice, then race it here to beat it.' : adviceFor(s, live!.gp, live!.car.build.weather === 'wet')
      $('resultShare').hidden = watched
      if (!watched) d.onResult?.(live!.gp.id, s)
      // the share card: one coloured square a track, green for a quick lap, amber for a slow one, dark for a crash
      const quick = live!.gp.goldTime / RACE_COUNT
      const squares = (res: RaceResult) => res.tracks.map((t) => Object.assign(document.createElement('i'), { className: 'sq ' + (t.time === null ? 'bad' : t.time <= quick ? 'fast' : 'ok') }))
      $('scGp').textContent = live!.gp.name.toUpperCase()
      const chNow = d.getChallenge()
      const duel = chNow && !('error' in chNow) && !watched ? { name: chNow.car.name, res: rivalResult(chNow, live!.gp) } : null
      $('scGrid').classList.toggle('duel', !!duel)
      if (duel) {
        // head to head: a row of squares for each car, and who won by how much
        const won = better(s, duel.res)
        const lost = better(duel.res, s)
        const row = (who: string, res: RaceResult) => {
          const div = Object.assign(document.createElement('div'), { className: 'sc-row' })
          div.append(Object.assign(document.createElement('span'), { className: 'sc-who', textContent: who }), ...squares(res), Object.assign(document.createElement('span'), { className: 'sc-t', textContent: scoreOf(res) }))
          return div
        }
        $('scGrid').replaceChildren(row(live!.car.name, s), row(duel.name, duel.res))
        $('scName').textContent = live!.car.name + ' vs ' + duel.name
        $('scMedal').textContent = won ? 'WON' : lost ? 'LOST' : 'DEAD HEAT'
        $('scMedal').style.color = won ? COL.good : lost ? COL.bad : COL.text
        $('scLine').textContent = won ? 'Beat ' + duel.name + lead(s, duel.res) : lost ? duel.name + ' won' + lead(duel.res, s) : 'Exactly level with ' + duel.name
        $('resultPractice').textContent = lost ? 'Retrain and rematch →' : 'Go to Practice →'
        $('resultPractice').className = lost ? 'btn small primary' : 'btn small'
      } else {
        $('scGrid').replaceChildren(...squares(s))
        $('scName').textContent = live!.car.name
        $('scMedal').textContent = medal ? medal.toUpperCase() : s.finished + ' OF ' + RACE_COUNT
        $('scMedal').style.color = medal ? MEDAL_COLOUR[medal] : COL.text
        $('scLine').textContent = s.finished === RACE_COUNT ? s.totalTime.toFixed(1) + ' s over ' + RACE_COUNT + (live!.gp.day !== undefined ? ' tracks' : ' secret tracks') : s.finished + ' of ' + RACE_COUNT + (live!.gp.day !== undefined ? ' tracks' : ' secret tracks') + ' finished'
        $('resultPractice').textContent = 'Go to Practice →'
        $('resultPractice').className = 'btn small'
      }
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
      hudText(d.getCar() ? 'PRESS RACE YOUR CAR' : 'TRAIN A CAR IN PRACTICE FIRST', W / 2, H / 2 + 50, 16, COL.accent, 'center')
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
        if (r.watching) drawCar(ctx, lap, 34, 18, COL.tele, 0) // the friend's car is not yours, so not in your paint
        else drawMine(ctx, lap, 34, 18, d.getLook())
      }
    })
    drawMinimap(ctx, lap.track, cam, lap)
    const sum = summarise(r.results)
    if (r.summary) {
      // the whole race is over: the result on top of the last track
      const medal = medalFor(r.summary, r.gp)
      ctx.fillStyle = 'rgba(4,2,5,0.78)'
      ctx.fillRect(0, 0, W, H)
      hudText(medal ? medal.toUpperCase() : headline(r.summary, r.gp), W / 2, H / 2 - 16, 64, medal ? MEDAL_COLOUR[medal] : isSecretGp(r.gp) ? COL.text : COL.muted, 'center')
      hudText(r.summary.finished + ' / ' + RACE_COUNT + ' FINISHED  ·  ' + r.summary.totalTime.toFixed(1) + ' S', W / 2, H / 2 + 22, 22, COL.text, 'center')
      if (r.newBest) hudText('NEW PERSONAL BEST', W / 2, H / 2 + 54, 18, COL.accent, 'center')
      const ch = d.getChallenge()
      if (ch && !('error' in ch)) hudText(versus(r.summary, rivalResult(ch, r.gp), ch.car.name).toUpperCase(), W / 2, H / 2 + 86, 18, COL.text, 'center')
    } else {
      hudText('TRACK ' + (r.index + 1) + ' / ' + RACE_COUNT, 16, 42, 34)
      const road = [r.gp.wet ? 'WET ROAD' : '', r.gp.night ? 'NIGHT' : '', r.gp.ice ? 'ICE PATCHES' : ''].filter(Boolean).join(' · ')
      if (road) hudText(road, W - 16, 42, 24, COL.tele, 'right')
      hudText(time(result?.time ?? lap.steps / 60), 16, 74, 30, result ? (result.time !== null ? COL.good : COL.bad) : COL.text)
      if (result) hudText(result.time !== null ? 'FINISHED' : CAUSE_LABEL[result.cause!].toUpperCase(), W / 2, 60, 30, result.time !== null ? COL.good : COL.bad, 'center')
      hudText(speed + '× SPEED', W - 16, H - 16, 16, COL.muted, 'right')
      if (r.watching) hudText('WATCHING ' + r.car.name.toUpperCase(), W / 2, H - 16, 16, COL.tele, 'center')
      const g = r.ghost
      if (g) {
        const gt = g.done ? (g.lap.passed >= CHECKPOINTS ? time(g.lap.steps / 60) : 'CRASHED') : time(g.lap.steps / 60)
        hudText('GHOST ' + g.car.name.toUpperCase() + '  ' + gt, 16, 104, 16, COL.tele)
      }
    }
    d.setStrip([
      ['Track', Math.min(r.index + 1, RACE_COUNT) + '<small>/' + RACE_COUNT + '</small>'],
      ['Lap', r.summary ? '–' : Math.round((100 * Math.min(lap.passed, CHECKPOINTS)) / CHECKPOINTS) + '<small>%</small>'],
      ['Finished', sum.finished + '<small>/' + r.results.length + '</small>'],
      ['Total time', sum.totalTime.toFixed(1) + '<small> s</small>'],
    ])
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
    const ch = d.getChallenge()
    if (ch && !('error' in ch)) return duelText(live.car.name, ch.car.name, live.gp, s, rivalResult(ch, live.gp), link)
    return cardText(live.car.name, live.gp, s, link)
  }
  return { tick, draw, render, gpId: () => gp().id, selectGpId, showPastWeek, clearPast, setIdle, shareText }
}
