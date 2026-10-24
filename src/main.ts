const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')!

// Where the car starts (on the bottom straight, facing right)
const START = { x: 400, y: 390, angle: 0 }
const car = { x: START.x, y: START.y, angle: START.angle, speed: 0 }

// The track: an outer wall rectangle and an inner island rectangle
const outer = { left: 50, top: 50, right: 750, bottom: 450 }
const inner = { left: 200, top: 170, right: 600, bottom: 330 }

// For crash checking we treat the car as a circle of this size
const CAR_RADIUS = 12

const ACCEL = 0.15
const FRICTION = 0.98
const MAX_SPEED = 6
const MAX_REVERSE = -2
const TURN_RATE = 0.008

let steps = 0
let crashes = 0

const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
})
window.addEventListener('keyup', (e) => {
  keys[e.key] = false
})

// Is the car touching a wall right now?
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

function update() {
  const throttle = (keys['ArrowUp'] ? 1 : 0) - (keys['ArrowDown'] ? 1 : 0)
  const steer = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0)

  car.speed += throttle * ACCEL
  car.speed *= FRICTION
  if (car.speed > MAX_SPEED) car.speed = MAX_SPEED
  if (car.speed < MAX_REVERSE) car.speed = MAX_REVERSE

  car.angle += steer * TURN_RATE * car.speed

  car.x += Math.cos(car.angle) * car.speed
  car.y += Math.sin(car.angle) * car.speed

  // Crash check
  if (hitsWall()) {
    crashes++
    resetCar()
  }

  steps++
}

function draw() {
  ctx.clearRect(0, 0, 800, 500)

  // The road (outer rectangle), then the island (inner rectangle) on top
  ctx.fillStyle = '#555'
  ctx.fillRect(outer.left, outer.top, outer.right - outer.left, outer.bottom - outer.top)
  ctx.fillStyle = '#9c9'
  ctx.fillRect(inner.left, inner.top, inner.right - inner.left, inner.bottom - inner.top)

  // Wall outlines
  ctx.strokeStyle = 'black'
  ctx.lineWidth = 3
  ctx.strokeRect(outer.left, outer.top, outer.right - outer.left, outer.bottom - outer.top)
  ctx.strokeRect(inner.left, inner.top, inner.right - inner.left, inner.bottom - inner.top)

  // The car
  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.rotate(car.angle)
  ctx.fillStyle = 'red'
  ctx.fillRect(-15, -8, 30, 16)
  ctx.fillStyle = 'white'
  ctx.fillRect(8, -6, 6, 12)
  ctx.restore()

  ctx.fillStyle = 'black'
  ctx.font = '16px sans-serif'
  ctx.fillText('speed: ' + car.speed.toFixed(2), 10, 24)
  ctx.fillText('crashes: ' + crashes, 10, 46)
}

const STEP = 1000 / 60
let lastTime = performance.now()
let owed = 0

function loop(now: number) {
  owed += now - lastTime
  lastTime = now
  if (owed > 250) owed = 250

  while (owed >= STEP) {
    update()
    owed -= STEP
  }

  draw()
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)