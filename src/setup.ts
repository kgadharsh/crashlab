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

// Parts: extra pieces of kit a player unlocks (see parts.ts). Each is a trade-off, not a strict upgrade, so a
// newcomer without them can still win, and a player who fakes an unlock gains nothing unfair.
export type Parts = {
  eyes?: boolean // long-range eyes: rays see much further, but a near wall reads as a smaller number and the car is a little heavier
  tyres?: boolean // wet tyres: far more grip on a wet road, a lower top speed on a dry one
  brain?: boolean // bigger brain: more hidden neurons, so more to learn in the same budget
  grip?: boolean // grip sense: the brain feels how close the tyres are to letting go
}
export const PART_IDS = ['eyes', 'tyres', 'brain', 'grip'] as const

export type Build = {
  sensors: Sensors
  balance: number // car setup: 0 = all grip, 1 = all top speed
  reward: Reward
  practice: number[] // ids of the practice tracks to train on
  weather?: Weather // left out means dry, so every earlier car and build stays valid
  parts?: Parts // left out means none, so every earlier car and build stays valid
  perks?: { nitro?: boolean } // an experiment (scripts/nitroCheck.ts), not a garage choice: it is not saved with a car
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
export const TRAINING_BUDGET = 30_000_000 // about 75 s on one laptop thread and about 25 s on four, depending on the build; longer on a phone
export const KEEP_TRAINING_SHARE = 0.3 // carrying on from a car spends this share of the budget
export const POPULATION = 100
export const REPLAY_EVERY = 10 // while watching, every 10th generation is replayed on screen

// ---------- THE BRAIN'S SHAPE FOLLOWS THE SENSORS ----------
export const HIDDEN = 5
export const BIG_HIDDEN = 9 // with the bigger brain
export const LONG_RAY_RANGE = 320 // with long-range eyes
export const EYES_TOP_SPEED = 0.97 // long-range eyes weigh a little
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
  return { inputs: base.inputs + (b.parts?.grip ? 1 : 0), hidden: b.parts?.brain ? BIG_HIDDEN : HIDDEN, outputs: base.outputs }
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
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function rayAngles(s: Sensors): number[] {
  const half = s.spread / 2
  return Array.from({ length: s.count }, (_, i) => ((-half + (i * s.spread) / (s.count - 1)) * Math.PI) / 180)
}

// balance 0.5 is the original car: top speed 6 and grip up to speed 3
export function specOf(b: Build): CarSpec {
  const p = b.parts ?? {}
  const maxSpeed = lerp(5, 7, b.balance)
  return {
    rayAngles: rayAngles(b.sensors),
    rayRange: p.eyes ? LONG_RAY_RANGE : RAY_RANGE,
    maxSpeed: maxSpeed * (p.eyes ? EYES_TOP_SPEED : 1) * (p.grip ? GRIP_TOP_SPEED : 1),
    gripSpeed: lerp(3.5, 2.5, b.balance),
    nitro: !!b.perks?.nitro,
    ...(p.tyres ? { wetTyres: true } : {}),
    ...(p.grip ? { gripSense: true } : {}),
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
  if (d.weather !== undefined && !WEATHERS.includes(d.weather)) return 'unknown weather'
  if (d.parts !== undefined) {
    if (!d.parts || typeof d.parts !== 'object' || Array.isArray(d.parts)) return 'unknown parts'
    for (const [k, v] of Object.entries(d.parts)) if (!(PART_IDS as readonly string[]).includes(k) || typeof v !== 'boolean') return 'unknown parts'
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
    ...(b.parts && PART_IDS.some((k) => b.parts![k]) ? { parts: Object.fromEntries(PART_IDS.filter((k) => b.parts![k]).map((k) => [k, true])) as Parts } : {}),
  }
}
