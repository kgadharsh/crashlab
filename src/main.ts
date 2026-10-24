import { castRay, type Point, type Segment } from './sensors'
import { starterBrain, think } from './brain'
import { drawNetwork } from './netview'

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

// ---------- THE TRACK ----------
const POINTS = 120
const HALF_WIDTH = 45

const centerline: Point[] = []
for (let i = 0; i < POINTS; i++) {
  const t = (i / POINTS) * Math.PI * 2
  centerline.push({
    x: 400 + (270 + 15 * Math.cos(2 * t)) * Math.cos(t),
    y: 250 + (160 + 15 * Math.sin(3 * t)) * Math.sin(t),
  })
}

const leftWall: Point[] = []
const rightWall: Point[] = []
for (let i = 0; i < POINTS; i++) {
  const before = centerline[(i + POINTS - 1) % POINTS]
  const after = centerline[(i + 1) % POINTS]
  let tx = after.x - before.x
  let ty = after.y - before.y
  const len = Math.hypot(tx, ty)
  tx /= len
  ty /= len
  const nx = -ty
  const ny = tx
  const c = centerline[i]
  leftWall.push({ x: c.x + nx * HALF_WIDTH, y: c.y + ny * HALF_WIDTH })
  rightWall.push({ x: c.x - nx * HALF_WIDTH, y: c.y - ny * HALF_WIDTH })
}

function loopToSegments(loop: Point[]): Segment[] {
  return loop.map((p, i) => ({ a: p, b: loop[(i + 1) % loop.length] }))
}
const walls: Segment[] = [...loopToSegments(leftWall), ...loopToSegments(rightWall)]

function distToSegment(px: number, py: number, s: Segment): number {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - s.a.x) * dx + (py - s.a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (s.a.x + t * dx), py - (s.a.y + t * dy))
}

// ---------- THE CAR ----------
const START = {
  x: centerline[0].x,
  y: centerline[0].y,
  angle: Math.atan2(
    centerline[1].y - centerline[POINTS - 1].y,
    centerline[1].x - centerline[POINTS - 1].x,
  ),
}
const car = { x: START.x, y: START.y, angle: START.angle, speed: 0 }
const CAR_RADIUS = 12

const ACCEL = 0.15
const FRICTION = 0.98
const MAX_SPEED = 6
const MAX_REVERSE = -2
const TURN_RATE = 0.008

let crashes = 0

// ---------- PROGRESS (fitness score) ----------
const CHECKPOINT_STRIDE = 6
const CHECKPOINTS = POINTS / CHECKPOINT_STRIDE
const CHECKPOINT_RADIUS = 50
let passed = 0
let best = 0

function checkpointPos(k: number): Point {
  return centerline[(k % CHECKPOINTS) * CHECKPOINT_STRIDE]
}

function updateProgress() {
  for (let k = 0; k < CHECKPOINTS; k++) {
    const target = checkpointPos(passed + 1)
    if (Math.hypot(car.x - target.x, car.y - target.y) > CHECKPOINT_RADIUS) break
    passed++
  }
  if (passed > best) best = passed
}

// ---------- THE CAR'S EYES (RAYS) ----------
const RAY_ANGLES = [-60, -30, 0, 30, 60].map((deg) => (deg * Math.PI) / 180)
const RAY_RANGE = 200
let rayDistances: number[] = RAY_ANGLES.map(() => RAY_RANGE)

function updateRays() {
  rayDistances = RAY_ANGLES.map((a) =>
    castRay(car.x, car.y, car.angle + a, RAY_RANGE, walls),
  )
}

// ---------- THE BRAIN ----------
const brain = starterBrain()
let brainOn = false

// What the brain sees: 5 ray distances (0 to 1) and the speed (about -0.3 to 1)
function getInputs(): number[] {
  return [...rayDistances.map((d) => d / RAY_RANGE), car.speed / MAX_SPEED]
}

function brainInput(): Input {
  const { outputs } = think(brain, getInputs())
  return { steer: outputs[0], throttle: outputs[1] }
}

// ---------- RECORDING AND REPLAY ----------
type Input = { throttle: number; steer: number }

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

function hitsWall(): boolean {
  for (const w of walls) {
    if (distToSegment(car.x, car.y, w) < CAR_RADIUS) return true
  }
  return false
}

function resetCar() {
  car.x = START.x
  car.y = START.y
  car.angle = START.angle
  car.speed = 0
  passed = 0
}

function update(input: Input) {
  car.speed += input.throttle * ACCEL
  car.speed *= FRICTION
  if (car.speed > MAX_SPEED) car.speed = MAX_SPEED
  if (car.speed < MAX_REVERSE) car.speed = MAX_REVERSE

  car.angle += input.steer * TURN_RATE * car.speed

  car.x += Math.cos(car.angle) * car.speed
  car.y += Math.sin(car.angle) * car.speed

  if (hitsWall()) {
    crashes++
    resetCar()
  }

  updateProgress()
  updateRays()
}

function startFreshRecording() {
  recording = []
  mode = 'live'
  resetCar()
  crashes = 0
  best = 0
  message = 'New recording started.'
}

function startReplay() {
  if (recording.length === 0 || mode === 'replay') return
  savedEnd = { x: car.x, y: car.y, angle: car.angle, speed: car.speed, crashes, passed, best }
  resetCar()
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
        passed === savedEnd.passed &&
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
    const p = checkpointPos(k)
    const isNext = k === (passed + 1) % CHECKPOINTS
    ctx.fillStyle = isNext ? 'cyan' : 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, isNext ? 7 : 3, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let i = 0; i < RAY_ANGLES.length; i++) {
    const a = car.angle + RAY_ANGLES[i]
    const d = rayDistances[i]
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
  ctx.fillText('rays: ' + rayDistances.map((d) => Math.round(d)).join(', '), 10, 90)
  ctx.fillText(
    'checkpoints: ' + passed + '   laps: ' + Math.floor(passed / CHECKPOINTS) + '   best: ' + best,
    10,
    112,
  )
  ctx.fillText(message, 10, 490)

  // The brain panel
  const inputs = getInputs()
  drawNetwork(
    netCtx,
    brain,
    inputs,
    think(brain, inputs),
    brainOn ? 'The brain (driving)' : 'The brain (watching you)',
  )
}

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