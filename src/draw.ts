// Drawing the track and cars. Tracks live in a world several screens big (WORLD in track.ts).
// The camera never rotates (north stays up). It either follows a car, scrolling over the
// world, or fits the whole track on screen. A minimap shows the whole track and where cars are.
import type { Point } from './sensors'
import type { Car } from './sim'
import { BLOCK_HALF, CHECKPOINT_STRIDE, HALF_WIDTH, NIGHT_RANGE, WORLD, type Track } from './track'

export const W = 800 // the screen
export const H = 500

// Canvas colours (these match the CSS tokens in style.css)
export const COL = {
  ground: '#040205',
  road: '#282431',
  roadWet: '#29245b', // wet asphalt shifts toward the violet support colour
  wall: '#817c91',
  kerbA: '#f5f2fa',
  kerbB: '#e65f59',
  text: '#f5f2fa',
  muted: '#aaa5b7',
  accent: '#e5a83c',
  tele: '#4b43e9',
  bad: '#ff6b66',
  good: '#58d68d',
  swarm: 'rgba(75,67,233,0.52)',
}

// ---------- TRACK SHAPES, BUILT ONCE PER TRACK ----------
type Shapes = { road: Path2D; edges: Path2D; dashes: Path2D; kerbA: Path2D; kerbB: Path2D; blocks: Path2D; blockHoles: Path2D }
const shapes = new WeakMap<Track, Shapes>()

function loop(path: Path2D, pts: Point[]) {
  path.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y)
  path.closePath()
}

// How sharply a loop of points turns at point i (radians), smoothed over a few points
function bendAt(pts: Point[], i: number): number {
  const n = pts.length
  const a = pts[(i + n - 3) % n]
  const b = pts[i]
  const c = pts[(i + 3) % n]
  const turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
}

function shapesOf(track: Track): Shapes {
  const cached = shapes.get(track)
  if (cached) return cached
  const road = new Path2D()
  loop(road, track.leftWall)
  loop(road, track.rightWall)
  const edges = new Path2D()
  loop(edges, track.leftWall)
  loop(edges, track.rightWall)
  const dashes = new Path2D()
  loop(dashes, track.centerline)
  // red and white kerbs on the tighter bends
  const kerbA = new Path2D()
  const kerbB = new Path2D()
  for (const wall of [track.leftWall, track.rightWall]) {
    wall.forEach((p, i) => {
      if (bendAt(wall, i) < 0.2) return
      const next = wall[(i + 1) % wall.length]
      ;(i % 2 === 0 ? kerbA : kerbB).moveTo(p.x, p.y)
      ;(i % 2 === 0 ? kerbA : kerbB).lineTo(next.x, next.y)
    })
  }
  const blocks = new Path2D()
  const blockHoles = new Path2D()
  for (const k of track.blocks) {
    blocks.rect(k.x - BLOCK_HALF, k.y - BLOCK_HALF, BLOCK_HALF * 2, BLOCK_HALF * 2)
    blockHoles.rect(k.x - BLOCK_HALF + 4, k.y - BLOCK_HALF + 4, BLOCK_HALF * 2 - 8, BLOCK_HALF * 2 - 8)
  }
  const s = { road, edges, dashes, kerbA, kerbB, blocks, blockHoles }
  shapes.set(track, s)
  return s
}

// Draw the track in world coordinates (call inside withCamera). detail = false for small pictures.
export function drawTrack(g: CanvasRenderingContext2D, track: Track, detail = true) {
  const s = shapesOf(track)
  const wet = track.grip !== undefined && track.grip < 1
  g.fillStyle = wet ? COL.roadWet : COL.road
  g.fill(s.road, 'evenodd')
  if (wet) {
    g.fillStyle = 'rgba(120,190,255,0.10)' // the sheen on a wet road
    g.fill(s.road, 'evenodd')
    if (detail) drawRain(g)
  }
  if (detail) {
    g.strokeStyle = 'rgba(255,255,255,0.08)'
    g.lineWidth = 2
    g.setLineDash([16, 20])
    g.stroke(s.dashes)
    g.setLineDash([])
  }
  if (track.ice) {
    // ice patches: a pale sheet over each stretch of road, from one checkpoint to another
    g.strokeStyle = 'rgba(200,235,255,0.28)'
    g.lineWidth = HALF_WIDTH * 2
    g.lineCap = 'round'
    for (const [a, b] of track.ice) {
      g.beginPath()
      for (let i = a * CHECKPOINT_STRIDE; i <= b * CHECKPOINT_STRIDE; i++) {
        const p = track.centerline[i % track.centerline.length]
        if (i === a * CHECKPOINT_STRIDE) g.moveTo(p.x, p.y)
        else g.lineTo(p.x, p.y)
      }
      g.stroke()
    }
    g.lineCap = 'butt'
  }
  g.strokeStyle = COL.wall
  g.lineWidth = 2
  g.stroke(s.edges)
  g.lineWidth = 6
  g.strokeStyle = COL.kerbA
  g.stroke(s.kerbA)
  g.strokeStyle = COL.kerbB
  g.stroke(s.kerbB)
  if (detail) drawStartLine(g, track)
  g.fillStyle = COL.accent
  g.fill(s.blocks)
  if (detail) {
    g.fillStyle = '#111'
    g.fill(s.blockHoles)
  }
  if (track.night) {
    // night: the whole world dims (the car and its rays are drawn on top)
    g.fillStyle = 'rgba(4,6,20,0.55)'
    g.fillRect(-WORLD.w, -WORLD.h, WORLD.w * 3, WORLD.h * 3)
  }
}

function drawStartLine(g: CanvasRenderingContext2D, track: Track) {
  const a = track.leftWall[0]
  const b = track.rightWall[0]
  const across = Math.hypot(b.x - a.x, b.y - a.y)
  const SQ = 6
  g.save()
  g.translate(a.x, a.y)
  g.rotate(Math.atan2(b.y - a.y, b.x - a.x))
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i * SQ < across; i++) {
      g.fillStyle = (i + row) % 2 === 0 ? COL.kerbA : '#111'
      g.fillRect(i * SQ, row * SQ - SQ, Math.min(SQ, across - i * SQ), SQ)
    }
  }
  g.restore()
}

// A faint grid on the ground, so movement can be seen even on a long straight
function drawGround(g: CanvasRenderingContext2D, cam: Camera) {
  const half = { w: W / 2 / cam.zoom, h: H / 2 / cam.zoom }
  const STEP = 80
  g.fillStyle = 'rgba(255,255,255,0.045)'
  const x0 = Math.floor((cam.x - half.w) / STEP) * STEP
  const y0 = Math.floor((cam.y - half.h) / STEP) * STEP
  const dot = 2 / cam.zoom
  for (let x = x0; x < cam.x + half.w; x += STEP) for (let y = y0; y < cam.y + half.h; y += STEP) g.fillRect(x, y, dot, dot)
}

// ---------- THE CAMERA ----------
export type Camera = { x: number; y: number; zoom: number }
export const newCamera = (): Camera => ({ x: WORLD.w / 2, y: WORLD.h / 2, zoom: FIT_ZOOM })

export const FIT_ZOOM = Math.min(W / WORLD.w, H / WORLD.h) // the whole world on one screen
const FOLLOW_ZOOM = 1
const LOOK_AHEAD = 28 // the camera leads the car by this much per unit of speed, to show more road ahead

// Ease the camera towards a car, a little ahead of it, never past the edge of the world
export function follow(cam: Camera, car: { x: number; y: number; angle: number; speed: number }, snap = false) {
  const ahead = Math.max(0, car.speed) * LOOK_AHEAD
  let tx = car.x + Math.cos(car.angle) * ahead
  let ty = car.y + Math.sin(car.angle) * ahead
  const halfW = W / 2 / FOLLOW_ZOOM
  const halfH = H / 2 / FOLLOW_ZOOM
  tx = Math.max(halfW, Math.min(WORLD.w - halfW, tx))
  ty = Math.max(halfH, Math.min(WORLD.h - halfH, ty))
  const ease = snap ? 1 : 0.12
  cam.x += (tx - cam.x) * ease
  cam.y += (ty - cam.y) * ease
  cam.zoom += (FOLLOW_ZOOM - cam.zoom) * (snap ? 1 : 0.15)
}

// Ease the camera to a spot and zoom (snap: arrive at once)
export function lookAt(cam: Camera, x: number, y: number, zoom: number, snap = false) {
  const ease = snap ? 1 : 0.12
  cam.x += (x - cam.x) * ease
  cam.y += (y - cam.y) * ease
  cam.zoom += (zoom - cam.zoom) * (snap ? 1 : 0.15)
}

// Show the whole world
export function fit(cam: Camera, snap = true) {
  lookAt(cam, WORLD.w / 2, WORLD.h / 2, FIT_ZOOM, snap)
}

// Show one whole track as big as the screen allows, leaving room at the top for its name
const FIT_TOP = 56 // screen pixels kept clear for the heading
const FIT_PAD = 30 // world units of ground round the road
const boundsCache = new WeakMap<Track, { x0: number; x1: number; y0: number; y1: number }>()
export function fitTrack(cam: Camera, track: Track, snap = true) {
  let b = boundsCache.get(track)
  if (!b) {
    const xs = [...track.leftWall, ...track.rightWall].map((p) => p.x)
    const ys = [...track.leftWall, ...track.rightWall].map((p) => p.y)
    boundsCache.set(track, (b = { x0: Math.min(...xs) - FIT_PAD, x1: Math.max(...xs) + FIT_PAD, y0: Math.min(...ys) - FIT_PAD, y1: Math.max(...ys) + FIT_PAD }))
  }
  const zoom = Math.min(W / (b.x1 - b.x0), (H - FIT_TOP) / (b.y1 - b.y0))
  lookAt(cam, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 - FIT_TOP / 2 / zoom, zoom, snap)
}

// Rain over a wet track: short slanting streaks that drift down, so a wet road is obvious at a glance
function drawRain(g: CanvasRenderingContext2D) {
  const t = performance.now() / 1000
  g.strokeStyle = 'rgba(170,215,255,0.22)'
  g.lineWidth = 2
  g.beginPath()
  const STEP = 70
  for (let x = 0; x < WORLD.w; x += STEP)
    for (let y = 0; y < WORLD.h; y += STEP) {
      const k = (x * 7 + y * 13) % 97 // a fixed scatter, so streaks do not sit in a grid
      const px = x + (k % STEP)
      const py = y + ((k * 3 + t * 260) % STEP)
      g.moveTo(px, py)
      g.lineTo(px - 6, py + 16)
    }
  g.stroke()
}

// Paint in world coordinates through the camera
export function withCamera(g: CanvasRenderingContext2D, cam: Camera, paint: () => void) {
  g.save()
  g.translate(W / 2, H / 2)
  g.scale(cam.zoom, cam.zoom)
  g.translate(-cam.x, -cam.y)
  drawGround(g, cam)
  paint()
  g.restore()
}

export function clear(g: CanvasRenderingContext2D) {
  g.fillStyle = COL.ground
  g.fillRect(0, 0, W, H)
}

// ---------- THE MINIMAP ----------
const MAP_W = 180
const MAP_H = (MAP_W * WORLD.h) / WORLD.w
const mapScale = MAP_W / WORLD.w

// The whole track in the bottom-left corner. dots: other cars, lead: the car the camera follows.
export function drawMinimap(g: CanvasRenderingContext2D, track: Track, cam: Camera, lead: { x: number; y: number } | null, dots: { x: number; y: number }[] = []) {
  const x0 = 12
  const y0 = H - MAP_H - 12
  g.save()
  g.fillStyle = 'rgba(4,2,5,0.86)'
  g.fillRect(x0 - 6, y0 - 6, MAP_W + 12, MAP_H + 12)
  g.strokeStyle = 'rgba(255,255,255,0.12)'
  g.lineWidth = 1
  g.strokeRect(x0 - 6, y0 - 6, MAP_W + 12, MAP_H + 12)
  g.translate(x0, y0)
  g.scale(mapScale, mapScale)
  const s = shapesOf(track)
  g.strokeStyle = COL.wall
  g.lineWidth = 3 / mapScale
  g.stroke(s.edges)
  // the part of the world on screen
  const vw = W / cam.zoom
  const vh = H / cam.zoom
  g.strokeStyle = 'rgba(232,236,241,0.5)'
  g.lineWidth = 1.5 / mapScale
  g.strokeRect(cam.x - vw / 2, cam.y - vh / 2, vw, vh)
  g.fillStyle = COL.tele
  for (const d of dots) g.fillRect(d.x - 1.5 / mapScale, d.y - 1.5 / mapScale, 3 / mapScale, 3 / mapScale)
  if (lead) {
    g.fillStyle = COL.accent
    g.beginPath()
    g.arc(lead.x, lead.y, 4.5 / mapScale, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

// ---------- CARS ----------
// A top-down race car: tyres, a body, wings front and back, a dark cockpit. look is the player's chosen design
// (see looks.ts): the designs differ only in shape, never in how the car drives.
export function drawCar(g: CanvasRenderingContext2D, c: { x: number; y: number; angle: number }, length: number, width: number, body: string, look = 0) {
  const L = length / 2
  const Wd = width / 2
  const tyre = Math.max(2, width * 0.2)
  g.save()
  g.translate(c.x, c.y)
  g.rotate(c.angle)
  const poly = (pts: number[][]) => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * L, y * Wd) : g.moveTo(x * L, y * Wd)))
    g.closePath()
    g.fill()
  }
  const wheels = (front: number, back: number, spread: number) => {
    g.fillStyle = '#020304'
    for (const x of [L * front, L * back]) {
      g.fillRect(x, -Wd * spread, L * 0.42, tyre)
      g.fillRect(x, Wd * spread - tyre, L * 0.42, tyre)
    }
  }
  const cockpit = (x: number, rx: number, ry: number) => {
    g.fillStyle = COL.ground
    g.beginPath()
    g.ellipse(L * x, 0, L * rx, Wd * ry, 0, 0, Math.PI * 2)
    g.fill()
  }
  if (look === 1) {
    // Arrow: a long pointed nose and a wide rear wing
    wheels(0.3, -0.8, 1)
    g.fillStyle = body
    g.fillRect(L * 0.62, -Wd * 0.9, L * 0.14, Wd * 1.8)
    g.fillRect(-L, -Wd * 1.05, L * 0.2, Wd * 2.1)
    poly([[1.1, 0], [0.1, -0.3], [-0.2, -0.55], [-0.85, -0.45], [-0.85, 0.45], [-0.2, 0.55], [0.1, 0.3]])
    cockpit(-0.12, 0.22, 0.26)
  } else if (look === 2) {
    // Wedge: a flat triangle with side pods
    wheels(0.25, -0.8, 1)
    g.fillStyle = body
    g.fillRect(L * 0.78, -Wd * 0.95, L * 0.12, Wd * 1.9)
    g.fillRect(-L, -Wd * 0.9, L * 0.18, Wd * 1.8)
    poly([[1, 0], [-0.9, -0.95], [-0.9, 0.95]])
    g.fillStyle = 'rgba(0,0,0,0.28)'
    g.fillRect(-L * 0.45, -Wd * 0.8, L * 0.5, Wd * 0.2)
    g.fillRect(-L * 0.45, Wd * 0.6, L * 0.5, Wd * 0.2)
    cockpit(-0.05, 0.22, 0.28)
  } else if (look === 3) {
    // Needle: very long and thin, with wide wings and wheels pushed out
    wheels(0.35, -0.85, 1.1)
    g.fillStyle = body
    g.fillRect(L * 0.82, -Wd * 1.1, L * 0.14, Wd * 2.2)
    g.fillRect(-L * 1.05, -Wd * 1, L * 0.18, Wd * 2)
    poly([[1.05, 0], [0.4, -0.2], [-0.95, -0.28], [-0.95, 0.28], [0.4, 0.2]])
    cockpit(-0.05, 0.2, 0.2)
  } else if (look === 4) {
    // Hyper: wide and aggressive, with twin tail fins and a pale stripe
    wheels(0.25, -0.85, 1.05)
    g.fillStyle = body
    g.fillRect(L * 0.7, -Wd * 1, L * 0.16, Wd * 2)
    g.fillRect(-L * 1.02, -Wd * 1.1, L * 0.22, Wd * 0.5)
    g.fillRect(-L * 1.02, Wd * 0.6, L * 0.22, Wd * 0.5)
    poly([[1, 0], [0.55, -0.45], [0.05, -0.85], [-0.8, -0.8], [-0.95, -0.35], [-0.95, 0.35], [-0.8, 0.8], [0.05, 0.85], [0.55, 0.45]])
    g.fillStyle = 'rgba(255,255,255,0.8)'
    g.fillRect(-L * 0.9, -Wd * 0.07, L * 1.8, Wd * 0.14)
    cockpit(-0.05, 0.24, 0.3)
  } else {
    // Classic
    wheels(0.3, -0.8, 1)
    g.fillStyle = body
    g.fillRect(L * 0.72, -Wd * 0.8, L * 0.16, Wd * 1.6)
    g.fillRect(-L, -Wd * 0.85, L * 0.2, Wd * 1.7)
    poly([[1, 0], [0.2, -0.34], [-0.1, -0.72], [-0.85, -0.5], [-0.85, 0.5], [-0.1, 0.72], [0.2, 0.34]])
    cockpit(-0.12, 0.24, 0.3)
  }
  g.restore()
}

// What a car sees, thinks and does, drawn small: the rays as bars (short means something is close), the hidden
// neurons as dots (amber is positive, cyan negative, brighter is stronger) and the two outputs as bars.
export type Thought = { inputs: number[]; hidden: number[]; outputs: number[]; rays?: number } // rays: how many inputs are rays (the next is speed)
export function drawBrain(g: CanvasRenderingContext2D, t: Thought, x: number, y: number, w: number, h: number) {
  g.save()
  g.fillStyle = 'rgba(4,2,5,0.82)'
  g.fillRect(x, y, w, h)
  g.strokeStyle = COL.road
  g.lineWidth = 1
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  g.font = '700 11px "Barlow Condensed", sans-serif'
  g.textBaseline = 'alphabetic'
  g.fillStyle = COL.muted
  const colW = (w - 24) / 3
  const cols = [x + 8, x + 8 + colW + 4, x + 8 + 2 * (colW + 4)]
  ;['SEES', 'THINKS', 'DOES'].forEach((label, i) => g.fillText(label, cols[i], y + 15))
  const top = y + 24
  const bottom = y + h - 8
  // sees: one bar per ray, then the car's own speed
  const nRays = t.rays ?? t.inputs.length - 1
  const rays = t.inputs.slice(0, nRays)
  const rowH = Math.min(11, (bottom - top) / (rays.length + 1))
  rays.forEach((d, i) => {
    const near = d < 0.35
    g.fillStyle = near ? COL.bad : COL.tele
    g.fillRect(cols[0], top + i * rowH, Math.max(2, colW * Math.min(1, d)), rowH - 3)
  })
  g.fillStyle = COL.accent
  g.fillRect(cols[0], top + rays.length * rowH, Math.max(2, colW * Math.min(1, t.inputs[nRays])), rowH - 3)
  // thinks: one dot per hidden neuron
  const step = (bottom - top) / t.hidden.length
  t.hidden.forEach((a, i) => {
    const cy = top + step * (i + 0.5)
    g.fillStyle = a >= 0 ? `rgba(229,168,60,${0.2 + 0.8 * Math.abs(a)})` : `rgba(75,67,233,${0.2 + 0.8 * Math.abs(a)})`
    g.beginPath()
    g.arc(cols[1] + colW / 2, cy, Math.min(7, step * 0.38), 0, Math.PI * 2)
    g.fill()
  })
  // does: steering (left or right of the middle) and throttle (from the left)
  const bar = (label: string, value: number, row: number, centred: boolean) => {
    const by = top + row * 30
    g.fillStyle = COL.muted
    g.fillText(label, cols[2], by + 8)
    g.fillStyle = COL.road
    g.fillRect(cols[2], by + 12, colW, 8)
    g.fillStyle = COL.accent
    if (centred) g.fillRect(cols[2] + colW / 2 + Math.min(0, value) * (colW / 2), by + 12, Math.abs(value) * (colW / 2), 8)
    else g.fillRect(cols[2], by + 12, Math.max(0, value) * colW, 8)
  }
  bar('STEER', t.outputs[0] ?? 0, 0, true)
  bar('GAS', t.outputs[1] ?? 0, 1, false)
  g.restore()
}

export function drawRays(g: CanvasRenderingContext2D, car: Car) {
  // at night without headlights a ray sees only NIGHT_RANGE, so it is drawn no longer than that
  const dark = car.track.night && !car.spec.lights
  car.spec.rayAngles.forEach((a, i) => {
    const d = dark ? Math.min(car.rays[i], NIGHT_RANGE) : car.rays[i]
    const x = car.x + Math.cos(car.angle + a) * d
    const y = car.y + Math.sin(car.angle + a) * d
    const near = d < car.spec.rayRange * 0.35
    g.strokeStyle = near ? 'rgba(255,107,102,0.8)' : 'rgba(75,67,233,0.8)'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(car.x, car.y)
    g.lineTo(x, y)
    g.stroke()
    g.fillStyle = near ? COL.bad : COL.tele
    g.beginPath()
    g.arc(x, y, 3, 0, Math.PI * 2)
    g.fill()
  })
}

// Where to point the camera so a car's whole sensor fan fills the screen: the middle of the fan,
// and the zoom that fits it with room for the labels. The camera never rotates, so this works
// out the same for any direction the car faces.
const FAN_PAD = 44 // world units of room around the fan, for the angle labels
const FAN_MAX_ZOOM = 1.6
const TOP_ROOM = 90 // screen pixels kept clear at the top and bottom, for the text drawn there
const BOTTOM_ROOM = 26
export function fanFrame(car: Car): { x: number; y: number; zoom: number } {
  const { rayAngles, rayRange } = car.spec
  const from = car.angle + rayAngles[0]
  const to = car.angle + rayAngles[rayAngles.length - 1]
  const xs = [car.x]
  const ys = [car.y]
  for (let i = 0; i <= 16; i++) {
    const a = from + ((to - from) * i) / 16
    xs.push(car.x + Math.cos(a) * rayRange)
    ys.push(car.y + Math.sin(a) * rayRange)
  }
  const x0 = Math.min(...xs) - FAN_PAD
  const x1 = Math.max(...xs) + FAN_PAD
  const y0 = Math.min(...ys) - FAN_PAD
  const y1 = Math.max(...ys) + FAN_PAD
  const zoom = Math.max(FIT_ZOOM, Math.min(FAN_MAX_ZOOM, W / (x1 - x0), (H - TOP_ROOM - BOTTOM_ROOM) / (y1 - y0)))
  // the fan sits in the space between the text, so the camera aims a little above its middle
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - (TOP_ROOM - BOTTOM_ROOM) / 2 / zoom, zoom }
}

// What a car's sensors cover, whatever is in the way: a faint fan out to full range, each ray as a
// dashed line at full length, the spread as an arc between the outer rays, and each ray's angle
// (0° is straight ahead, L and R are left and right of the car, whichever way it faces). The real rays (drawRays) are drawn over this and stop at walls.
export function drawSensorFan(g: CanvasRenderingContext2D, car: Car, zoom: number) {
  const { rayAngles, rayRange } = car.spec
  const n = rayAngles.length
  const px = 1 / zoom // one screen pixel, in world units
  const from = car.angle + rayAngles[0]
  const to = car.angle + rayAngles[n - 1]
  g.save()
  g.fillStyle = 'rgba(75,67,233,0.15)'
  g.beginPath()
  g.moveTo(car.x, car.y)
  g.arc(car.x, car.y, rayRange, from, to)
  g.closePath()
  g.fill()

  g.strokeStyle = 'rgba(75,67,233,0.72)'
  g.lineWidth = px
  g.setLineDash([5 * px, 5 * px])
  for (const a of rayAngles) {
    g.beginPath()
    g.moveTo(car.x, car.y)
    g.lineTo(car.x + Math.cos(car.angle + a) * rayRange, car.y + Math.sin(car.angle + a) * rayRange)
    g.stroke()
  }
  g.setLineDash([])

  // the spread, with its size in degrees on a dark chip so the rays do not run through it
  const arcR = 64
  g.strokeStyle = COL.accent
  g.lineWidth = 2 * px
  g.beginPath()
  g.arc(car.x, car.y, arcR, from, to)
  g.stroke()
  g.font = '700 ' + 15 * px + 'px "Barlow Condensed", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const spread = Math.round(((rayAngles[n - 1] - rayAngles[0]) * 180) / Math.PI) + '°'
  const cx = car.x + Math.cos(car.angle) * (arcR + 22 * px)
  const cy = car.y + Math.sin(car.angle) * (arcR + 22 * px)
  g.fillStyle = COL.ground
  g.fillRect(cx - 20 * px, cy - 9 * px, 40 * px, 18 * px)
  g.fillStyle = COL.accent
  g.fillText(spread, cx, cy)

  // every ray's angle if they are far enough apart to read, otherwise just the outer rays and the middle one
  g.font = '700 ' + 13 * px + 'px "Barlow Condensed", sans-serif'
  g.fillStyle = COL.muted
  const apart = n < 2 || rayRange * Math.abs(rayAngles[1] - rayAngles[0]) * zoom >= 46
  rayAngles.forEach((a, i) => {
    if (!(apart || i === 0 || i === n - 1 || (n % 2 === 1 && i === (n - 1) / 2))) return
    const deg = Math.round((a * 180) / Math.PI)
    const r = rayRange + 15 * px
    g.fillText((deg < 0 ? 'L' : deg > 0 ? 'R' : '') + Math.abs(deg) + '°', car.x + Math.cos(car.angle + a) * r, car.y + Math.sin(car.angle + a) * r)
  })
  g.restore()
}

export function drawCrash(g: CanvasRenderingContext2D, x: number, y: number) {
  g.lineCap = 'round'
  g.strokeStyle = COL.bad
  g.lineWidth = 2.5
  g.beginPath()
  g.moveTo(x - 5, y - 5)
  g.lineTo(x + 5, y + 5)
  g.moveTo(x + 5, y - 5)
  g.lineTo(x - 5, y + 5)
  g.stroke()
  g.lineCap = 'butt'
}

// A small picture of a whole track for the practice-track picker
export function drawThumb(canvas: HTMLCanvasElement, track: Track) {
  const g = canvas.getContext('2d')!
  g.fillStyle = COL.ground
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.save()
  const k = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h)
  g.translate((canvas.width - WORLD.w * k) / 2, (canvas.height - WORLD.h * k) / 2)
  g.scale(k, k)
  // at this size the road would be a hairline, so it is drawn as one thick bright line
  g.strokeStyle = '#7d8796'
  g.lineWidth = 2 * HALF_WIDTH * 1.6
  g.lineJoin = 'round'
  g.stroke(shapesOf(track).dashes)
  g.fillStyle = COL.accent
  for (const p of track.blocks) g.fillRect(p.x - 40, p.y - 40, 80, 80)
  g.restore()
}
