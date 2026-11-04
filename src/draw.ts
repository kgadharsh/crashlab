// Drawing the track and cars. Tracks live in a world several screens big (WORLD in track.ts).
// The camera never rotates (north stays up). It either follows a car, scrolling over the
// world, or fits the whole track on screen. A minimap shows the whole track and where cars are.
import type { Point } from './sensors'
import type { Car } from './sim'
import { BLOCK_HALF, HALF_WIDTH, WORLD, type Track } from './track'

export const W = 800 // the screen
export const H = 500

// Canvas colours (these match the CSS tokens in style.css)
export const COL = {
  ground: '#07090c',
  road: '#1b2027',
  wall: '#5b6573',
  kerbA: '#e8ecf1',
  kerbB: '#d83a34',
  text: '#e8ecf1',
  muted: '#8a94a3',
  accent: '#ffb31a', // amber: your car, the lead car
  tele: '#3fd0ff', // cyan: telemetry, rays
  bad: '#ff4d4d',
  good: '#3ddc84',
  swarm: 'rgba(63,208,255,0.55)',
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
  g.fillStyle = COL.road
  g.fill(s.road, 'evenodd')
  if (detail) {
    g.strokeStyle = 'rgba(255,255,255,0.08)'
    g.lineWidth = 2
    g.setLineDash([16, 20])
    g.stroke(s.dashes)
    g.setLineDash([])
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

// Show the whole world
export function fit(cam: Camera) {
  cam.x = WORLD.w / 2
  cam.y = WORLD.h / 2
  cam.zoom = FIT_ZOOM
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
  g.fillStyle = 'rgba(7,9,12,0.82)'
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
// A top-down race car: tyres, a tapered body, wings front and back, a dark cockpit
export function drawCar(g: CanvasRenderingContext2D, c: { x: number; y: number; angle: number }, length: number, width: number, body: string) {
  const L = length / 2
  const Wd = width / 2
  const tyre = Math.max(2, width * 0.2)
  g.save()
  g.translate(c.x, c.y)
  g.rotate(c.angle)
  g.fillStyle = '#020304'
  for (const x of [L * 0.3, -L * 0.8]) {
    g.fillRect(x, -Wd, L * 0.42, tyre)
    g.fillRect(x, Wd - tyre, L * 0.42, tyre)
  }
  g.fillStyle = body
  g.fillRect(L * 0.72, -Wd * 0.8, L * 0.16, Wd * 1.6)
  g.fillRect(-L, -Wd * 0.85, L * 0.2, Wd * 1.7)
  g.beginPath()
  g.moveTo(L, 0)
  g.lineTo(L * 0.2, -Wd * 0.34)
  g.lineTo(-L * 0.1, -Wd * 0.72)
  g.lineTo(-L * 0.85, -Wd * 0.5)
  g.lineTo(-L * 0.85, Wd * 0.5)
  g.lineTo(-L * 0.1, Wd * 0.72)
  g.lineTo(L * 0.2, Wd * 0.34)
  g.closePath()
  g.fill()
  g.fillStyle = COL.ground
  g.beginPath()
  g.ellipse(-L * 0.12, 0, L * 0.24, Wd * 0.3, 0, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

export function drawRays(g: CanvasRenderingContext2D, car: Car) {
  car.spec.rayAngles.forEach((a, i) => {
    const d = car.rays[i]
    const x = car.x + Math.cos(car.angle + a) * d
    const y = car.y + Math.sin(car.angle + a) * d
    const near = d < car.spec.rayRange * 0.35
    g.strokeStyle = near ? 'rgba(255,77,77,0.8)' : 'rgba(63,208,255,0.55)'
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
