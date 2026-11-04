import type { Point, Segment } from './sensors'
import { makeRng } from './random'

// Tracks live in a world several screens big; the camera scrolls over it
export const WORLD = { w: 2400, h: 1500 }
export const POINTS = 360 // centerline points, about 15 px apart
export const HALF_WIDTH = 45
export const CHECKPOINT_STRIDE = 6
export const CHECKPOINTS = POINTS / CHECKPOINT_STRIDE // 60 per lap

// Everything a car needs to know about the road it is driving on
export type Track = {
  centerline: Point[]
  leftWall: Point[]
  rightWall: Point[]
  walls: Segment[]
  blocks: Point[] // centres of the obstacles on the road
  longestWall: number // length of the longest wall segment (used to skip far-away walls)
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
  const walls = [...loopToSegments(leftWall), ...loopToSegments(rightWall)]
  return {
    centerline,
    leftWall,
    rightWall,
    walls,
    blocks: [],
    longestWall: Math.max(...walls.map((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))),
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

// Square obstacles made of wall segments, so rays see them and hitting one is a crash.
// Each sits off-centre at a centerline point, always on a gentle stretch: the car cannot dodge one in a bend.
// The blocks take turns between the two sides, so keeping to one side of the road never dodges them all.
export const BLOCK_HALF = 13
const BLOCK_OFFSET = 24
function addBlocks(track: Track, points: number[], side: 1 | -1 = 1): Track {
  for (const [n, i] of points.entries()) {
    const flip = n % 2 === 0 ? side : -side
    const c = track.centerline
    const before = c[(i + POINTS - 1) % POINTS]
    const after = c[(i + 1) % POINTS]
    const len = Math.hypot(after.x - before.x, after.y - before.y)
    const x = c[i].x - ((after.y - before.y) / len) * BLOCK_OFFSET * flip
    const y = c[i].y + ((after.x - before.x) / len) * BLOCK_OFFSET * flip
    track.blocks.push({ x, y })
    track.walls.push(
      ...loopToSegments([
        { x: x - BLOCK_HALF, y: y - BLOCK_HALF },
        { x: x + BLOCK_HALF, y: y - BLOCK_HALF },
        { x: x + BLOCK_HALF, y: y + BLOCK_HALF },
        { x: x - BLOCK_HALF, y: y + BLOCK_HALF },
      ]),
    )
  }
  track.longestWall = Math.max(track.longestWall, BLOCK_HALF * 2)
  return track
}

// The track's points from straightest to most bent, away from the start line
export const BLOCK_COUNT = 6
const BLOCK_START_GAP = 36
const BLOCK_SPACING = 45 // points between blocks
function gentleOrder(track: Track): number[] {
  const c = track.centerline
  const heading = (i: number) => {
    const a = c[(i + POINTS) % POINTS]
    const b = c[(i + 1 + POINTS) % POINTS]
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  const bend = (i: number) => {
    let sum = 0
    for (let k = -15; k < 15; k++) {
      const turn = heading(i + k + 1) - heading(i + k)
      sum += Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
    }
    return sum
  }
  return Array.from({ length: POINTS }, (_, i) => i)
    .filter((i) => i >= BLOCK_START_GAP && i <= POINTS - BLOCK_START_GAP)
    .sort((a, b) => bend(a) - bend(b))
}
const apart = (i: number, j: number) => Math.min(Math.abs(i - j), POINTS - Math.abs(i - j))

// Up to BLOCK_COUNT points from a list (in its order), each far enough from the ones already taken
function spaced(order: number[]): number[] {
  const taken: number[] = []
  for (const i of order) {
    if (taken.every((j) => apart(i, j) >= BLOCK_SPACING)) taken.push(i)
    if (taken.length === BLOCK_COUNT) break
  }
  return taken.sort((a, b) => a - b)
}

// The gentlest stretches of a track, away from the start line and from each other
const gentlestPoints = (track: Track) => spaced(gentleOrder(track))

// The same track with its blocks moved to random gentle stretches, on random sides.
// Training uses this so a brain cannot win by remembering where the blocks are.
const GENTLE_SHARE = 0.4 // blocks go on the gentlest 40% of the track
export function moveBlocks(track: Track, rng: () => number): Track {
  const gentle = gentleOrder(track)
  const pool = gentle.slice(0, Math.round(gentle.length * GENTLE_SHARE))
  const shuffled = pool.map((i) => ({ i, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.i)
  const bare = { ...track, blocks: [], walls: track.walls.slice(0, track.walls.length - 4 * track.blocks.length) }
  return addBlocks(bare, spaced(shuffled), rng() < 0.5 ? 1 : -1)
}

// ---------- THE ORIGINAL TRACK (the one you have been driving on) ----------
function defaultCenterline(): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < POINTS; i++) {
    const t = (i / POINTS) * Math.PI * 2
    pts.push({
      x: WORLD.w / 2 + (950 + 60 * Math.cos(2 * t) + 45 * Math.cos(5 * t + 1)) * Math.cos(t),
      y: WORLD.h / 2 + (560 + 50 * Math.sin(3 * t) + 40 * Math.sin(4 * t)) * Math.sin(t),
    })
  }
  return pts
}
const homeBase = buildTrack(defaultCenterline())
export const DEFAULT_TRACK: Track = addBlocks(homeBase, gentlestPoints(homeBase))

// ---------- CHECKING A TRACK IS FAIR ----------
const MIN_CORNER_RADIUS = 65 // tighter than this and the car cannot physically turn
const MIN_GAP = 2 * HALF_WIDTH + 30 // two far-apart parts of the road must not touch
const MIN_LENGTH = 4000
const MAX_LENGTH = 8500
const CANVAS = { w: WORLD.w, h: WORLD.h, margin: 8 }

// Total length and tightest corner radius of a track's centerline
export function trackStats(track: Track): { length: number; tightest: number } {
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
  return { length, tightest }
}

// Returns why the track is unusable, or null if it is fine
export function trackProblem(track: Track, minRadius: number = MIN_CORNER_RADIUS): string | null {
  const c = track.centerline
  const { length, tightest } = trackStats(track)
  if (tightest < minRadius) return 'corner too tight (' + tightest.toFixed(0) + ' px)'
  if (length < MIN_LENGTH || length > MAX_LENGTH) return 'length ' + length.toFixed(0) + ' px'
  for (let i = 0; i < POINTS; i++) {
    for (let j = i + 1; j < POINTS; j++) {
      const apart = Math.min(j - i, POINTS - (j - i))
      if (apart <= 60) continue
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
// A big track needs higher waves for its corners to be as tight as on a small one
const WAVES = 14
const WAVE_SIZE = 0.3
const WAVE_FALL = 0.9
export function makeTrack(seed: number, difficulty = 0.5, minRadius: number = MIN_CORNER_RADIUS): Track {
  const rng = makeRng(seed * 7919 + 13)
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo)
  const FINE = 4800
  for (let attempt = 0; attempt < 800; attempt++) {
    const squash = between(0.55, 0.75) // how much flatter than wide
    const waves: { k: number; amp: number; phase: number }[] = []
    for (let k = 2; k <= WAVES; k++) {
      waves.push({ k, amp: (difficulty * WAVE_SIZE * rng()) / Math.pow(k, WAVE_FALL), phase: between(0, Math.PI * 2) })
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
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2
    const my = (Math.max(...ys) + Math.min(...ys)) / 2
    const scale = Math.min((CANVAS.w - 2 * (HALF_WIDTH + 14)) / w, (CANVAS.h - 2 * (HALF_WIDTH + 14)) / h)
    const placed = fine.map((p) => ({ x: WORLD.w / 2 + (p.x - mx) * scale, y: WORLD.h / 2 + (p.y - my) * scale }))
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
    if (trackProblem(track, minRadius) === null) return addBlocks(track, gentlestPoints(track), seed % 2 === 0 ? 1 : -1)
  }
  // Very rarely a seed cannot make a valid shape at this difficulty: ease off and try again
  if (difficulty < 0.05) throw new Error('could not generate a valid track for seed ' + seed)
  return makeTrack(seed, difficulty * 0.8, minRadius)
}

// ---------- THE PRACTICE TRACKS ----------
// Track 0 is the home circuit. The rest are generated, from gentle to wild.
// Each one is built the first time it is asked for, so nothing waits on startup.
export const PRACTICE_COUNT = 12
const practice: Track[] = []
export function practiceTrack(id: number): Track {
  if (id === 0) return DEFAULT_TRACK
  return (practice[id] ??= makeTrack(500 + id, 0.35 + (0.65 * (practiceLevel(id) ?? 0)) / 3))
}

// How twisty a generated practice track is: 0 gentle to 3 wild (null for the home circuit)
export const practiceLevel = (id: number): number | null => (id === 0 ? null : (id - 1) % 4)
