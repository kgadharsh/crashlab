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
  grip?: number // how well the road holds the tyres: 1 or left out is dry, lower is wetter (it multiplies the car's grip speed)
  night?: boolean // rays without headlights reach only NIGHT_RANGE
  ice?: [number, number][] // ice patches: from one checkpoint up to (not including) another
}

// The same track on a wet road (it keeps its blocks, and so do its mirrored and backwards versions)
export const WET_GRIP = 0.75
export const wetTrack = (track: Track, grip = WET_GRIP): Track => ({ ...track, grip })

// ---------- CONDITIONS (the Weekly Grand Prix brings them, and a player can practise in them) ----------
export const NIGHT_RANGE = 110 // how far a ray sees at night without headlights
export const ICE_GRIP = 0.45 // ice multiplies the grip speed by this
export const STUDS_ICE_GRIP = 0.9 // and by this with ice studs
const ICE_PATCHES = 3
const ICE_LENGTH = 5 // checkpoints, about 450 px
export type Conditions = { night?: boolean; ice?: boolean }
// A track with conditions added. The ice patches come from the seed, spread round the lap and never on the start.
export function withConditions(track: Track, c: Conditions | undefined, seed: number): Track {
  if (!c?.night && !c?.ice) return track
  const out: Track = { ...track }
  if (c.night) out.night = true
  if (c.ice) {
    const rng = makeRng(seed * 31 + 7)
    const share = Math.floor((CHECKPOINTS - 6) / ICE_PATCHES)
    out.ice = Array.from({ length: ICE_PATCHES }, (_, i) => {
      const a = 6 + i * share + Math.floor(rng() * (share - ICE_LENGTH))
      return [a, a + ICE_LENGTH] as [number, number]
    })
  }
  return out
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
// Each sits off-centre at a centerline point, always on a nearly straight stretch: a car cannot
// dodge one in a bend (on 4 Nov 2026 a block mid-bend stopped all 80 cars tested on one track).
// It nearly closes one side of the road and leaves the other side about 60 px wide, for a 24 px car.
// The blocks take turns between the two sides, so keeping to one side of the road never dodges them all.
export const BLOCK_HALF = 13
const BLOCK_OFFSET = 30
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

// The track's points from straightest to most bent, away from the start line, leaving out any
// point within BLOCK_CLEAR points of a bend tighter than BLOCK_MIN_RADIUS. A twisty track
// therefore gets fewer blocks, never impossible ones.
export const BLOCK_COUNT = 6
const BLOCK_START_GAP = 36
const BLOCK_MIN_RADIUS = 300
const BLOCK_CLEAR = 10
const straightEnough = new WeakMap<Point[], boolean[]>()
function blockable(track: Track): boolean[] {
  const cached = straightEnough.get(track.centerline)
  if (cached) return cached
  const radii = bendRadii(track)
  const ok = radii.map((_, i) => {
    for (let k = -BLOCK_CLEAR; k <= BLOCK_CLEAR; k++) if (radii[(i + k + POINTS) % POINTS] < BLOCK_MIN_RADIUS) return false
    return true
  })
  straightEnough.set(track.centerline, ok)
  return ok
}
function gentleOrder(track: Track): number[] {
  const ok = blockable(track)
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
    .filter((i) => i >= BLOCK_START_GAP && i <= POINTS - BLOCK_START_GAP && ok[i])
    .sort((a, b) => bend(a) - bend(b))
}
const apart = (i: number, j: number) => Math.min(Math.abs(i - j), POINTS - Math.abs(i - j))

// Up to count points from a list (in its order), each far enough from the ones already taken.
// The more blocks, the closer together they may be.
const GENTLE_SHARE = 0.4 // blocks go on the gentlest 40% of the track
const spacingFor = (count: number) => Math.max(12, Math.floor((POINTS * GENTLE_SHARE) / count))
function spaced(order: number[], count: number): number[] {
  const taken: number[] = []
  const gap = spacingFor(count)
  for (const i of order) {
    if (taken.every((j) => apart(i, j) >= gap)) taken.push(i)
    if (taken.length === count) break
  }
  return taken.sort((a, b) => a - b)
}

// The gentlest stretches of a track, away from the start line and from each other
const gentlestPoints = (track: Track, count = BLOCK_COUNT) => spaced(gentleOrder(track), count)

// The same track with the same number of blocks, moved to random gentle stretches on random sides.
// Training uses this so a brain cannot win by remembering where the blocks are.
export function moveBlocks(track: Track, rng: () => number): Track {
  const gentle = gentleOrder(track)
  const pool = gentle.slice(0, Math.round(gentle.length * GENTLE_SHARE))
  const shuffled = pool.map((i) => ({ i, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.i)
  const bare = { ...track, blocks: [], walls: track.walls.slice(0, track.walls.length - 4 * track.blocks.length) }
  return addBlocks(bare, spaced(shuffled, track.blocks.length), rng() < 0.5 ? 1 : -1)
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
// A style says which waves (low = big sweeping bends, high = tight wiggles), how strong they
// are, how flat the loop is (flat = long straights with hairpins at the ends) and how many blocks.
// Same seed + style in = same track out. Tries random shapes until one passes the checks.
export type TrackStyle = { kMin: number; kMax: number; size: number; fall: number; squash: [number, number]; blocks: number }

// The old difficulty dial (0 gentle to 1 wild), still used for race tracks
export const styleFor = (difficulty: number): TrackStyle => ({ kMin: 2, kMax: 14, size: 0.3 * difficulty, fall: 0.9, squash: [0.55, 0.75], blocks: BLOCK_COUNT })

export function makeTrack(seed: number, difficulty = 0.5, minRadius: number = MIN_CORNER_RADIUS): Track {
  return makeStyledTrack(seed, styleFor(difficulty), minRadius)
}

export function makeStyledTrack(seed: number, style: TrackStyle, minRadius: number = MIN_CORNER_RADIUS): Track {
  const rng = makeRng(seed * 7919 + 13)
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo)
  const FINE = 4800
  for (let attempt = 0; attempt < 800; attempt++) {
    const squash = between(style.squash[0], style.squash[1]) // how much flatter than wide
    const waves: { k: number; amp: number; phase: number }[] = []
    for (let k = style.kMin; k <= style.kMax; k++) {
      waves.push({ k, amp: (style.size * rng()) / Math.pow(k, style.fall), phase: between(0, Math.PI * 2) })
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
    if (trackProblem(track, minRadius) === null) return addBlocks(track, gentlestPoints(track, style.blocks), seed % 2 === 0 ? 1 : -1)
  }
  // Very rarely a seed cannot make a valid shape in this style: ease off and try again
  if (style.size < 0.01) throw new Error('could not generate a valid track for seed ' + seed)
  return makeStyledTrack(seed, { ...style, size: style.size * 0.8 }, minRadius)
}

// ---------- THE PRACTICE TRACKS ----------
// Eight tracks, each with its own character, so picking practice tracks is a real choice.
// Track 0 is the home circuit. Each is built the first time it is asked for.
export const PRACTICE: { name: string; seed: number; style: TrackStyle | null }[] = [
  { name: 'Home Circuit', seed: 0, style: null },
  { name: 'Hairpin Valley', seed: 601, style: { kMin: 4, kMax: 8, size: 0.4, fall: 0.2, squash: [0.6, 0.75], blocks: 4 } },
  { name: 'Fast Sweepers', seed: 602, style: { kMin: 2, kMax: 4, size: 0.32, fall: 0.3, squash: [0.6, 0.7], blocks: 3 } },
  { name: 'Block Alley', seed: 603, style: { kMin: 2, kMax: 6, size: 0.12, fall: 0.8, squash: [0.6, 0.7], blocks: 14 } },
  { name: 'Long Straights', seed: 604, style: { kMin: 2, kMax: 3, size: 0.05, fall: 0.5, squash: [0.34, 0.4], blocks: 4 } },
  { name: 'Chicanes', seed: 601, style: { kMin: 9, kMax: 14, size: 0.1, fall: 0.2, squash: [0.6, 0.72], blocks: 5 } },
  { name: 'Technical', seed: 606, style: { kMin: 2, kMax: 14, size: 0.36, fall: 0.8, squash: [0.55, 0.75], blocks: 8 } },
  { name: 'Grand Loop', seed: 607, style: { kMin: 2, kMax: 10, size: 0.18, fall: 0.9, squash: [0.6, 0.75], blocks: 6 } },
  // Four more, with the feel of famous circuits (the generator draws loops, so these are not copies of real ones).
  // They are only for practice and the track board: the Grand Prix is built from the first eight (CORE_PRACTICE).
  { name: 'Temple Straight', seed: 802, style: { kMin: 2, kMax: 12, size: 0.07, fall: 0.9, squash: [0.34, 0.4], blocks: 3 } }, // a very long straight into a tight bend
  { name: 'Harbour Streets', seed: 815, style: { kMin: 3, kMax: 9, size: 0.3, fall: 0.35, squash: [0.5, 0.65], blocks: 9 } }, // twisty and walled in
  { name: 'Flowing Esses', seed: 802, style: { kMin: 5, kMax: 8, size: 0.22, fall: 0.4, squash: [0.55, 0.7], blocks: 4 } }, // bend after bend
  { name: 'Stadium Loop', seed: 803, style: { kMin: 2, kMax: 5, size: 0.26, fall: 0.3, squash: [0.45, 0.55], blocks: 3 } }, // big, fast and open
]
// The first eight practice tracks are the original set. The Grand Prix tracks are made from their styles
// (see race.ts), so tracks added after them must never change that set or its medals.
export const CORE_PRACTICE = 8
export const PRACTICE_COUNT = PRACTICE.length
const practice: Track[] = []
// A practice track on a dry or a wet road. The wet ones are made once and kept, so a track is always the same object.
const wetPractice = new Map<string, Track>()
export function practiceOnRoad(id: number, wet: boolean, cond?: Conditions): Track {
  if (!wet && !cond?.night && !cond?.ice) return practiceTrack(id)
  const key = id + (wet ? 'w' : 'd') + (cond?.night ? 'n' : '') + (cond?.ice ? 'i' : '')
  let t = wetPractice.get(key)
  if (!t) wetPractice.set(key, (t = withConditions(wet ? wetTrack(practiceTrack(id)) : practiceTrack(id), cond, id + 1)))
  return t
}
export function practiceTrack(id: number): Track {
  const p = PRACTICE[id]
  return (practice[id] ??= p.style ? makeStyledTrack(p.seed, p.style) : DEFAULT_TRACK)
}

// ---------- WHAT A TRACK HAS IN IT (measured, for the labels) ----------
// Radius of the bend at each point, measured over a few points either side so it is not noisy
export function bendRadii(track: Track): number[] {
  const c = track.centerline
  const K = 4
  return c.map((b, i) => {
    const a = c[(i + POINTS - K) % POINTS]
    const d = c[(i + K) % POINTS]
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bd = Math.hypot(d.x - b.x, d.y - b.y)
    const ad = Math.hypot(d.x - a.x, d.y - a.y)
    const cross = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x))
    return cross < 1e-9 ? Infinity : (ab * bd * ad) / (2 * cross)
  })
}

// Runs of neighbouring points where test() holds, going round the loop: how many, and the longest
function runs(values: number[], test: (v: number) => boolean): { count: number; longest: number } {
  const n = values.length
  const start = values.findIndex((v) => !test(v))
  if (start < 0) return { count: 1, longest: n }
  let count = 0
  let longest = 0
  let run = 0
  for (let k = 1; k <= n; k++) {
    if (test(values[(start + k) % n])) run++
    else {
      if (run > 0) count++
      longest = Math.max(longest, run)
      run = 0
    }
  }
  return { count, longest }
}

export const HAIRPIN_RADIUS = 110 // a bend tighter than this needs hard braking
const STRAIGHT_RADIUS = 900
export function trackFeatures(track: Track) {
  const radii = bendRadii(track)
  const { length } = trackStats(track)
  return {
    length,
    hairpins: runs(radii, (r) => r < HAIRPIN_RADIUS).count,
    longestStraight: runs(radii, (r) => r > STRAIGHT_RADIUS).longest * (length / POINTS),
    blocks: track.blocks.length,
  }
}

// ---------- NEW TRACKS FROM OLD ONES ----------
// A track mirrored left to right, driven backwards, or both: the same kinds of bends and
// blocks, but turning the other way round and in a new order. Judging a car on these shows
// whether it can drive or has only learned its practice tracks.
function fromCenterline(centerline: Point[], blocks: number): Track {
  const t = buildTrack(centerline)
  return addBlocks(t, gentlestPoints(t, blocks))
}
const variantCache = new WeakMap<Track, Track[]>()
export function trackVariants(track: Track): Track[] {
  const cached = variantCache.get(track)
  if (cached) return cached
  const c = track.centerline
  const backwards = (pts: Point[]) => [pts[0], ...pts.slice(1).reverse()] // same start line, lap the other way
  const mirrored = c.map((p) => ({ x: WORLD.w - p.x, y: p.y }))
  const variants = [mirrored, backwards(c), backwards(mirrored)].map((cl) => {
    const v = fromCenterline(cl, track.blocks.length)
    if (track.grip !== undefined) v.grip = track.grip // a wet track's other versions are wet too
    if (track.night) v.night = true // and so are its conditions
    if (track.ice) v.ice = track.ice
    return v
  })
  variantCache.set(track, variants)
  return variants
}
