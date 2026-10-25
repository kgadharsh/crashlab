import type { Point, Segment } from './sensors'
import { makeRng } from './random'

export const POINTS = 120
export const HALF_WIDTH = 45
export const CHECKPOINT_STRIDE = 6
export const CHECKPOINTS = POINTS / CHECKPOINT_STRIDE

// Everything a car needs to know about the road it is driving on
export type Track = {
  centerline: Point[]
  leftWall: Point[]
  rightWall: Point[]
  walls: Segment[]
  start: { x: number; y: number; angle: number }
}

function loopToSegments(loop: Point[]): Segment[] {
  return loop.map((p, i) => ({ a: p, b: loop[(i + 1) % loop.length] }))
}

// Turn a centerline (a closed loop of POINTS points) into a full track with walls
export function buildTrack(centerline: Point[]): Track {
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
  return {
    centerline,
    leftWall,
    rightWall,
    walls: [...loopToSegments(leftWall), ...loopToSegments(rightWall)],
    start: {
      x: centerline[0].x,
      y: centerline[0].y,
      angle: Math.atan2(
        centerline[1].y - centerline[POINTS - 1].y,
        centerline[1].x - centerline[POINTS - 1].x,
      ),
    },
  }
}

// ---------- THE ORIGINAL TRACK (the one you have been driving on) ----------
function defaultCenterline(): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < POINTS; i++) {
    const t = (i / POINTS) * Math.PI * 2
    pts.push({
      x: 400 + (270 + 15 * Math.cos(2 * t)) * Math.cos(t),
      y: 250 + (160 + 15 * Math.sin(3 * t)) * Math.sin(t),
    })
  }
  return pts
}
export const DEFAULT_TRACK: Track = buildTrack(defaultCenterline())

// ---------- CHECKING A TRACK IS FAIR ----------
const MIN_CORNER_RADIUS = 65 // tighter than this and the car cannot physically turn
const MIN_GAP = 2 * HALF_WIDTH + 30 // two far-apart parts of the road must not touch
const MIN_LENGTH = 1000
const MAX_LENGTH = 1800
const CANVAS = { w: 800, h: 500, margin: 8 }

// Returns why the track is unusable, or null if it is fine
export function trackProblem(track: Track, minRadius: number = MIN_CORNER_RADIUS): string | null {
  const c = track.centerline
  let length = 0
  let tightest = Infinity
  for (let i = 0; i < POINTS; i++) {
    const a = c[(i + POINTS - 1) % POINTS]
    const b = c[i]
    const d = c[(i + 1) % POINTS]
    length += Math.hypot(d.x - b.x, d.y - b.y)
    // radius of the circle through three neighbouring points
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bd = Math.hypot(d.x - b.x, d.y - b.y)
    const ad = Math.hypot(d.x - a.x, d.y - a.y)
    const cross = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x))
    const radius = cross < 1e-9 ? Infinity : (ab * bd * ad) / (2 * cross)
    tightest = Math.min(tightest, radius)
  }
  if (tightest < minRadius) return 'corner too tight (' + tightest.toFixed(0) + ' px)'
  if (length < MIN_LENGTH || length > MAX_LENGTH) return 'length ' + length.toFixed(0) + ' px'
  for (let i = 0; i < POINTS; i++) {
    for (let j = i + 1; j < POINTS; j++) {
      const apart = Math.min(j - i, POINTS - (j - i))
      if (apart <= 20) continue
      if (Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) < MIN_GAP) return 'road touches itself'
    }
  }
  for (const p of [...track.leftWall, ...track.rightWall]) {
    if (p.x < CANVAS.margin || p.x > CANVAS.w - CANVAS.margin) return 'off screen'
    if (p.y < CANVAS.margin || p.y > CANVAS.h - CANVAS.margin) return 'off screen'
  }
  return null
}

// ---------- THE TRACK GENERATOR ----------
// Draws a closed curve whose distance from the centre wobbles by several waves at once.
// difficulty 0 = gentle rounded loops, 1 = lumpy tracks with tight corners and chicanes.
// Same seed + difficulty in = same track out. Tries random shapes until one passes the checks.
export function makeTrack(seed: number, difficulty = 0.5, minRadius: number = MIN_CORNER_RADIUS): Track {
  const rng = makeRng(seed * 7919 + 13)
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo)
  const FINE = 2400
  for (let attempt = 0; attempt < 800; attempt++) {
    const squash = between(0.55, 0.75) // how much flatter than wide
    const waves: { k: number; amp: number; phase: number }[] = []
    for (let k = 2; k <= 7; k++) {
      waves.push({ k, amp: (difficulty * 0.3 * rng()) / Math.pow(k, 0.5), phase: between(0, Math.PI * 2) })
    }
    // 1. a finely sampled version of the curve
    const fine: Point[] = []
    for (let i = 0; i < FINE; i++) {
      const t = (i / FINE) * Math.PI * 2
      let r = 1
      for (const w of waves) r += w.amp * Math.cos(w.k * t + w.phase)
      fine.push({ x: r * Math.cos(t), y: r * squash * Math.sin(t) })
    }
    // 2. scale and centre it to fill the screen (leaving room for the walls)
    const xs = fine.map((p) => p.x)
    const ys = fine.map((p) => p.y)
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    const scale = Math.min((CANVAS.w - 2 * (HALF_WIDTH + 14)) / w, (CANVAS.h - 2 * (HALF_WIDTH + 14)) / h)
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2
    const my = (Math.max(...ys) + Math.min(...ys)) / 2
    const placed = fine.map((p) => ({ x: 400 + (p.x - mx) * scale, y: 250 + (p.y - my) * scale }))
    // 3. keep POINTS points, evenly spaced along the curve (so checkpoints are evenly spaced)
    let total = 0
    const cum = [0]
    for (let i = 1; i <= FINE; i++) {
      const a = placed[i - 1]
      const b = placed[i % FINE]
      total += Math.hypot(b.x - a.x, b.y - a.y)
      cum.push(total)
    }
    const pts: Point[] = []
    let j = 0
    for (let i = 0; i < POINTS; i++) {
      const target = (i / POINTS) * total
      while (cum[j + 1] < target) j++
      const f = (target - cum[j]) / (cum[j + 1] - cum[j])
      const a = placed[j]
      const b = placed[(j + 1) % FINE]
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
    }
    const track = buildTrack(pts)
    if (trackProblem(track, minRadius) === null) return track
  }
  // Very rarely a seed cannot make a valid shape at this difficulty: ease off and try again
  if (difficulty < 0.05) throw new Error('could not generate a valid track for seed ' + seed)
  return makeTrack(seed, difficulty * 0.8, minRadius)
}