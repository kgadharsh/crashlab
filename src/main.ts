import type { Point } from './sensors'
import { starterBrain, think, type Brain } from './brain'
import { trainWithHistory, type History } from './train'
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
} from './sim'

// Two canvases side by side (they stack on narrow screens)
const wrapper = document.createElement('div')
wrapper.style.display = 'flex'
wrapper.style.flexWrap = 'wrap'
wrapper.style.gap = '12px'
document.body.appendChild(wrapper)

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
let car: Car = createCar()
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

const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
  if (e.key === 'r' || e.key === 'R') startReplay()
  if (e.key === 'Enter') startFreshRecording()
  if (e.key === 'b' || e.key === 'B') brainOn = !brainOn
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
function update(input: Input) {
  step(car, input)
  if (car.passed > best) best = car.passed
  if (car.dead) {
    crashes++
    car = createCar()
  }
}

function startFreshRecording() {
  recording = []
  mode = 'live'
  car = createCar()
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
  car = createCar()
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

  for (let k = 0; k < CHECKPOINTS; k++) {
    const p = checkpointPos(track, k)
    const isNext = k === (car.passed + 1) % CHECKPOINTS
    ctx.fillStyle = isNext ? 'cyan' : 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, isNext ? 7 : 3, 0, Math.PI * 2)
    ctx.fill()
  }

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

  ctx.fillStyle = 'black'
  ctx.font = '16px sans-serif'
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

  // The brain panel
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

const trainButton = makeButton('Train a new brain', () => {
  trainButton.disabled = true
  message = 'Training... the page freezes for about 30 seconds.'
  // wait a moment so the message is drawn before the freeze starts
  setTimeout(() => {
    const { winner, history } = trainWithHistory(seed, 40)
    drawGraph(history, seed)
    trained = genomeToBrain(winner.genome)
    watch(trained, 'Trained (seed ' + seed + '): ' + winner.checkpoints + ' checkpoints. Watch it drive!')
    seed++
    trainButton.disabled = false
  }, 60)
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

function drawGraph(history: History | null, seedUsed = 0) {
  const W = graphCanvas.width
  const H = graphCanvas.height
  const left = 52
  const right = W - 20
  const top = 34
  const bottom = H - 36
  const maxY = 110 // a bit above the 105 checkpoints the track allows in 20 seconds
  const generations = Math.max(history ? history.length : 40, 2)
  const x = (i: number) => left + (i / (generations - 1)) * (right - left)
  const y = (v: number) => bottom - (v / maxY) * (bottom - top)

  gctx.fillStyle = '#fff'
  gctx.fillRect(0, 0, W, H)

  // grid and y labels
  gctx.font = '12px sans-serif'
  gctx.textBaseline = 'middle'
  gctx.textAlign = 'right'
  for (let v = 0; v <= 100; v += 25) {
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

  draw()
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)