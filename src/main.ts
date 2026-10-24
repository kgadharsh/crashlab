import { makeRng } from './random'

const rng = makeRng(42)
const demo = [rng(), rng(), rng()]
const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')!

// The box's position
let x = 400
let y = 250

// How many update steps have happened so far
let steps = 0

const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
})
window.addEventListener('keyup', (e) => {
  keys[e.key] = false
})

// UPDATE: the rules of the game. Always runs in equal slices.
function update() {
  if (keys['ArrowLeft']) x -= 3
  if (keys['ArrowRight']) x += 3
  if (keys['ArrowUp']) y -= 3
  if (keys['ArrowDown']) y += 3

  if (x < 15) x = 15
  if (x > 785) x = 785
  if (y < 10) y = 10
  if (y > 490) y = 490

  steps++
}

// DRAW: only paints the current state, changes nothing.
function draw() {
  ctx.clearRect(0, 0, 800, 500)
  ctx.fillStyle = 'red'
  ctx.fillRect(x - 15, y - 10, 30, 20)
  ctx.fillStyle = 'black'
  ctx.font = '16px sans-serif'
  ctx.fillText('steps: ' + steps, 10, 24)
  ctx.fillText('seed 42: ' + demo.map((n) => n.toFixed(4)).join(', '), 10, 46)
}

// The fixed-timestep loop
const STEP = 1000 / 60 // length of one update slice, in milliseconds
let lastTime = performance.now()
let owed = 0 // time we still owe to the update function

function loop(now: number) {
  owed += now - lastTime
  lastTime = now

  // If the tab was hidden for a while, don't try to catch up on everything
  if (owed > 250) owed = 250

  while (owed >= STEP) {
    update()
    owed -= STEP
  }

  draw()
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)