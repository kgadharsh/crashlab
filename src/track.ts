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
const MAX_LENGTH = 1500
const CANVAS = { w: 800, h: 500, margin: 8 }

// Returns why the track is unusable, or null if it is fine
export function trackProblem(track: Track): string | null {
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
  if (tightest < MIN_CORNER_RADIUS) return 'corner too tight (' + tightest.toFixed(0) + ' px)'
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
// Same seed in = same track out. Tries random shapes until one passes the checks.
export function makeTrack(seed: number): Track {
  const rng = makeRng(seed * 7919 + 13)
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo)
  for (let attempt = 0; attempt < 500; attempt++) {
    const width = between(235, 270)
    const height = between(135, 160)
    const a2 = between(0, 30)
    const a3 = between(0, 30)
    const a4 = between(0, 0.07)
    const p2 = between(0, Math.PI * 2)
    const p3 = between(0, Math.PI * 2)
    const p4 = between(0, Math.PI * 2)
    const pts: Point[] = []
    for (let i = 0; i < POINTS; i++) {
      const t = (i / POINTS) * Math.PI * 2
      const wobble = 1 + a4 * Math.cos(4 * t + p4)
      pts.push({
        x: 400 + (width + a2 * Math.cos(2 * t + p2)) * wobble * Math.cos(t),
        y: 250 + (height + a3 * Math.sin(3 * t + p3)) * wobble * Math.sin(t),
      })
    }
    const track = buildTrack(pts)
    if (trackProblem(track) === null) return track
  }
  throw new Error('could not generate a valid track for seed ' + seed)
}