// The Race tab: your car drives the Grand Prix tracks one after another while the timing tower
// fills in, then the result, medal, personal best and one piece of advice.
import type { CarFile } from './carFile'
import { genomeToBrain } from './genome'
import { CHECKPOINTS, createCar, drive, type Brain, type Car } from './sim'
import { shapeOf, specOf, type CarSpec } from './setup'
import {
  CAUSE_LABEL, GRAND_PRIX, MEDAL_RULES, RACE_COUNT, adviceFor, better, finishLap, lapIsOver, medalFor, raceTrack, summarise,
  type Medal, type RaceResult, type TrackResult,
} from './race'
import { COL, H, W, clear, drawCar, drawCrash, drawMinimap, drawRays, drawTrack, follow, withCamera, type Camera } from './draw'

export type RaceDeps = {
  ctx: CanvasRenderingContext2D
  cam: Camera
  getCar: () => CarFile | null
  isStale: () => boolean
  hudText: (text: string, x: number, y: number, size: number, colour?: string, align?: CanvasTextAlign) => void
  setStrip: (cells: [string, string][]) => void
}

type Best = { finished: number; totalTime: number; name: string }
type Live = {
  car: CarFile
  brain: Brain
  spec: CarSpec
  index: number // the track being driven
  lap: Car
  results: TrackResult[]
  hold: number // steps left to linger on a finished lap
  summary: RaceResult | null // set when the whole race is over
  newBest: boolean
}

const BEST_KEY = 'crashlab.best.' + GRAND_PRIX.id
const SPEEDS = [1, 4, 16]
const HOLD = 90 // 1.5 seconds on each finished lap
const MEDAL_COLOUR: Record<Exclude<Medal, null>, string> = { gold: '#ffcc33', silver: '#c7ced8', bronze: '#cd8a4f' }

function loadBest(): Best | null {
  try {
    const text = localStorage.getItem(BEST_KEY)
    return text ? (JSON.parse(text) as Best) : null
  } catch {
    return null
  }
}
function saveBest(b: Best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b))
  } catch {
    /* storage blocked: the best only lasts this visit */
  }
}

const time = (s: number | null) => (s === null ? '--.--' : s.toFixed(2))
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export function createRaceView(d: RaceDeps) {
  let live: Live | null = null
  let speed = 4
  let best = loadBest()
  $('medalRules').textContent = MEDAL_RULES

  function start() {
    const car = d.getCar()
    if (!car) return
    const spec = specOf(car.build)
    live = {
      car,
      brain: genomeToBrain(car.genome, shapeOf(car.build.sensors)),
      spec,
      index: 0,
      lap: createCar(raceTrack(0), spec),
      results: [],
      hold: 0,
      summary: null,
      newBest: false,
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
    r.lap = createCar(raceTrack(r.index), r.spec)
    follow(d.cam, r.lap, true)
  }

  function finish(r: Live) {
    r.index = RACE_COUNT - 1
    r.summary = summarise(r.results)
    if (!best || better(r.summary, best)) {
      best = { finished: r.summary.finished, totalTime: r.summary.totalTime, name: r.car.name }
      saveBest(best)
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
      const lap = createCar(raceTrack(r.results.length), r.spec)
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
    if (r.hold > 0) {
      if (--r.hold === 0) nextTrack(r)
      return
    }
    for (let k = 0; k < speed; k++) {
      drive(r.lap, r.brain)
      if (lapIsOver(r.lap)) return endLap(r)
    }
  }

  // ---------- THE SIDE PANEL ----------
  function render() {
    const car = d.getCar()
    const racing = !!live && !live.summary
    const go = $<HTMLButtonElement>('raceGo')
    go.disabled = !car || racing
    go.textContent = live?.summary ? 'Race again' : 'Race your car'
    $<HTMLButtonElement>('raceSkip').disabled = !racing
    $('raceSpeed').textContent = 'Speed ' + speed + '×'
    $('raceMsg').textContent = !car
      ? 'Train a car in Practice first.'
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
    if (s) {
      const medal = medalFor(s)
      const m = $('medal')
      m.textContent = medal ? medal.toUpperCase() : 'NO MEDAL'
      m.style.color = medal ? MEDAL_COLOUR[medal] : COL.muted
      $('resultLine').textContent = s.finished + ' of ' + RACE_COUNT + ' finished · ' + s.totalTime.toFixed(1) + ' s total'
      $('advice').textContent = adviceFor(s)
    }
    $('pb').textContent = best
      ? (live?.newBest ? 'New personal best! ' : 'Personal best: ') + best.finished + '/' + RACE_COUNT + ' · ' + best.totalTime.toFixed(1) + ' s · ' + best.name
      : 'No personal best yet.'
  }

  // ---------- THE BIG SCREEN ----------
  function draw() {
    const { ctx, cam, hudText } = d
    clear(ctx)
    const r = live
    if (!r) {
      hudText(GRAND_PRIX.name.toUpperCase(), W / 2, H / 2 - 20, 56, COL.text, 'center')
      hudText(RACE_COUNT + ' TRACKS YOUR CAR HAS NEVER SEEN', W / 2, H / 2 + 14, 18, COL.muted, 'center')
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
      if (!lap.dead) {
        if (!result) drawRays(ctx, lap)
        drawCar(ctx, lap, 34, 18, COL.accent)
      }
    })
    drawMinimap(ctx, lap.track, cam, lap)
    const sum = summarise(r.results)
    if (r.summary) {
      // the whole race is over: the result on top of the last track
      const medal = medalFor(r.summary)
      ctx.fillStyle = 'rgba(7,9,12,0.72)'
      ctx.fillRect(0, 0, W, H)
      hudText(medal ? medal.toUpperCase() : 'NO MEDAL', W / 2, H / 2 - 16, 64, medal ? MEDAL_COLOUR[medal] : COL.muted, 'center')
      hudText(r.summary.finished + ' / ' + RACE_COUNT + ' FINISHED  ·  ' + r.summary.totalTime.toFixed(1) + ' S', W / 2, H / 2 + 22, 22, COL.text, 'center')
      if (r.newBest) hudText('NEW PERSONAL BEST', W / 2, H / 2 + 54, 18, COL.accent, 'center')
    } else {
      hudText('TRACK ' + (r.index + 1) + ' / ' + RACE_COUNT, 16, 42, 34)
      hudText(time(result?.time ?? lap.steps / 60), 16, 74, 30, result ? (result.time !== null ? COL.good : COL.bad) : COL.text)
      if (result) hudText(result.time !== null ? 'FINISHED' : CAUSE_LABEL[result.cause!].toUpperCase(), W / 2, 60, 30, result.time !== null ? COL.good : COL.bad, 'center')
      hudText(speed + '× SPEED', W - 16, H - 16, 16, COL.muted, 'right')
    }
    d.setStrip([
      ['Track', Math.min(r.index + 1, RACE_COUNT) + '<small>/' + RACE_COUNT + '</small>'],
      ['Lap', r.summary ? '–' : Math.round((100 * Math.min(lap.passed, CHECKPOINTS)) / CHECKPOINTS) + '<small>%</small>'],
      ['Finished', sum.finished + '<small>/' + r.results.length + '</small>'],
      ['Total time', sum.totalTime.toFixed(1) + '<small> s</small>'],
    ])
  }

  $('raceGo').addEventListener('click', start)
  $('raceSkip').addEventListener('click', skip)
  $('raceSpeed').addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    render()
  })

  return { tick, draw, render }
}
