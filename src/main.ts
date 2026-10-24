// Make a canvas (a blank drawing area) and put it on the page
const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.style.border = '2px solid black'
document.body.appendChild(canvas)
const ctx = canvas.getContext('2d')!

// The box's position
let x = 400
let y = 250

// Remember which keys are being held down
const keys: Record<string, boolean> = {}

window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault() // stop the page from scrolling
})
window.addEventListener('keyup', (e) => {
  keys[e.key] = false
})

// This function runs about 60 times per second
function loop() {
  // Move the box if a key is held
  if (keys['ArrowLeft']) x -= 3
  if (keys['ArrowRight']) x += 3
  if (keys['ArrowUp']) y -= 3
  if (keys['ArrowDown']) y += 3

  // Stop the box at the edges of the canvas
  if (x < 15) x = 15
  if (x > 785) x = 785
  if (y < 10) y = 10
  if (y > 490) y = 490

  // Wipe the canvas, then draw the box at its new position
  ctx.clearRect(0, 0, 800, 500)
  ctx.fillStyle = 'red'
  ctx.fillRect(x - 15, y - 10, 30, 20)

  requestAnimationFrame(loop) // ask the browser to run this again
}

loop()