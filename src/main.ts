const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')!

// The car: a position, a direction it faces (in radians), and a speed
const car = { x: 400, y: 250, angle: 0, speed: 0 }

// Tuning numbers. Try changing these later and see how the car feels.
const ACCEL = 0.15 // how fast the gas speeds you up
const FRICTION = 0.98 // each step, speed is multiplied by this (less than 1 = slows down)
const MAX_SPEED = 6
const MAX_REVERSE = -2
const TURN_RATE = 0.008 // how sharply the car turns

let steps = 0

const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
})
window.addEventListener('keyup', (e) => {
  keys[e.key] = false
})

function update() {
  // Read the keys as numbers: +1, -1, or 0
  const throttle = (keys['ArrowUp'] ? 1 : 0) - (keys['ArrowDown'] ? 1 : 0)
  const steer = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0)

  // Gas and brake change the speed, friction slowly removes it
  car.speed += throttle * ACCEL
  car.speed *= FRICTION
  if (car.speed > MAX_SPEED) car.speed = MAX_SPEED
  if (car.speed < MAX_REVERSE) car.speed = MAX_REVERSE

  // Steering only works while moving (turning is multiplied by speed)
  car.angle += steer * TURN_RATE * car.speed

  // Move the car in the direction it is facing
  car.x += Math.cos(car.angle) * car.speed
  car.y += Math.sin(car.angle) * car.speed

  // Stop at the canvas edges (we'll replace this with real walls later)
  if (car.x < 15) { car.x = 15; car.speed = 0 }
  if (car.x > 785) { car.x = 785; car.speed = 0 }
  if (car.y < 15) { car.y = 15; car.speed = 0 }
  if (car.y > 485) { car.y = 485; car.speed = 0 }

  steps++
}

function draw() {
  ctx.clearRect(0, 0, 800, 500)

  // Draw the car, rotated to face its direction
  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.rotate(car.angle)
  ctx.fillStyle = 'red'
  ctx.fillRect(-15, -8, 30, 16)
  ctx.fillStyle = 'white' // a white stripe marks the front
  ctx.fillRect(8, -6, 6, 12)
  ctx.restore()

  ctx.fillStyle = 'black'
  ctx.font = '16px sans-serif'
  ctx.fillText('steps: ' + steps, 10, 24)
  ctx.fillText('speed: ' + car.speed.toFixed(2), 10, 46)
}

// The fixed-timestep loop (same as before)
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