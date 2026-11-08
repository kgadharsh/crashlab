// Everything a player chooses in the garage, and what those choices mean for the car.
// A Build is plain data, so it can be saved, sent to a server and checked there.

export type Sensors = {
  count: number // how many rays
  spread: number // degrees from the leftmost ray to the rightmost
}
// How far every ray can see, in pixels. It is not a choice: a longer ray cost nothing, so it was not a real decision.
export const RAY_RANGE = 200

// What training rewards. Each is 0 to 1. Progress round the track always counts.
export type Reward = {
  pace: number // a bonus for a high average speed
  safety: number // a penalty for crashing
  smooth: number // a penalty for jerky steering
}

// The road the practice tracks are driven on. "both" trains on every track dry and wet, so each
// generation costs twice as much of the budget.
export type Weather = 'dry' | 'wet' | 'both'
export const WEATHERS: Weather[] = ['dry', 'wet', 'both']

// The skill tree: nodes a player unlocks by playing (see parts.ts) and fits by spending points. Every car has the same
// POINT_BUDGET, so playing more opens new choices but never makes a car stronger, and each node also costs something
// on the road. A player who fakes an unlock gains nothing unfair, and the server rejects a car that spends too much.
// A node is on at level 1 (true in saved cars). Levels above 1 are allowed by the format, but no wave-1 node has them.
export type NodeId = 'range' | 'focus' | 'lens' | 'wide' | 'lights' | 'launch' | 'quick' | 'brakes' | 'turbo' | 'feather' | 'wing' | 'steady' | 'tyres' | 'inters' | 'studs' | 'brain' | 'lean' | 'huge' | 'grip' | 'slot' | 'slot2' | 'rally' | 'bumper' | 'spotter' | 'aids' | 'traction'
export const NODES: { id: NodeId; max: number; cost: number }[] = [
  { id: 'range', max: 1, cost: 2 }, // long rays: RANGE_STEP further and 3% slower (levels of 40 were tried: one or two bought nothing, scripts/nodeCheck.ts)
  { id: 'focus', max: 1, cost: 1 }, // rays bunch towards the front: more detail ahead, less to the sides
  { id: 'lens', max: 1, cost: 1 }, // two more eyes (up to 11 rays): more detail, a bigger brain to train
  { id: 'wide', max: 1, cost: 1 }, // wide-angle lens: rays may fan out to 260 degrees
  { id: 'brakes', max: 1, cost: 1 }, // carbon brakes: braking is 70% stronger, a little heavier
  { id: 'turbo', max: 2, cost: 2 }, // turbo: higher top speed, slower to build speed
  { id: 'inters', max: 1, cost: 1 }, // intermediate tyres: some wet grip, a smaller dry-road cost than wet tyres
  { id: 'lean', max: 1, cost: 1 }, // lean brain: three neurons, quick to train but limited
  { id: 'huge', max: 1, cost: 3 }, // huge brain: thirteen neurons
  { id: 'slot2', max: 1, cost: 1 }, // a second extra practice track
  { id: 'rally', max: 1, cost: 2 }, // rally tyres: slide sooner, but turning fades gently above the limit
  { id: 'bumper', max: 1, cost: 2 }, // bumper: survive one hit a track, stopping dead
  { id: 'spotter', max: 1, cost: 1 }, // ice spotter: the brain is told an ice patch is coming
  { id: 'aids', max: 1, cost: 2 }, // driver aids: the car brakes itself for a wall right ahead
  { id: 'traction', max: 1, cost: 2 }, // traction control: no power while steering hard above the grip limit
  { id: 'launch', max: 1, cost: 1 }, // quicker acceleration, lower top speed
  { id: 'quick', max: 1, cost: 2 }, // faster steering, less grip and a little lower top speed
  { id: 'feather', max: 1, cost: 2 }, // featherweight chassis: quicker off the line and in turns, tyres let go sooner
  { id: 'wing', max: 1, cost: 2 }, // the tyres hold to a higher speed, lower top speed
  { id: 'tyres', max: 1, cost: 2 }, // wet tyres: far more wet grip, lower top speed on a dry road
  { id: 'steady', max: 1, cost: 1 }, // steady steering: tyres hold a little longer, the car turns more slowly
  { id: 'studs', max: 1, cost: 1 }, // ice studs: grip on ice patches, a little slower everywhere
  { id: 'lights', max: 1, cost: 1 }, // headlights: rays see their full range at night, a little slower
  { id: 'brain', max: 1, cost: 2 }, // bigger brain: more hidden neurons, more to learn in the same budget
  { id: 'grip', max: 1, cost: 2 }, // grip sense: one more input, a little slower
  { id: 'slot', max: 1, cost: 1 }, // one more practice track
]
export const NODE_IDS = NODES.map((n) => n.id)
// Pairs that cannot both be fitted: stacked together they beat a car without them on every road (docs/experiments.md, 8 Nov 2026)
export const EXCLUSIVE: [NodeId, NodeId][] = [['quick', 'feather']]
export const rivalOf = (id: NodeId): NodeId | null => EXCLUSIVE.flatMap(([a, c]) => (a === id ? [c] : c === id ? [a] : []))[0] ?? null
export const POINT_BUDGET = 10
// What a car has fitted: a level per node. "eyes" is long-range eyes from before the tree, read as ray range 3.
export type Parts = Partial<Record<NodeId | 'eyes', number | boolean>>
export const PART_IDS = NODE_IDS // the old name, still used by saved data checks
export function levelOf(p: Parts | undefined, id: NodeId): number {
  if (!p) return 0
  if (id === 'range' && p.eyes) return 1
  const v = p[id]
  return v === true ? 1 : typeof v === 'number' ? v : 0
}
export const pointsUsed = (p: Parts | undefined) => NODES.reduce((sum, n) => sum + levelOf(p, n.id) * n.cost, 0)

// ---------- CHASSIS ----------
// Each frame trades strengths for weaknesses, and none is meant to be better than the plain Classic frame overall: a
// frame is a different car to drive, not a stronger one (scripts/chassisCheck.ts trains each and races it against Classic).
// The server cannot check which frames a player has unlocked, which is fine because none is a strict upgrade.
// Brawler, Cruiser, Dragster and Hawk were tried and left out (docs/experiments.md, 8 Nov 2026).
export type ChassisId = 'sprinter' | 'tourer' | 'drifter' | 'dancer' | 'scout'
export type Chassis = { id: ChassisId; name: string; blurb: string; stars: number; top: number; grip: number; accel: number; turn: number; range: number }
export const CHASSIS: Chassis[] = [
  { id: 'sprinter', name: 'Sprinter', blurb: 'Leaps off the line. Lower top speed and grip.', stars: 8, top: 0.93, grip: 0.93, accel: 1.35, turn: 1, range: 1 },
  { id: 'tourer', name: 'Tourer', blurb: 'Holds bends at speed. Lower top speed, slower to steer.', stars: 15, top: 0.92, grip: 1.14, accel: 0.95, turn: 0.95, range: 1 },
  { id: 'drifter', name: 'Drifter', blurb: 'Punchy and agile, but it slides early in bends.', stars: 23, top: 1, grip: 0.88, accel: 1.2, turn: 1.2, range: 1 },
  { id: 'dancer', name: 'Dancer', blurb: 'Turns on a coin. The car starts to slide at a lower speed in bends.', stars: 30, top: 0.98, grip: 0.9, accel: 1, turn: 1.15, range: 1 },
  { id: 'scout', name: 'Scout', blurb: 'Sees a fifth further. A little slower overall.', stars: 41, top: 0.96, grip: 1.04, accel: 1, turn: 1.05, range: 1.2 },
]
export const chassisOf = (id: ChassisId | undefined) => CHASSIS.find((c) => c.id === id)

export type Build = {
  sensors: Sensors
  balance: number // car setup: 0 = all grip, 1 = all top speed
  reward: Reward
  practice: number[] // ids of the practice tracks to train on
  weather?: Weather // left out means dry, so every earlier car and build stays valid
  parts?: Parts // left out means none, so every earlier car and build stays valid
  cond?: { night?: true; ice?: true } // practice conditions besides the road: night (short rays without headlights) and ice patches
  chassis?: ChassisId // the car's frame: a different mix of speed, grip, acceleration and steering. Left out means the Classic frame
  perks?: { nitro?: boolean } // an experiment (scripts/nitroCheck.ts), not a garage choice: it is not saved with a car
}

export const LIMITS = {
  count: [3, 9],
  spread: [60, 200],
  practice: [1, 6],
} as const
// the practice slot node allows one more
export const maxPractice = (b: Build) => LIMITS.practice[1] + levelOf(b.parts, 'slot') + levelOf(b.parts, 'slot2')
// the extra eyes node allows two more rays
export const LENS_RAYS = 2
export const WIDE_SPREAD = 60 // the wide-angle lens widens the fan by this many degrees
export const maxSpread = (parts: Parts | undefined) => LIMITS.spread[1] + WIDE_SPREAD * levelOf(parts, 'wide')
export const maxRays = (parts: Parts | undefined) => LIMITS.count[1] + LENS_RAYS * levelOf(parts, 'lens')

export const DEFAULT_BUILD: Build = {
  sensors: { count: 5, spread: 120 },
  balance: 0.5,
  reward: { pace: 0, safety: 0, smooth: 0 },
  practice: [0, 1, 2, 3],
}

// The training budget is counted in simulated driving steps (60 per second of driving),
// so a fast computer gives no advantage. More practice tracks spend it faster.
export const TRAINING_BUDGET = 30_000_000 // about 75 s on one laptop thread and about 25 s on four, depending on the build; longer on a phone
export const KEEP_TRAINING_SHARE = 0.3 // carrying on from a car spends this share of the budget
export const POPULATION = 100
export const REPLAY_EVERY = 10 // while watching, every 10th generation is replayed on screen

// ---------- THE BRAIN'S SHAPE FOLLOWS THE SENSORS ----------
export const HIDDEN = 5
export const BIG_HIDDEN = 9 // with the bigger brain
export const RANGE_STEP = 120 // long rays see 320, like the old long-range eyes
export const RANGE_TOP_SPEED = 0.03 // and cost the old eyes' 3% of top speed
export const FOCUS_POWER = 1.7 // focused rays: angle = spread * t^1.7, so they bunch towards the front
export const FEATHER_ACCEL = 1.2
export const FEATHER_TURN = 1.15
export const FEATHER_GRIP = 0.93 // the tyres let go at a lower speed: it is light
export const STEADY_GRIP = 1.08
export const STEADY_TURN = 0.9 // so the car turns more slowly
export const TURBO_TOP = 1.04 // per level
export const TURBO_ACCEL = 0.85 // per level: slower to build speed
export const BRAKE_FORCE = 1.7
export const BRAKES_TOP_SPEED = 0.98
export const INTERS_GRIP = 1.2
export const INTERS_DRY_SPEED = 0.97
export const LEAN_HIDDEN = 3
export const HUGE_HIDDEN = 13
export const RALLY_GRIP = 0.875 // between 0.9 (too strong) and 0.85 (a little weak): docs/experiments.md, 8 Nov 2026
export const RALLY_POWER = 1.25 // instead of GRIP_POWER 2: above the limit, turning fades more gently (1 too strong, 1.5 a little weak)
export const BUMPER_TOP_SPEED = 0.92 // 0.95 finished every dry race only 2 s slower
export const LAUNCH_ACCEL = 1.5
export const LAUNCH_TOP_SPEED = 0.96
export const QUICK_TURN = 1.3
export const QUICK_TOP_SPEED = 0.97
export const QUICK_GRIP = 0.93 // without it quick steering was faster on every road (scripts/nodeCheck.ts, 7 Nov 2026)
export const WING_GRIP = 1.12
export const WING_TOP_SPEED = 0.93 // 0.95 was faster on dry roads in all 3 trainings (7 Nov 2026)
export const STUDS_TOP_SPEED = 0.97
export const LIGHTS_TOP_SPEED = 0.98
export const GRIP_TOP_SPEED = 0.97 // so does grip sense: without a cost it beat no parts on every road (scripts/partsCheck.ts, 6 Nov 2026)
export const WET_TYRE_GRIP = 1.45 // wet tyres multiply a wet road's grip by this (never above dry grip)
export const WET_TYRE_DRY_SPEED = 0.92 // and cost this share of top speed on a dry road
export const OUTPUTS = 2 // steering, throttle
export type Shape = { inputs: number; hidden: number; outputs: number }
// rays + speed; with nitro also the charge left, and a boost output
export const shapeOf = (s: Sensors, nitro = false): Shape => ({ inputs: s.count + 1 + (nitro ? 1 : 0), hidden: HIDDEN, outputs: OUTPUTS + (nitro ? 1 : 0) })
// The brain a build needs: grip sense adds an input, the bigger brain more hidden neurons
export const brainShape = (b: Build): Shape => {
  const base = shapeOf(b.sensors, !!b.perks?.nitro)
  const hidden = b.parts?.huge ? HUGE_HIDDEN : b.parts?.brain ? BIG_HIDDEN : b.parts?.lean ? LEAN_HIDDEN : HIDDEN
  return { inputs: base.inputs + (b.parts?.grip ? 1 : 0) + (b.parts?.spotter ? 1 : 0), hidden, outputs: base.outputs }
}
export const genomeLength = (sh: Shape) => sh.hidden * sh.inputs + sh.hidden + sh.outputs * sh.hidden + sh.outputs

// ---------- WHAT THE CHOICES DO TO THE CAR ----------
export type CarSpec = {
  rayAngles: number[] // radians, relative to the car's heading
  rayRange: number
  maxSpeed: number
  gripSpeed: number // above this speed the tyres lose turning power
  nitro: boolean // the car has a limited boost, and its brain a button for it
  wetTyres?: boolean // grip on a wet road is raised; top speed on a dry one is lowered
  gripSense?: boolean // the brain gets one more input: speed against the speed the tyres can turn at
  brake?: number // multiplies braking force (carbon brakes)
  gripPower?: number // how sharply turning fades above the grip speed (rally tyres)
  bumper?: boolean // survives one hit a track
  spotter?: boolean // one more input: an ice patch ahead
  aidRay?: number // driver aids: the ray that looks straight ahead
  traction?: boolean // traction control
  wetGrip?: number // what tyres multiply a wet road's grip by (wet tyres or intermediates)
  dryTop?: number // what those tyres multiply top speed by on a dry road
  rayScale?: number // what a ray's distance is divided by for the brain (left out: rayRange). Ray range keeps the
  // ordinary scale, so a near wall reads exactly as without it and the extra reach reads above 1
  accel?: number // multiplies acceleration (launch control)
  turn?: number // multiplies the steering rate (quick steering)
  studs?: boolean // ice patches hold almost like a dry road
  lights?: boolean // rays keep their full range at night
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function rayAngles(s: Sensors, focus = false): number[] {
  const half = s.spread / 2
  return Array.from({ length: s.count }, (_, i) => {
    const deg = -half + (i * s.spread) / (s.count - 1)
    const t = deg / half // -1 to 1
    return ((focus ? Math.sign(t) * Math.pow(Math.abs(t), FOCUS_POWER) * half : deg) * Math.PI) / 180
  })
}

// The ray pointing most nearly straight ahead
const middleRay = (angles: number[]) => angles.reduce((best, a, i) => (Math.abs(a) < Math.abs(angles[best]) ? i : best), 0)

// balance 0.5 is the original car: top speed 6 and grip up to speed 3
export function specOf(b: Build): CarSpec {
  const p = b.parts
  const on = (id: NodeId) => levelOf(p, id) > 0
  const range = levelOf(p, 'range')
  // a car with no nodes gets exactly the numbers it always had (each factor below is then 1)
  // (applied one after another in this order, so cars from before the tree get bit-identical numbers)
  let maxSpeed = lerp(5, 7, b.balance)
  if (range) maxSpeed *= 1 - RANGE_TOP_SPEED * range
  if (on('grip')) maxSpeed *= GRIP_TOP_SPEED
  if (on('launch')) maxSpeed *= LAUNCH_TOP_SPEED
  if (on('quick')) maxSpeed *= QUICK_TOP_SPEED
  if (on('wing')) maxSpeed *= WING_TOP_SPEED
  if (on('studs')) maxSpeed *= STUDS_TOP_SPEED
  if (on('lights')) maxSpeed *= LIGHTS_TOP_SPEED
  if (on('brakes')) maxSpeed *= BRAKES_TOP_SPEED
  if (on('bumper')) maxSpeed *= BUMPER_TOP_SPEED
  if (levelOf(p, 'turbo')) maxSpeed *= Math.pow(TURBO_TOP, levelOf(p, 'turbo'))
  let gripSpeed = lerp(3.5, 2.5, b.balance)
  if (on('wing')) gripSpeed *= WING_GRIP
  if (on('quick')) gripSpeed *= QUICK_GRIP
  if (on('feather')) gripSpeed *= FEATHER_GRIP
  if (on('steady')) gripSpeed *= STEADY_GRIP
  if (on('rally')) gripSpeed *= RALLY_GRIP
  // nodes that change acceleration or steering rate stack, and a car with none of them gets exactly what it always had
  let accel = 1
  if (on('launch')) accel *= LAUNCH_ACCEL
  if (on('feather')) accel *= FEATHER_ACCEL
  if (levelOf(p, 'turbo')) accel *= Math.pow(TURBO_ACCEL, levelOf(p, 'turbo'))
  let turn = 1
  if (on('quick')) turn *= QUICK_TURN
  if (on('feather')) turn *= FEATHER_TURN
  if (on('steady')) turn *= STEADY_TURN
  // the frame is applied last, so a car with the Classic frame gets exactly the numbers it always had
  const ch = chassisOf(b.chassis)
  if (ch) {
    maxSpeed *= ch.top
    gripSpeed *= ch.grip
    accel *= ch.accel
    turn *= ch.turn
  }
  const reach = ch ? ch.range : 1
  return {
    rayAngles: rayAngles(b.sensors, on('focus')),
    rayRange: (RAY_RANGE + RANGE_STEP * range) * reach,
    // ray range keeps the ordinary scale. Long-range eyes from before the tree squeezed every distance into 0 to 1,
    // which lost detail near walls (scripts/nodeCheck.ts: range never helped), and they keep doing so, so old cars race as they did
    ...((range && !p?.eyes) || reach !== 1 ? { rayScale: RAY_RANGE } : {}),
    maxSpeed,
    gripSpeed,
    nitro: !!b.perks?.nitro,
    ...(on('tyres') ? { wetTyres: true, wetGrip: WET_TYRE_GRIP, dryTop: WET_TYRE_DRY_SPEED } : on('inters') ? { wetTyres: true, wetGrip: INTERS_GRIP, dryTop: INTERS_DRY_SPEED } : {}),
    ...(on('brakes') ? { brake: BRAKE_FORCE } : {}),
    ...(on('rally') ? { gripPower: RALLY_POWER } : {}),
    ...(on('bumper') ? { bumper: true } : {}),
    ...(on('spotter') ? { spotter: true } : {}),
    ...(on('aids') ? { aidRay: middleRay(rayAngles(b.sensors, on('focus'))) } : {}),
    ...(on('traction') ? { traction: true } : {}),
    ...(on('grip') ? { gripSense: true } : {}),
    ...(accel !== 1 ? { accel } : {}),
    ...(turn !== 1 ? { turn } : {}),
    ...(on('studs') ? { studs: true } : {}),
    ...(on('lights') ? { lights: true } : {}),
  }
}

export const DEFAULT_SPEC = specOf(DEFAULT_BUILD)

// ---------- CHECKING A BUILD (for loaded files, and later for the server) ----------
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const within = (v: unknown, [lo, hi]: readonly [number, number]) => isNum(v) && v >= lo && v <= hi

// Returns why a build is not allowed, or null if it is fine
export function buildProblem(b: unknown, practiceCount: number): string | null {
  const d = b as Build
  if (!d || typeof d !== 'object' || !d.sensors || !d.reward || !Array.isArray(d.practice)) return 'it is incomplete'
  const s = d.sensors
  if (!within(s.count, [LIMITS.count[0], maxRays(d.parts && typeof d.parts === 'object' ? d.parts : undefined)]) || !Number.isInteger(s.count)) return 'ray count out of range'
  if (!within(s.spread, [LIMITS.spread[0], maxSpread(d.parts && typeof d.parts === 'object' ? d.parts : undefined)])) return 'ray spread out of range'
  if (!within(d.balance, [0, 1])) return 'car setup out of range'
  for (const k of ['pace', 'safety', 'smooth'] as const) if (!within(d.reward[k], [0, 1])) return 'reward out of range'
  if (d.parts !== undefined) {
    if (!d.parts || typeof d.parts !== 'object' || Array.isArray(d.parts)) return 'unknown parts'
    for (const [k, v] of Object.entries(d.parts)) {
      if (k === 'eyes' ? v !== true : !(NODE_IDS as string[]).includes(k)) return 'unknown parts'
      const max = NODES.find((n) => n.id === k)?.max ?? 1
      if (v !== true && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max)) return 'unknown parts'
    }
    if (d.parts.eyes && d.parts.range) return 'unknown parts'
    if (pointsUsed(d.parts) > POINT_BUDGET) return 'it spends more than ' + POINT_BUDGET + ' points'
    for (const [a, c] of EXCLUSIVE) if (levelOf(d.parts, a) && levelOf(d.parts, c)) return 'it fits both ' + a + ' and ' + c + ', which cannot go together'
  }
  const p = d.practice
  if (p.length < LIMITS.practice[0] || p.length > maxPractice(d)) return 'wrong number of practice tracks'
  if (new Set(p).size !== p.length || p.some((id) => !Number.isInteger(id) || id < 0 || id >= practiceCount)) return 'unknown practice track'
  if (d.chassis !== undefined && !chassisOf(d.chassis)) return 'unknown frame'
  if (d.weather !== undefined && !WEATHERS.includes(d.weather)) return 'unknown weather'
  if (d.cond !== undefined) {
    if (!d.cond || typeof d.cond !== 'object' || Object.entries(d.cond).some(([k, v]) => !(k === 'night' || k === 'ice') || v !== true)) return 'unknown conditions'
  }
  return null
}

// A build with only the fields this version knows, so old saved data compares cleanly
export function cleanBuild(b: Build): Build {
  return {
    sensors: { count: b.sensors.count, spread: b.sensors.spread },
    balance: b.balance,
    reward: { pace: b.reward.pace, safety: b.reward.safety, smooth: b.reward.smooth },
    practice: [...b.practice],
    // dry is written as nothing, so a dry build looks the same as one saved before weather existed.
    // ("both" was only an experiment and is not a garage choice, so a build that has it is read as dry)
    ...(b.weather === 'wet' ? { weather: 'wet' as const } : {}),
    // only the parts that are on, and nothing at all when none are, so a build without parts looks as it always did
    // (a level-1 node is written as true, as parts always were, and long-range eyes stay eyes, so old cars drive as they did)
    ...(pointsUsed(b.parts) ? { parts: Object.fromEntries([...(b.parts?.eyes ? [['eyes', true]] : []), ...NODE_IDS.filter((k) => (k !== 'range' || !b.parts?.eyes) && levelOf(b.parts, k)).map((k) => [k, levelOf(b.parts, k) === 1 ? true : levelOf(b.parts, k)])]) as Parts } : {}),
    ...(b.chassis && chassisOf(b.chassis) ? { chassis: b.chassis } : {}),
    // practice conditions: only the ones that are on, and nothing when none are
    ...(b.cond?.night || b.cond?.ice ? { cond: { ...(b.cond.night ? { night: true as const } : {}), ...(b.cond.ice ? { ice: true as const } : {}) } } : {}),
  }
}
