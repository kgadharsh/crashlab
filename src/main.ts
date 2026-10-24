const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')!

// ---------- THE TRACK ----------
type Point = { x: number; y: number }
type Segment = { a: Point; b: Point }

const POINTS = 120 // how many points make up the loop
const HALF_WIDTH = 45 // road is 90 wide

// 1. The centerline: a closed loop with some bends in it
const centerline: Point[] = []
for (let i = 0; i < POINTS; i++) {
  const t = (i / POINTS) * Math.PI * 2
  centerline.push({
    x: 400 + (270 + 15 * Math.cos(2 * t)) * Math.cos(t),
    y: 250 + (160 + 15 * Math.sin(3 * t)) * Math.sin(t),
  })
}

// 2. The walls: push each centerline point sideways by half the road width
const leftWall: Point[] = []
const rightWall: Point[] = []
for (let i = 0; i < POINTS; i++) {
  const before = centerline[(i + POINTS - 1) % POINTS]
  const after = centerline[(i + 1) % POINTS]
  let tx = after.x - before.x // direction the road is heading here
  let ty = after.y - before.y
  const len = Math.hypot(tx, ty)
  tx /= len
  ty /= len
  const nx = -ty // sideways direction (at a right angle to the road)
  const ny = tx
  const c = centerline[i]
  leftWall.push({ x: c.x + nx * HALF_WIDTH, y: c.y + ny * HALF_WIDTH })
  rightWall.push({ x: c.x - nx * HALF_WIDTH, y: c.y - ny * HALF_WIDTH })
}

// 3. Turn each wall loop into a list of short line segments
function loopToSegments(loop: Point[]): Segment[] {
  return loop.map((p, i) => ({ a: p, b: loop[(i + 1) % loop.length] }))
}
const walls: Segment[] = [...loopToSegments(leftWall), ...loopToSegments(rightWall)]

// How far is a point from a line segment?
function distToSegment(px: number, py: number, s: Segment): number {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - s.a.x) * dx + (py - s.a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (s.a.x + t * dx), py - (s.a.y + t * dy))
}

// ---------- THE CAR ----------
// Start on the centerline, facing the way the road goes
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

// ---------- RECORDING AND REPLAY ----------
type Input = { throttle: number; steer: number }

let recording: Input[] = []
let mode: 'live' | 'replay' = 'live'
let replayIndex = 0
let savedEnd = { x: 0, y: 0, angle: 0, speed: 0, crashes: 0 }
let message = 'Drive, then press R to replay. Press Enter for a fresh recording.'

const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
  if (e.key === 'r' || e.key === 'R') startReplay()
  if (e.key === 'Enter') startFreshRecording()
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

// Crash = the car's circle is touching any wall segment
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
}

function startFreshRecording() {
  recording = []
  mode = 'live'
  resetCar()
  crashes = 0
  message = 'New recording started. Drive, then press R to replay.'
}

function startReplay() {
  if (recording.length === 0 || mode === 'replay') return
  savedEnd = { x: car.x, y: car.y, angle: car.angle, speed: car.speed, crashes }
  resetCar()
  crashes = 0
  replayIndex = 0
  mode = 'replay'
  message = 'Replaying...'
}

function tick() {
  if (mode === 'live') {
    const input = readKeys()
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
        crashes === savedEnd.crashes
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
  // Grass
  ctx.fillStyle = '#9c9'
  ctx.fillRect(0, 0, 800, 500)

  // Road: both wall loops in one shape, filled so the middle stays empty
  ctx.beginPath()
  tracePath(leftWall)
  tracePath(rightWall)
  ctx.fillStyle = '#555'
  ctx.fill('evenodd')

  // Wall outlines
  ctx.strokeStyle = 'black'
  ctx.lineWidth = 3
  ctx.beginPath()
  tracePath(leftWall)
  ctx.stroke()
  ctx.beginPath()
  tracePath(rightWall)
  ctx.stroke()

  // Start line
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(leftWall[0].x, leftWall[0].y)
  ctx.lineTo(rightWall[0].x, rightWall[0].y)
  ctx.stroke()

  // The car
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
  ctx.fillText('mode: ' + mode, 10, 24)
  ctx.fillText('crashes: ' + crashes, 10, 46)
  ctx.fillText('recorded steps: ' + recording.length, 10, 68)
  ctx.fillText(message, 10, 490)
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