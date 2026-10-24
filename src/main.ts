const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')!

const START = { x: 400, y: 390, angle: 0 }
const car = { x: START.x, y: START.y, angle: START.angle, speed: 0 }

const outer = { left: 50, top: 50, right: 750, bottom: 450 }
const inner = { left: 200, top: 170, right: 600, bottom: 330 }
const CAR_RADIUS = 12

const ACCEL = 0.15
const FRICTION = 0.98
const MAX_SPEED = 6
const MAX_REVERSE = -2
const TURN_RATE = 0.008

let steps = 0
let crashes = 0

// An "input" is what the driver did during one step: gas/brake and steering
type Input = { throttle: number; steer: number }

// Recording and replay
let recording: Input[] = []
let mode: 'live' | 'replay' = 'live'
let replayIndex = 0
let savedEnd = { x: 0, y: 0, angle: 0, speed: 0, crashes: 0 }
let message = 'Drive around, then press R to replay. Press Enter to start a fresh recording.'

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

function hitsWall(): boolean {
  const r = CAR_RADIUS
  const outsideOuter =
    car.x - r < outer.left ||
    car.x + r > outer.right ||
    car.y - r < outer.top ||
    car.y + r > outer.bottom
  const insideInner =
    car.x + r > inner.left &&
    car.x - r < inner.right &&
    car.y + r > inner.top &&
    car.y - r < inner.bottom
  return outsideOuter || insideInner
}

function resetCar() {
  car.x = START.x
  car.y = START.y
  car.angle = START.angle
  car.speed = 0
}

// The physics now takes the input as a parameter instead of reading the keyboard
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

  steps++
}

function startFreshRecording() {
  recording = []
  mode = 'live'
  resetCar()
  crashes = 0
  steps = 0
  message = 'New recording started. Drive, then press R to replay.'
}

function startReplay() {
  if (recording.length === 0 || mode === 'replay') return
  // Remember exactly where this drive ended
  savedEnd = { x: car.x, y: car.y, angle: car.angle, speed: car.speed, crashes }
  // Go back to the beginning and feed the same inputs back in
  resetCar()
  crashes = 0
  steps = 0
  replayIndex = 0
  mode = 'replay'
  message = 'Replaying...'
}

// One step of the game
function tick() {
  if (mode === 'live') {
    const input = readKeys()
    recording.push(input)
    update(input)
  } else {
    update(recording[replayIndex])
    replayIndex++
    if (replayIndex >= recording.length) {
      // Replay finished: does it end exactly where the real drive ended?
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

function draw() {
  ctx.clearRect(0, 0, 800, 500)

  ctx.fillStyle = '#555'
  ctx.fillRect(outer.left, outer.top, outer.right - outer.left, outer.bottom - outer.top)
  ctx.fillStyle = '#9c9'
  ctx.fillRect(inner.left, inner.top, inner.right - inner.left, inner.bottom - inner.top)

  ctx.strokeStyle = 'black'
  ctx.lineWidth = 3
  ctx.strokeRect(outer.left, outer.top, outer.right - outer.left, outer.bottom - outer.top)
  ctx.strokeRect(inner.left, inner.top, inner.right - inner.left, inner.bottom - inner.top)

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