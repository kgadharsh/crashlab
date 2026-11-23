// Build a track: the player drags a ring of points on the track screen, the road follows, and their car can race a
// lap of it. A track travels in a link (with the lap to beat), so a friend can race their own car on it.
// It is for fun: a hand-drawn track is never used for training, medals or the leaderboards, which depend on tracks
// nobody chose.
import type { CarFile } from './carFile'
import { genomeToBrain } from './genome'
import { createCar, drive, type Brain, type Car } from './sim'
import { brainShape, specOf } from './setup'
import { DRAWN_EDGE, DRAWN_POINTS, HALF_WIDTH, WORLD, customTrack, decodePoints, encodePoints, trackFeatures, trackFromPoints, type Track } from './track'
import { CAUSE_LABEL, finishLap, lapIsOver, type TrackResult } from './race'
import { drawMine } from './perks'
import { icon } from './icons'
import { COL, H, W, clear, drawCrash, drawMinimap, drawRays, drawTrack, fit, follow, withCamera, type Camera } from './draw'

type Point = { x: number; y: number }
export type BuilderDeps = {
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  cam: Camera
  getCar: () => CarFile | null
  getLook: () => number
  isOpen: () => boolean // the Build a track screen is the one showing
  hudText: (text: string, x: number, y: number, size: number, colour?: string, align?: CanvasTextAlign) => void
  setStrip: (cells: [string, string][]) => void
  onShare: () => void
  onDrawn?: () => void // the drawing has changed and is at rest (a point was dropped, added or removed)
}

const KEY = 'crashlab.mytrack'
export const TRACK_PREFIX = '#track='
const MIN_POINTS = DRAWN_POINTS[0]
const MAX_POINTS = DRAWN_POINTS[1]
const EDGE = DRAWN_EDGE // a point is kept this far inside the world, so the road has room for its walls
const SPEED = 2 // steps a tick while a lap is shown

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const km = (px: number) => (px / 1000).toFixed(1) + ' km'

// The shape a new track starts as: an oval, a little uneven so it is clear the points can move
const starter = (): Point[] =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2
    const r = i % 2 ? 0.92 : 1
    // on the grid of 4 that a link keeps, so a shared track is exactly the one that was raced
    return { x: Math.round((WORLD.w / 2 + Math.cos(a) * 900 * r) / 4) * 4, y: Math.round((WORLD.h / 2 + Math.sin(a) * 520 * r) / 4) * 4 }
  })

// A track as text for a link (track.ts keeps the format, because a build can carry a drawn track too)
const encode = encodePoints
const decode = decodePoints
// The player's drawing as it stands, as text, for the Garage's practice tracks: null when nothing has been drawn yet
// or the drawing cannot be driven
export function savedTrackCode(): string | null {
  try {
    const code = localStorage.getItem(KEY)
    return code && customTrack(code) ? code : null
  } catch {
    return null
  }
}

// Why a shape cannot be driven, and what to do about it (trackProblem gives the short reason)
function plain(problem: string): string {
  if (problem.startsWith('corner')) return 'A bend is too tight for a car to get round. Pull that point outward.'
  if (problem.startsWith('length')) return Number(problem.replace(/\D/g, '')) < 5000 ? 'The lap is too short. Pull the points further apart.' : 'The lap is too long. Pull the points closer together.'
  if (problem.startsWith('road')) return 'Two parts of the road touch. Move them apart.'
  return 'The road runs off the edge. Pull it back in.'
}

export function createTrackBuilder(d: BuilderDeps) {
  let control: Point[] = starter()
  try {
    const saved = localStorage.getItem(KEY)
    control = (saved && decode(saved)) || control
  } catch {
    /* storage blocked: start from the oval */
  }
  let built = trackFromPoints(control)
  let dragging = -1
  let best: number | null = null // the player's quickest lap of this exact shape
  let rival: { time: number; by: string } | null = null // the lap that came with a friend's link
  let run: { track: Track; lap: Car; brain: Brain; result: TrackResult | null; name: string } | null = null

  function changed() {
    built = trackFromPoints(control)
    best = null
    rival = null // a lap time belongs to the shape it was set on
    run = null
    $('buildMsg').textContent = '' // what was copied, or a link that could not be read, was about the shape before
    $('buildLink').hidden = true
    try {
      localStorage.setItem(KEY, encode(control))
    } catch {
      /* storage blocked: the track only lasts this visit */
    }
    render()
    if (dragging < 0) d.onDrawn?.() // while a point is being dragged, the drop says so once
  }

  // ---------- DRAGGING ----------
  const toWorld = (e: PointerEvent): Point => {
    const r = d.canvas.getBoundingClientRect()
    return { x: (((e.clientX - r.left) * W) / r.width - W / 2) / d.cam.zoom + d.cam.x, y: (((e.clientY - r.top) * H) / r.height - H / 2) / d.cam.zoom + d.cam.y }
  }
  d.canvas.addEventListener('pointerdown', (e) => {
    if (!d.isOpen() || (run && !run.result)) return
    if (run) {
      // a finished lap is still on screen, zoomed in on the car: the first press only goes back to the whole track
      run = null
      fit(d.cam, true)
      return render()
    }
    const at = toWorld(e)
    // a finger needs a bigger target than the dot that is drawn: about 26 screen pixels
    const reach = (26 * W) / d.canvas.getBoundingClientRect().width / d.cam.zoom
    let nearest = -1
    let gap = reach
    control.forEach((p, i) => {
      const g = Math.hypot(p.x - at.x, p.y - at.y)
      if (g < gap) [nearest, gap] = [i, g]
    })
    if (nearest < 0) return
    dragging = nearest
    d.canvas.setPointerCapture(e.pointerId)
    e.preventDefault()
  })
  d.canvas.addEventListener('pointermove', (e) => {
    if (dragging < 0) return
    const at = toWorld(e)
    control[dragging] = { x: Math.round(Math.max(EDGE, Math.min(WORLD.w - EDGE, at.x)) / 4) * 4, y: Math.round(Math.max(EDGE, Math.min(WORLD.h - EDGE, at.y)) / 4) * 4 }
    changed()
  })
  const drop = () => {
    if (dragging < 0) return
    dragging = -1
    d.onDrawn?.()
  }
  d.canvas.addEventListener('pointerup', drop)
  d.canvas.addEventListener('pointercancel', drop)

  // ---------- THE BUTTONS ----------
  $('buildMore').addEventListener('click', () => {
    if (control.length >= MAX_POINTS) return
    // the new point goes in the middle of the longest stretch between two points, where there is most to shape
    let at = 0
    let longest = 0
    control.forEach((p, i) => {
      const q = control[(i + 1) % control.length]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      if (len > longest) [at, longest] = [i, len]
    })
    const p = control[at]
    const q = control[(at + 1) % control.length]
    control.splice(at + 1, 0, { x: Math.round((p.x + q.x) / 8) * 4, y: Math.round((p.y + q.y) / 8) * 4 })
    changed()
  })
  $('buildLess').addEventListener('click', () => {
    if (control.length <= MIN_POINTS) return
    // the point that goes is the one doing least: nearest the line between its neighbours (never the start line)
    let at = 1
    let least = Infinity
    for (let i = 1; i < control.length; i++) {
      const a = control[i - 1]
      const c = control[(i + 1) % control.length]
      const off = Math.hypot(control[i].x - (a.x + c.x) / 2, control[i].y - (a.y + c.y) / 2)
      if (off < least) [at, least] = [i, off]
    }
    control.splice(at, 1)
    changed()
  })
  $('buildReset').addEventListener('click', () => {
    control = starter()
    changed()
  })
  $('buildGo').addEventListener('click', () => {
    const car = d.getCar()
    if (!car || built.problem) return
    if (run && !run.result) {
      run = null // Stop
      return render()
    }
    const spec = specOf(car.build)
    run = { track: built.track, lap: createCar(built.track, spec), brain: genomeToBrain(car.genome, brainShape(car.build)), result: null, name: car.name }
    follow(d.cam, run.lap, true)
    render()
  })
  $('buildShare').addEventListener('click', d.onShare)

  function tick() {
    const r = run
    if (!r || r.result) return
    for (let k = 0; k < SPEED; k++) {
      drive(r.lap, r.brain)
      if (!lapIsOver(r.lap)) continue
      r.result = finishLap(r.lap)
      if (r.result.time !== null && (best === null || r.result.time < best)) best = r.result.time
      return render()
    }
  }

  // ---------- THE SIDE PANEL ----------
  function render() {
    const car = d.getCar()
    const racing = !!run && !run.result
    const f = built.problem ? null : trackFeatures(built.track)
    $('buildAside').textContent = control.length + ' points'
    const status = $('buildStatus')
    status.className = 'msg ' + (built.problem ? 'bad' : 'good')
    status.textContent = built.problem ? plain(built.problem) : 'Ready to race: ' + km(f!.length) + ' lap, ' + f!.hairpins + (f!.hairpins === 1 ? ' tight bend' : ' tight bends') + ', ' + f!.blocks + ' blocks.'
    const go = $<HTMLButtonElement>('buildGo')
    go.disabled = !car || !!built.problem
    go.textContent = racing ? 'Stop' : !car ? 'Train a car in Practice first' : run?.result ? 'Race it again' : 'Race your car on it'
    $<HTMLButtonElement>('buildMore').disabled = control.length >= MAX_POINTS || racing
    $<HTMLButtonElement>('buildLess').disabled = control.length <= MIN_POINTS || racing
    $<HTMLButtonElement>('buildReset').disabled = racing
    $<HTMLButtonElement>('buildShare').disabled = !!built.problem
    $('buildRival').hidden = !rival
    if (rival) $('buildRival').textContent = (rival.by ? rival.by + ' lapped this track in ' : 'The lap to beat on this track is ') + rival.time.toFixed(2) + ' s. Race your car on it to beat that.'
    const res = run?.result
    const line = $('buildResult')
    line.hidden = !res
    if (res) {
      const t = res.time
      line.textContent =
        t === null
          ? 'Did not finish: ' + CAUSE_LABEL[res.cause!] + ' after ' + Math.round(res.progress * 100) + '% of the lap.'
          : 'Lap: ' + t.toFixed(2) + ' s.' + (rival ? (t < rival.time ? ' You beat ' + (rival.by || 'the lap to beat') + ' by ' + (rival.time - t).toFixed(2) + ' s.' : ' ' + (rival.time === t ? 'Exactly level.' : (t - rival.time).toFixed(2) + ' s behind ' + (rival.by || 'the lap to beat') + '.')) : '')
    }
    $('buildShare').innerHTML = icon('swords') + (best !== null ? ' Share track and lap' : ' Share this track')
  }

  // ---------- THE BIG SCREEN ----------
  // ready: the words under YOUR TRACK when it can be driven (the Garage draws on it to practise, not to race)
  function draw(ready = 'READY TO RACE') {
    const { ctx, cam, hudText } = d
    clear(ctx)
    const r = run
    const f = built.problem ? null : trackFeatures(built.track)
    if (r) {
      follow(cam, r.lap)
      withCamera(ctx, cam, () => {
        drawTrack(ctx, r.track)
        if (r.result?.at) drawCrash(ctx, r.result.at.x, r.result.at.y)
        if (!r.lap.dead) {
          if (!r.result) drawRays(ctx, r.lap)
          drawMine(ctx, r.lap, 34, 18, d.getLook())
        }
      })
      drawMinimap(ctx, r.track, cam, r.lap)
      hudText('YOUR TRACK', 16, 42, 34)
      const t = r.result ? r.result.time : r.lap.steps / 60
      hudText(t === null ? '--.--' : t.toFixed(2), 16, 74, 30, r.result ? (r.result.time !== null ? COL.good : COL.bad) : COL.text)
      if (r.result) hudText(r.result.time !== null ? 'FINISHED' : CAUSE_LABEL[r.result.cause!].toUpperCase(), W / 2, 60, 30, r.result.time !== null ? COL.good : COL.bad, 'center')
      if (rival) hudText('TO BEAT ' + rival.time.toFixed(2), 16, 104, 16, COL.tele)
    } else {
      fit(cam, false)
      withCamera(ctx, cam, () => {
        if (!built.problem) drawTrack(ctx, built.track)
        else {
          // a road that cannot be driven is drawn as a red band, so the trouble spot can still be seen and pulled apart
          const c = built.track.centerline
          ctx.beginPath()
          c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
          ctx.closePath()
          ctx.lineJoin = 'round'
          ctx.strokeStyle = 'rgba(216, 38, 28, 0.55)'
          ctx.lineWidth = HALF_WIDTH * 2
          ctx.stroke()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 4
          ctx.setLineDash([24, 24])
          ctx.stroke()
          ctx.setLineDash([])
        }
        // the points: the same size on screen whatever the zoom, the start line in flag yellow
        const size = 9 / cam.zoom
        control.forEach((p, i) => {
          ctx.beginPath()
          ctx.arc(p.x, p.y, i === dragging ? size * 1.4 : size, 0, Math.PI * 2)
          ctx.fillStyle = i === 0 ? '#ffd21f' : '#fff'
          ctx.fill()
          ctx.lineWidth = 3 / cam.zoom
          ctx.strokeStyle = '#16181a'
          ctx.stroke()
        })
      })
      hudText('YOUR TRACK', 16, 38, 26)
      hudText(built.problem ? 'CANNOT BE DRIVEN YET' : ready, 16, 58, 14, built.problem ? COL.bad : COL.accent)
      hudText('DRAG A POINT TO BEND THE ROAD · YELLOW IS THE START', W - 16, H - 16, 13, COL.muted, 'right')
    }
    d.setStrip([
      ['Lap', f ? km(f.length).replace(' km', '<small> km</small>') : '–'],
      ['Tight bends', f ? String(f.hairpins) : '–'],
      ['Your best', best !== null ? best.toFixed(2) + '<small> s</small>' : '–'],
      ['To beat', rival ? rival.time.toFixed(2) + '<small> s</small>' : '–'],
    ])
  }

  // A track from a link (#track=<points>, with &t=<lap>&by=<car> when the sender had raced it). False if it cannot be read.
  function load(hash: string): boolean {
    const [code, ...rest] = hash.slice(TRACK_PREFIX.length).split('&')
    const pts = decode(code)
    if (!pts) return false
    control = pts
    changed()
    const extra = new Map(rest.map((kv) => kv.split('=') as [string, string]))
    const t = Number(extra.get('t'))
    let by = ''
    try {
      by = decodeURIComponent(extra.get('by') ?? '').slice(0, 40)
    } catch {
      /* a mangled name: the lap still counts */
    }
    if (Number.isFinite(t) && t > 0 && t < 200) rival = { time: t, by }
    render()
    return true
  }
  // The link for this track, and the words to send with it
  function share(base: string): { link: string; text: string } | null {
    if (built.problem) return null
    const name = run?.name ?? d.getCar()?.name ?? ''
    const link = base + TRACK_PREFIX + encode(control) + (best !== null ? '&t=' + best.toFixed(2) + '&by=' + encodeURIComponent(name) : '')
    const text = best !== null ? 'CRASHLAB · I built a track. "' + name + '" lapped it in ' + best.toFixed(2) + ' s. Can your car beat that?\n' + link : 'CRASHLAB · I built a track. Can your car get round it?\n' + link
    return { link, text }
  }
  // The drawing as text for a build to practise on (null while it cannot be driven). It is saved too, so the Garage's
  // tile shows this very shape even when no point has been moved from the oval a new track starts as.
  function code(): string | null {
    if (built.problem) return null
    const text = encode(control)
    try {
      localStorage.setItem(KEY, text)
    } catch {
      /* storage blocked: the build still gets the track */
    }
    return text
  }
  // For the Garage, which draws the same track on its own screen: what is wrong with the drawing in plain words (null
  // when it can be driven), whether a point can be added or removed, and a way to put a finished lap away
  const state = () => ({ problem: built.problem ? plain(built.problem) : null, points: control.length, canAdd: control.length < MAX_POINTS, canRemove: control.length > MIN_POINTS })
  const stopRun = () => {
    if (!run) return
    run = null
    fit(d.cam, true)
    render()
  }
  return { draw, tick, render, load, share, code, state, stopRun }
}
