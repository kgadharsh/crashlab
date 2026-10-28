import type { Point } from './sensors'
import { starterBrain, think, type Brain } from './brain'
import type { History } from './train'
import { genomeToBrain } from './genome'
import { drawNetwork } from './netview'
import {
  type Car,
  type Input,
  createCar,
  step,
  getInputs,
  checkpointPos,
  CHECKPOINTS,
  RAY_ANGLES,
  DEFAULT_TRACK,
  runBrain,
  lapSteps,
  USE_GRIP,
  STALL_STEPS,
} from './sim'
import { makeTrack } from './track'

// Two canvases side by side (they stack on narrow screens)
const wrapper = document.createElement('div')
wrapper.style.display = 'flex'
wrapper.style.flexWrap = 'wrap'
wrapper.style.gap = '12px'
document.body.appendChild(wrapper)

// ---------- MISSION BAR ----------
const missionBar = document.createElement('div')
missionBar.style.cssText =
  'max-width:1240px;min-height:104px;box-sizing:border-box;margin:0 0 12px;padding:10px 14px;border:2px solid black;border-radius:6px;background:#fffbe6;font:16px/1.4 sans-serif'
document.body.insertBefore(missionBar, wrapper)
type MissionStage = 'm1' | 'm1done' | 'm2' | 'm2done' | 'm3' | 'm3done'
let missionStage: MissionStage = 'm1'
let lastMissionHtml = ''
function setMissionHtml(html: string) {
  if (html === lastMissionHtml) return
  lastMissionHtml = html
  missionBar.innerHTML = html
}

const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
wrapper.appendChild(canvas)
const ctx = canvas.getContext('2d')!

const netCanvas = document.createElement('canvas')
netCanvas.width = 420
netCanvas.height = 500
netCanvas.style.border = '2px solid black'
wrapper.appendChild(netCanvas)
const netCtx = netCanvas.getContext('2d')!

// ---------- GAME STATE (the simulation itself lives in sim.ts) ----------
const track = DEFAULT_TRACK // the road being driven and drawn
const { leftWall, rightWall } = track
let car: Car = createCar(undefined, USE_GRIP)
let crashes = 0
let best = 0

let brain: Brain = starterBrain()
let brainOn = false

function brainInput(): Input {
  const { outputs } = think(brain, getInputs(car))
  return { steer: outputs[0], throttle: outputs[1] }
}

// ---------- RECORDING AND REPLAY ----------
let recording: Input[] = []
let mode: 'live' | 'replay' = 'live'
let replayIndex = 0
let savedEnd = { x: 0, y: 0, angle: 0, speed: 0, crashes: 0, passed: 0, best: 0 }
let message = 'Arrows = drive.  B = brain drives.  R = replay.  Enter = new recording.'

let showCheckpoints = false // press C to show the invisible checkpoints the score is built on
const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
  if (e.key === 'r' || e.key === 'R') startReplay()
  if (e.key === 'Enter') startFreshRecording()
  if (e.key === 'b' || e.key === 'B') brainOn = !brainOn
  if (e.key === 'c' || e.key === 'C') showCheckpoints = !showCheckpoints
})
window.addEventListener('keyup', (e) => {
  keys[e.key] = false
})

function readKeys(): Input {
  return {
    throttle: (keys['ArrowUp'] ? 1 : 0) - (keys['ArrowDown'] ? 1 : 0),
    steer: (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0),
  }
}

// One step of the game. In the game a crash sends you back to the start;
// (evolution will treat a crash as the end of that car instead).
let lapSeconds = 0
let lapAttempts = 0

function update(input: Input) {
  step(car, input)
  if (car.passed > best) best = car.passed
  if (mode === 'live' && !car.dead && car.passed >= CHECKPOINTS) {
    const lapDone = () => {
      lapSeconds = car.steps / 60
      lapAttempts = crashes + 1
    }
    if (missionStage === 'm1' && !brainOn) {
      lapDone()
      setStage('m1done')
    } else if (missionStage === 'm2' && brainOn) {
      lapDone()
      setStage('m2done')
    } else if (missionStage === 'm3' && brainOn && trained && brain === trained) {
      lapDone()
      m3Score = scoreBrain(trained)
      setStage('m3done')
    }
  }
  if (car.dead) {
    crashes++
    car = createCar(undefined, USE_GRIP)
  }
}

function startFreshRecording() {
  recording = []
  mode = 'live'
  car = createCar(undefined, USE_GRIP)
  crashes = 0
  best = 0
  message = 'New recording started.'
}

function startReplay() {
  if (recording.length === 0 || mode === 'replay') return
  savedEnd = {
    x: car.x,
    y: car.y,
    angle: car.angle,
    speed: car.speed,
    crashes,
    passed: car.passed,
    best,
  }
  car = createCar(undefined, USE_GRIP)
  crashes = 0
  best = 0
  replayIndex = 0
  mode = 'replay'
  message = 'Replaying...'
}

function tick() {
  if (mode === 'live') {
    const input = brainOn ? brainInput() : readKeys()
    recording.push(input)
    update(input)
  } else {
    update(recording[replayIndex])
    replayIndex++
    if (replayIndex >= recording.length) {
      const same =
        car.x === savedEnd.x &&
        car.y === savedEnd.y &&
        car.angle === savedEnd.angle &&
        car.speed === savedEnd.speed &&
        crashes === savedEnd.crashes &&
        car.passed === savedEnd.passed &&
        best === savedEnd.best
      message = same
        ? 'REPLAY MATCH: identical result. Physics is deterministic!'
        : 'MISMATCH: the replay ended somewhere different.'
      mode = 'live'
    }
  }
}

// ---------- DRAWING ----------
function tracePath(loop: Point[]) {
  ctx.moveTo(loop[0].x, loop[0].y)
  for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y)
  ctx.closePath()
}

// Small arrows along the road show which way the lap goes, and a label marks the start line
function drawDirectionArrows() {
  const c = track.centerline
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 5; i < c.length; i += 10) {
    const before = c[(i + c.length - 1) % c.length]
    const after = c[(i + 1) % c.length]
    const a = Math.atan2(after.y - before.y, after.x - before.x)
    const tipX = c[i].x + Math.cos(a) * 7
    const tipY = c[i].y + Math.sin(a) * 7
    ctx.beginPath()
    ctx.moveTo(tipX - Math.cos(a - 0.7) * 12, tipY - Math.sin(a - 0.7) * 12)
    ctx.lineTo(tipX, tipY)
    ctx.lineTo(tipX - Math.cos(a + 0.7) * 12, tipY - Math.sin(a + 0.7) * 12)
    ctx.stroke()
  }
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  ctx.fillStyle = 'white'
  ctx.font = 'bold 12px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('START', (leftWall[0].x + rightWall[0].x) / 2, leftWall[0].y - 4)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function draw() {
  ctx.fillStyle = '#9c9'
  ctx.fillRect(0, 0, 800, 500)

  ctx.beginPath()
  tracePath(leftWall)
  tracePath(rightWall)
  ctx.fillStyle = '#555'
  ctx.fill('evenodd')

  ctx.strokeStyle = 'black'
  ctx.lineWidth = 3
  ctx.beginPath()
  tracePath(leftWall)
  ctx.stroke()
  ctx.beginPath()
  tracePath(rightWall)
  ctx.stroke()

  ctx.strokeStyle = 'white'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(leftWall[0].x, leftWall[0].y)
  ctx.lineTo(rightWall[0].x, rightWall[0].y)
  ctx.stroke()

  drawDirectionArrows()
  if (showCheckpoints) {
  for (let k = 0; k < CHECKPOINTS; k++) {
    const p = checkpointPos(track, k)
    const isNext = k === (car.passed + 1) % CHECKPOINTS
    ctx.fillStyle = isNext ? 'cyan' : 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, isNext ? 7 : 3, 0, Math.PI * 2)
    ctx.fill()
  }
  }

  if (swarm) drawSwarm()
  else {
  for (let i = 0; i < RAY_ANGLES.length; i++) {
    const a = car.angle + RAY_ANGLES[i]
    const d = car.rays[i]
    const hitX = car.x + Math.cos(a) * d
    const hitY = car.y + Math.sin(a) * d
    ctx.strokeStyle = 'yellow'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(car.x, car.y)
    ctx.lineTo(hitX, hitY)
    ctx.stroke()
    ctx.fillStyle = 'yellow'
    ctx.beginPath()
    ctx.arc(hitX, hitY, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.rotate(car.angle)
  ctx.fillStyle = mode === 'replay' ? 'royalblue' : 'red'
  ctx.fillRect(-15, -8, 30, 16)
  ctx.fillStyle = 'white'
  ctx.fillRect(8, -6, 6, 12)
  ctx.restore()
  }

  ctx.fillStyle = 'black'
  ctx.font = '16px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (swarm) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(6, 6, 250, 50)
    ctx.fillStyle = 'black'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText('Generation ' + (swarm.gen + 1), 14, 26)
    ctx.font = '14px sans-serif'
    ctx.fillText('best car: ' + (Math.max(...swarm.cars.map((c) => c.passed)) / CHECKPOINTS).toFixed(1) + ' laps so far', 14, 46)
    drawSwarmLegend()
    // the caption sits at the bottom, on a pale strip so it can be read
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillRect(0, 462, 800, 38)
    ctx.fillStyle = 'black'
    ctx.font = '15px sans-serif'
    ctx.fillText(swarmCaption(swarm), 10, 478)
    ctx.font = '12px sans-serif'
    ctx.fillStyle = '#444'
    ctx.fillText(message, 10, 494)
  } else {
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('mode: ' + mode + '   driver: ' + (brainOn ? 'BRAIN' : 'you'), 10, 24)
  ctx.fillText('crashes: ' + crashes, 10, 46)
  ctx.fillText('recorded steps: ' + recording.length, 10, 68)
  ctx.fillText('rays: ' + car.rays.map((d) => Math.round(d)).join(', '), 10, 90)
  ctx.fillText(
    'checkpoints: ' +
      car.passed +
      '   lap: ' +
      (Math.floor(car.passed / CHECKPOINTS) + 1) +
      '   in lap: ' +
      (car.passed % CHECKPOINTS) +
      '/' +
      CHECKPOINTS +
      '   best: ' +
      best,
    10,
    112,
  )
  ctx.fillText(message, 10, 490)
  }

  // Mission text, and (when you drive) what you are doing expressed as numbers
  setMissionHtml(missionHtml())
  if (!brainOn && mode === 'live' && !swarm) {
    const now = readKeys()
    const steer = now.steer < 0 ? 'left' : now.steer > 0 ? 'right' : 'straight'
    const gas = now.throttle > 0 ? 'gas' : now.throttle < 0 ? 'brake' : 'coast'
    ctx.fillStyle = '#7a5c00'
    ctx.fillText(
      'You see: ' + car.rays.map((d) => Math.round(d)).join(' ') + ' | speed ' + car.speed.toFixed(1) +
        '    You do: steer ' + steer + ', ' + gas,
      10,
      468,
    )
  }

  // The brain panel
  if (swarm) {
    const lead = swarm.cars[0]
    const inputs = getInputs(lead)
    drawNetwork(netCtx, swarm.brains[0], inputs, think(swarm.brains[0], inputs), 'Best car of generation ' + (swarm.gen + 1))
    return
  }
  const inputs = getInputs(car)
  drawNetwork(
    netCtx,
    brain,
    inputs,
    think(brain, inputs),
    brainOn ? 'The brain (driving)' : 'The brain (watching you)',
  )
}


// ---------- BUTTONS: TRAIN, THEN WATCH ----------
const buttons = document.createElement('div')
buttons.style.margin = '12px 0'
document.body.appendChild(buttons)

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.style.marginRight = '8px'
  b.style.padding = '6px 12px'
  b.addEventListener('click', () => {
    b.blur() // so Enter and arrow keys keep controlling the car
    onClick()
  })
  buttons.appendChild(b)
  return b
}

// Hand a brain to the car and let it drive from the start
function watch(b: Brain, text: string) {
  brain = b
  startFreshRecording()
  brainOn = true
  message = text
}

let trained: Brain | null = null
let seed = 1
const GENERATIONS = 40
let worker: Worker | null = null
let watchAll = true // watch every generation (slower) instead of only the newest one

type Finish = { genome: number[]; checkpoints: number; generations: number }
type Run = { seed: number; history: History; shown: number; watching: boolean; finish: Finish | null }
let run: Run | null = null

function showGraph() {
  if (run) drawGraph(run.history.slice(0, run.shown), run.seed, GENERATIONS)
}

function stopTraining(text: string) {
  worker?.terminate()
  worker = null
  run = null
  swarm = null
  waiting = null
  trainButton.textContent = 'Train a new brain'
  skipButton.style.display = 'none'
  message = text
}

// Everything has been shown: hand the winning brain to the car
function finishTraining(f: Finish) {
  const r = run!
  trained = genomeToBrain(f.genome)
  if (f.generations < GENERATIONS) drawGraph(r.history, r.seed, f.generations) // stopped early: fit the graph
  const used = r.seed
  stopTraining('')
  watch(trained, 'Trained (seed ' + used + '): ' + f.checkpoints + ' checkpoints. Watch it drive!')
  seed++
}

// Training runs in a background worker, so the page keeps working and the graph fills in live
const trainButton = makeButton('Train a new brain', () => {
  if (worker) {
    stopTraining('Training stopped.')
    return
  }
  run = { seed, history: [], shown: 0, watching: watchAll, finish: null }
  showGraph()
  trainButton.textContent = 'Stop training'
  skipButton.style.display = watchAll ? '' : 'none'
  message = 'Training (seed ' + run.seed + ')...'

  worker = new Worker(new URL('./trainWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data
    if (!run) return
    if (m.type === 'progress') {
      run.history.push({ best: m.best, mean: m.mean })
      waiting = { gen: m.generation, genomes: m.population }
      if (!run.watching) {
        run.shown = run.history.length
        showGraph()
      }
      if (!run.watching) message = 'Training (seed ' + run.seed + '): generation ' + (m.generation + 1) + ' of up to ' + GENERATIONS + ', best so far ' + m.checkpoints + ' checkpoints'
    } else if (m.type === 'done') {
      run.finish = { genome: m.genome, checkpoints: m.checkpoints, generations: m.generations }
      if (!run.watching) finishTraining(run.finish)
    }
  }
  worker.onerror = () => stopTraining('Training failed. Check the console for the error.')
  worker.postMessage({ type: 'start', seed: run.seed, generations: GENERATIONS, watch: watchAll })
})

const skipButton = makeButton('Skip to the end', () => {
  if (!worker || !run || !run.watching) return
  run.watching = false
  skipButton.style.display = 'none'
  worker.postMessage({ type: 'free' })
  if (run.finish) finishTraining(run.finish)
})
skipButton.style.display = 'none'

const watchButton = makeButton('Watch every generation: ON', () => {
  watchAll = !watchAll
  watchButton.textContent = 'Watch every generation: ' + (watchAll ? 'ON' : 'OFF')
})

makeButton('Watch the trained brain', () => {
  if (trained) watch(trained, 'Watching the trained brain.')
  else message = 'Nothing trained yet. Press "Train a new brain" first.'
})

makeButton('Back to the starter brain', () => watch(starterBrain(), 'The hand-written starter brain.'))

// ---------- THE LEARNING GRAPH ----------
const graphCanvas = document.createElement('canvas')
graphCanvas.width = 800
graphCanvas.height = 240
graphCanvas.style.border = '2px solid black'
graphCanvas.style.display = 'block'
document.body.appendChild(graphCanvas)
const gctx = graphCanvas.getContext('2d')!

const BEST_COLOR = '#0a7'
const MEAN_COLOR = '#c60'

// One dot-and-line series on the graph
function plotSeries(values: number[], color: string, x: (i: number) => number, y: (v: number) => number) {
  gctx.strokeStyle = color
  gctx.lineWidth = 2.5
  gctx.beginPath()
  values.forEach((v, i) => (i === 0 ? gctx.moveTo(x(i), y(v)) : gctx.lineTo(x(i), y(v))))
  gctx.stroke()
}

function drawGraph(history: History | null, seedUsed = 0, totalGenerations = 40) {
  const W = graphCanvas.width
  const H = graphCanvas.height
  const left = 52
  const right = W - 20
  const top = 34
  const bottom = H - 36
  const maxY = 70 // a bit above the ~60 checkpoints a trained car reaches in 20 seconds with grip
  const generations = Math.max(totalGenerations, 2)
  const x = (i: number) => left + (i / (generations - 1)) * (right - left)
  const y = (v: number) => bottom - (v / maxY) * (bottom - top)

  gctx.fillStyle = '#fff'
  gctx.fillRect(0, 0, W, H)

  // grid and y labels
  gctx.font = '12px sans-serif'
  gctx.textBaseline = 'middle'
  gctx.textAlign = 'right'
  for (let v = 0; v <= 60; v += 20) {
    gctx.strokeStyle = '#e3e3e3'
    gctx.lineWidth = 1
    gctx.beginPath()
    gctx.moveTo(left, y(v))
    gctx.lineTo(right, y(v))
    gctx.stroke()
    gctx.fillStyle = '#555'
    gctx.fillText(String(v), left - 8, y(v))
  }
  // x labels
  gctx.textAlign = 'center'
  gctx.textBaseline = 'top'
  for (let g = 0; g < generations; g += 10) {
    gctx.fillStyle = '#555'
    gctx.fillText(String(g + 1), x(g), bottom + 8)
  }
  gctx.fillText('generation', (left + right) / 2, bottom + 20)

  // title
  gctx.textAlign = 'left'
  gctx.textBaseline = 'alphabetic'
  gctx.fillStyle = '#111'
  gctx.font = 'bold 14px sans-serif'
  gctx.fillText(
    history ? 'Learning curve (seed ' + seedUsed + '): checkpoints collected' : 'Learning curve',
    left,
    20,
  )

  if (!history) {
    gctx.fillStyle = '#777'
    gctx.font = '14px sans-serif'
    gctx.textAlign = 'center'
    gctx.fillText('Press "Train a new brain" and the curve appears here.', (left + right) / 2, (top + bottom) / 2)
    return
  }

  if (history.length === 0) return

  plotSeries(history.map((h) => h.mean), MEAN_COLOR, x, y)
  plotSeries(history.map((h) => h.best), BEST_COLOR, x, y)

  // direct labels at the right end of each line
  const last = history[history.length - 1]
  gctx.font = '12px sans-serif'
  gctx.textAlign = 'right'
  gctx.textBaseline = 'bottom'
  gctx.fillStyle = BEST_COLOR
  gctx.fillText('best car: ' + Math.round(last.best), right, y(last.best) - 6)
  gctx.textBaseline = 'top'
  gctx.fillStyle = MEAN_COLOR
  gctx.fillText('average car: ' + Math.round(last.mean), right, y(last.mean) + 6)
}
drawGraph(null)

// ---------- THE SWARM: all 100 cars of a generation, driving at once ----------
type Swarm = {
  gen: number
  cars: Car[]
  brains: Brain[]
  done: boolean[]
  holdFrames: number
  trails: { x: number; y: number }[][] // recent positions of each car
}
let swarm: Swarm | null = null
let waiting: { gen: number; genomes: number[][] } | null = null // newest generation not shown yet
const VIEW_STEPS = 600 // each generation is shown for 10 seconds of driving (about 2 laps)

function makeSwarm(gen: number, genomes: number[][]): Swarm {
  const brains = genomes.map(genomeToBrain)
  const cars = brains.map(() => createCar(undefined, USE_GRIP))
  return {
    gen,
    cars,
    brains,
    done: brains.map(() => false),
    holdFrames: 0,
    trails: cars.map((c) => [{ x: c.x, y: c.y }]),
  }
}

function stepSwarm() {
  if (!worker || !run) return
  const finished = swarm !== null && swarm.done.every(Boolean)
  if (swarm && finished) {
    swarm.holdFrames++ // linger a moment so the end of the generation can be seen
    if (swarm.holdFrames < 20) return
  }
  if (!swarm || finished) {
    if (waiting) {
      swarm = makeSwarm(waiting.gen, waiting.genomes)
      waiting = null
      if (run.watching) {
        run.shown = swarm.gen + 1 // the graph follows what you are watching
        showGraph()
        message = 'Training (seed ' + run.seed + '): generation ' + (swarm.gen + 1) + ' of up to ' + GENERATIONS + '. Each generation is shown for 10 s of driving.'
        if (!run.finish) worker.postMessage({ type: 'next' }) // compute the next one while this plays
      }
    } else if (run.watching && run.finish) {
      finishTraining(run.finish) // the last generation has been watched
      return
    }
  }
  if (!swarm) return
  // the fewer cars are left, the faster time runs (so the work per frame stays about the same)
  const alive = swarm.done.filter((d) => !d).length
  const stepsPerFrame = Math.min(12, Math.max(6, Math.round(600 / Math.max(alive, 1))))
  for (let k = 0; k < stepsPerFrame; k++) {
    swarm.cars.forEach((c, i) => {
      if (swarm!.done[i]) return
      const { outputs } = think(swarm!.brains[i], getInputs(c))
      step(c, { steer: outputs[0], throttle: outputs[1] })
      const trail = swarm!.trails[i]
      trail.push({ x: c.x, y: c.y })
      if (trail.length > 40) trail.shift()
      if (c.dead || c.steps >= VIEW_STEPS || c.sinceProgress >= STALL_STEPS) swarm!.done[i] = true
    })
  }
}

// Which bend of the track a position is on, in plain words
function regionOf(x: number, y: number): string {
  return (y < 250 ? 'top' : 'bottom') + '-' + (x < 400 ? 'left' : 'right')
}

// One sentence about how this generation is going, written from what the cars are doing
function swarmCaption(sw: Swarm): string {
  const crashed = sw.cars.filter((c) => c.dead)
  const lasting = sw.cars.length - crashed.length
  const counts: Record<string, number> = {}
  crashed.forEach((c) => {
    const r = regionOf(c.x, c.y)
    counts[r] = (counts[r] ?? 0) + 1
  })
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const hotspot = crashed.length >= 8 && top && top[1] >= crashed.length * 0.4 ? ' Most crashes: ' + top[0] + ' bend.' : ''
  if (sw.done.every(Boolean)) {
    // a car that neither crashed nor reached 10 seconds was stuck, going nowhere
    const lasted = sw.cars.filter((c) => !c.dead && c.steps >= VIEW_STEPS).length
    const stuck = lasting - lasted
    const parts = [lasted + ' of ' + sw.cars.length + ' lasted the full 10 seconds']
    if (stuck > 0) parts.push(stuck + ' got stuck')
    return parts.join(', ') + '.' + hotspot
  }
  return crashed.length + ' crashed so far, ' + lasting + ' still driving.' + hotspot
}

function drawCarShape(c: Car, length: number, width: number, body: string) {
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(c.angle)
  ctx.fillStyle = body
  ctx.fillRect(-length / 2, -width / 2, length, width)
  ctx.fillStyle = 'rgba(255,255,255,0.9)' // the windscreen marks the front
  ctx.fillRect(length / 2 - length * 0.35, -width / 2 + 2, length * 0.22, width - 4)
  ctx.restore()
}

function drawSwarm() {
  if (!swarm) return
  // fading trails show where each car has been
  swarm.trails.forEach((trail, i) => {
    if (trail.length < 2) return
    const best = i === 0
    ctx.strokeStyle = best ? 'rgba(255,60,60,0.7)' : 'rgba(120,170,255,0.28)'
    ctx.lineWidth = best ? 3 : 2
    ctx.beginPath()
    ctx.moveTo(trail[0].x, trail[0].y)
    for (let k = 1; k < trail.length; k++) ctx.lineTo(trail[k].x, trail[k].y)
    ctx.stroke()
  })
  // a cross marks every crash and stays for the whole generation
  swarm.cars.forEach((c) => {
    if (!c.dead) return
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(c.x - 5, c.y - 5)
    ctx.lineTo(c.x + 5, c.y + 5)
    ctx.moveTo(c.x + 5, c.y - 5)
    ctx.lineTo(c.x - 5, c.y + 5)
    ctx.stroke()
    ctx.strokeStyle = '#c4001f'
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.lineCap = 'butt'
  })
  // cars still driving; the best car of the generation is drawn last, in red, on top
  for (let i = swarm.cars.length - 1; i >= 0; i--) {
    const c = swarm.cars[i]
    if (c.dead) continue
    drawCarShape(c, i === 0 ? 26 : 20, i === 0 ? 14 : 11, i === 0 ? '#e01020' : 'rgba(40,100,230,0.8)')
  }
}

// A key to the picture, in the corner of the track
function drawSwarmLegend() {
  const x = 556
  const y = 16 // top-right corner: the track never reaches it
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.fillRect(x - 8, y - 8, 246, 80)
  ctx.font = '13px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#111'
  drawCarShape({ x: x + 14, y: y + 8, angle: 0 } as Car, 22, 12, '#e01020')
  ctx.fillStyle = '#111'
  ctx.fillText('best car of this generation', x + 36, y + 8)
  drawCarShape({ x: x + 14, y: y + 30, angle: 0 } as Car, 18, 10, 'rgba(40,100,230,0.8)')
  ctx.fillStyle = '#111'
  ctx.fillText('the other 99 cars', x + 36, y + 30)
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#c4001f'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x + 8, y + 46)
  ctx.lineTo(x + 20, y + 58)
  ctx.moveTo(x + 20, y + 46)
  ctx.lineTo(x + 8, y + 58)
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.fillStyle = '#111'
  ctx.fillText('a car crashed here', x + 36, y + 52)
  ctx.textBaseline = 'alphabetic'
}

// ---------- MISSIONS ----------
const BTN = 'margin-left:8px;padding:4px 10px'
const MISSION_TRACKS = Array.from({ length: 10 }, (_, i) => makeTrack(9000 + i, 1))

type Score = { lap: number | null; reached: number; unseen: number }
// How a brain does: a lap on the practice track, and laps on 10 tracks it has never seen
function scoreBrain(b: Brain): Score {
  const lap = lapSteps(b, DEFAULT_TRACK, USE_GRIP)
  return {
    lap: lap === null ? null : lap / 60,
    reached: runBrain(b, undefined, undefined, USE_GRIP).checkpoints,
    unseen: MISSION_TRACKS.filter((t) => lapSteps(b, t, USE_GRIP) !== null).length,
  }
}
function describe(sc: Score): string {
  return (
    (sc.lap !== null ? 'a lap in <b>' + sc.lap.toFixed(1) + ' s</b>' : 'no lap yet (' + Math.round((100 * sc.reached) / CHECKPOINTS) + '% of the way round)') +
    ' on the practice track, and a lap on <b>' + sc.unseen + ' of 10</b> unseen tracks'
  )
}

let m3Score: Score | null = null
let m2Score: Score | null = null

// Mission 2's brain: the parts that look at the road are pre-wired; you set three connections
const m2 = { steer: 0, wall: 0, speed: 0 }
function missionBrain(): Brain {
  const K = 3
  return {
    w1: [
      [-K, -K, 0, K, K, 0], // neuron 0: is the right side more open than the left?
      [0, 0, -3, 0, 0, 0], // neuron 1: is a wall close ahead?
      [0, 0, 0, 0, 0, 3], // neuron 2: how fast am I going?
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    b1: [0, 1.5, 0, 0, 0],
    w2: [
      [m2.steer, 0, 0, 0, 0], // steering follows neuron 0, as strongly as you choose
      [0, -m2.wall, -m2.speed, 0, 0], // gas: ease off for a wall ahead, and for high speed
    ],
    b2: [0, 1.2], // a steady urge to accelerate
  }
}

const m2Panel = document.createElement('div')
m2Panel.style.cssText =
  'max-width:1240px;box-sizing:border-box;margin:0 0 12px;padding:10px 14px;border:2px solid black;border-radius:6px;background:#eef6ff;font:15px/1.5 sans-serif;display:none'
document.body.insertBefore(m2Panel, wrapper)
const m2Result = document.createElement('div')
m2Result.style.marginTop = '6px'

function addSlider(label: string, key: 'steer' | 'wall' | 'speed', min: number, max: number) {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap'
  const text = document.createElement('span')
  text.textContent = label
  text.style.cssText = 'width:430px;max-width:100%'
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = '0.1'
  input.value = '0'
  input.style.width = '260px'
  const value = document.createElement('b')
  value.textContent = '0.0'
  value.style.width = '40px'
  input.addEventListener('input', () => {
    m2[key] = Number(input.value)
    value.textContent = m2[key].toFixed(1)
    scheduleM2()
  })
  input.addEventListener('change', () => input.blur()) // keep the keyboard free
  row.append(text, input, value)
  m2Panel.appendChild(row)
}
addSlider('Steer toward the more open side (negative = toward the walls!)', 'steer', -4, 4)
addSlider('Brake when a wall is close ahead', 'wall', 0, 4)
addSlider('Brake when going fast', 'speed', 0, 4)
m2Panel.appendChild(m2Result)

// Re-test the brain whenever a slider moves (several moves in one frame count once)
let m2Scheduled = false
function scheduleM2() {
  if (m2Scheduled) return
  m2Scheduled = true
  setTimeout(() => {
    m2Scheduled = false
    applyM2()
  }, 0)
}
function applyM2() {
  const b = missionBrain()
  watch(b, 'Your three weights are driving.')
  m2Score = scoreBrain(b)
  m2Result.innerHTML = 'With these weights the car makes ' + describe(m2Score) + '.'
}

function applyStageVisibility() {
  const sandbox = missionStage === 'm3' || missionStage === 'm3done'
  buttons.style.display = sandbox ? '' : 'none'
  graphCanvas.style.display = sandbox ? 'block' : 'none'
  m2Panel.style.display = missionStage === 'm2' || missionStage === 'm2done' ? 'block' : 'none'
}

function setStage(s: MissionStage) {
  missionStage = s
  applyStageVisibility()
}

const missions = {
  retry1() {
    setStage('m1')
    brainOn = false
    startFreshRecording()
    message = 'Mission 1: drive one lap.'
  },
  start2() {
    setStage('m2')
    applyM2()
  },
  start3() {
    setStage('m3')
    watch(starterBrain(), 'Press "Train a new brain".')
    brainOn = false
  },
}
;(window as unknown as { missions: typeof missions }).missions = missions

function missionHtml(): string {
  switch (missionStage) {
    case 'm1':
      return (
        '<b>Mission 1 of 3: drive one lap.</b> Arrow keys: up = gas, down = brake, left and right = steer. ' +
        'Stay off the walls. Lap progress: <b>' + Math.round((100 * car.passed) / CHECKPOINTS) + '%</b>' +
        (crashes > 0 ? ' &nbsp;·&nbsp; crashes so far: ' + crashes : '')
      )
    case 'm1done':
      return (
        '<b>Mission 1 complete!</b> One lap in <b>' + lapSeconds.toFixed(1) + ' s</b>' +
        (lapAttempts > 1 ? ' (attempt ' + lapAttempts + ')' : ' on your first attempt') + '.<br>' +
        'Look at the yellow line of numbers on the track. While you drove, the car saw <b>6 numbers</b> ' +
        '(5 ray distances and its speed) and you answered with <b>2</b> (steer and gas). ' +
        'That is exactly the job of the neural network on the right: numbers in, numbers out.' +
        '<button onclick="missions.start2()" style="' + BTN + '">Start Mission 2</button>' +
        '<button onclick="missions.retry1()" style="' + BTN + '">Drive again</button>'
      )
    case 'm2':
      return (
        '<b>Mission 2 of 3: set three weights.</b> A weight is how strongly one neuron pushes on another. ' +
        'The network on the right has 47; the parts that judge the road are already wired up. ' +
        'Move the three sliders until the car drives a lap on its own. Lap progress: <b>' + Math.round((100 * car.passed) / CHECKPOINTS) + '%</b>'
      )
    case 'm2done':
      return (
        '<b>Mission 2 complete!</b> You tuned 3 numbers by hand and the car drives itself. ' +
        'Your brain makes ' + (m2Score ? describe(m2Score) : '') + '.<br>' +
        'That was easy because only 3 of the 47 weights were yours and I wired the rest. ' +
        'A real network has thousands to billions, and nobody can tune those by hand. ' +
        'So how does a network find its own weights?' +
        '<button onclick="missions.start3()" style="' + BTN + '">Start Mission 3</button>'
      )
    case 'm3':
      return (
        '<b>Mission 3 of 3: let evolution find all 47 weights.</b> Press <b>Train a new brain</b>. ' +
        '100 cars start with random brains and nearly all crash at once. The best ones pass on their weights, ' +
        'with small random changes, and the curve below shows the whole population getting better.'
      )
    case 'm3done':
      return (
        '<b>Mission 3 complete!</b> Evolution found all 47 weights with no help: ' +
        (m3Score ? describe(m3Score) : '') + '.<br>' +
        (m2Score ? 'Your 3 hand-set weights managed ' + describe(m2Score) + '. ' : '') +
        'Press "Train a new brain" again for a different run: evolution starts from random every time, so each brain ends up different.'
      )
  }
}

applyStageVisibility()

// ---------- THE LOOP ----------
const STEP = 1000 / 60
let lastTime = performance.now()
let owed = 0

function loop(now: number) {
  owed += now - lastTime
  lastTime = now
  if (owed > 250) owed = 250

  while (owed >= STEP) {
    tick()
    owed -= STEP
  }

  stepSwarm()
  draw()
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)