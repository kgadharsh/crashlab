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

export type Build = {
  sensors: Sensors
  balance: number // car setup: 0 = all grip, 1 = all top speed
  reward: Reward
  practice: number[] // ids of the practice tracks to train on
}

export const LIMITS = {
  count: [3, 9],
  spread: [60, 200],
  practice: [1, 6],
} as const

export const DEFAULT_BUILD: Build = {
  sensors: { count: 5, spread: 120 },
  balance: 0.5,
  reward: { pace: 0, safety: 0, smooth: 0 },
  practice: [0, 1, 2, 3],
}

// The training budget is counted in simulated driving steps (60 per second of driving),
// so a fast computer gives no advantage. More practice tracks spend it faster.
export const TRAINING_BUDGET = 30_000_000 // about 2 minutes of training on a laptop
export const POPULATION = 100

// ---------- THE BRAIN'S SHAPE FOLLOWS THE SENSORS ----------
export const HIDDEN = 5
export const OUTPUTS = 2 // steering, throttle
export type Shape = { inputs: number; hidden: number; outputs: number }
export const shapeOf = (s: Sensors): Shape => ({ inputs: s.count + 1, hidden: HIDDEN, outputs: OUTPUTS }) // rays + speed
export const genomeLength = (sh: Shape) => sh.hidden * sh.inputs + sh.hidden + sh.outputs * sh.hidden + sh.outputs

// ---------- WHAT THE CHOICES DO TO THE CAR ----------
export type CarSpec = {
  rayAngles: number[] // radians, relative to the car's heading
  rayRange: number
  maxSpeed: number
  gripSpeed: number // above this speed the tyres lose turning power
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function rayAngles(s: Sensors): number[] {
  const half = s.spread / 2
  return Array.from({ length: s.count }, (_, i) => ((-half + (i * s.spread) / (s.count - 1)) * Math.PI) / 180)
}

// balance 0.5 is the original car: top speed 6 and grip up to speed 3
export function specOf(b: Build): CarSpec {
  return {
    rayAngles: rayAngles(b.sensors),
    rayRange: RAY_RANGE,
    maxSpeed: lerp(5, 7, b.balance),
    gripSpeed: lerp(3.5, 2.5, b.balance),
  }
}

export const DEFAULT_SPEC = specOf(DEFAULT_BUILD)

// ---------- CHECKING A BUILD (for loaded files, and later for the server) ----------
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const within = (v: unknown, [lo, hi]: readonly [number, number]) => isNum(v) && v >= lo && v <= hi

// Returns why a build is not allowed, or null if it is fine
export function buildProblem(b: unknown, practiceCount: number): string | null {
  const d = b as Build
  if (!d || typeof d !== 'object' || !d.sensors || !d.reward || !Array.isArray(d.practice)) return 'missing parts'
  const s = d.sensors
  if (!within(s.count, LIMITS.count) || !Number.isInteger(s.count)) return 'ray count out of range'
  if (!within(s.spread, LIMITS.spread)) return 'ray spread out of range'
  if (!within(d.balance, [0, 1])) return 'car setup out of range'
  for (const k of ['pace', 'safety', 'smooth'] as const) if (!within(d.reward[k], [0, 1])) return 'reward out of range'
  const p = d.practice
  if (p.length < LIMITS.practice[0] || p.length > LIMITS.practice[1]) return 'wrong number of practice tracks'
  if (new Set(p).size !== p.length || p.some((id) => !Number.isInteger(id) || id < 0 || id >= practiceCount)) return 'unknown practice track'
  return null
}

// A build with only the fields this version knows, so old saved data compares cleanly
export function cleanBuild(b: Build): Build {
  return {
    sensors: { count: b.sensors.count, spread: b.sensors.spread },
    balance: b.balance,
    reward: { pace: b.reward.pace, safety: b.reward.safety, smooth: b.reward.smooth },
    practice: [...b.practice],
  }
}
