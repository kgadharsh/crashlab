import { castRay, type Point } from './sensors'
import { think, type Brain } from './brain'
import { CHECKPOINTS, CHECKPOINT_STRIDE, DEFAULT_TRACK, POINTS, type Track } from './track'
import { DEFAULT_SPEC, WET_TYRE_DRY_SPEED, WET_TYRE_GRIP, type CarSpec, type Reward } from './setup'
import { ICE_GRIP, NIGHT_RANGE, STUDS_ICE_GRIP } from './track'

export { CHECKPOINTS, CHECKPOINT_STRIDE, DEFAULT_TRACK }
export type { Track, Brain }
export type Input = { throttle: number; steer: number; boost?: boolean }

// Nitro (an experiment, only for builds that ask for it): a limited charge, spent a step at a time,
// that doubles acceleration and lifts top speed. Above the car's grip speed turning weakens as it
// speeds up, so boosting in a bend is dangerous without any extra rule.
export const NITRO_STEPS = 240 // 4 seconds of boost in a lap
const NITRO_ACCEL = 2
const NITRO_TOP = 1.35

// ---------- FIXED PHYSICS (the same for every car) ----------
export const CAR_RADIUS = 12
export const ACCEL = 0.15
export const FRICTION = 0.98
export const MAX_REVERSE = -2
export const TURN_RATE = 0.008
// Above the car's grip speed, turning weakens as the car speeds up, so you must brake before a bend.
export const GRIP_POWER = 2

// ---------- PROGRESS SETTINGS ----------
export const CHECKPOINT_RADIUS = 50
const MIN_FORWARD_SPEED = 0.5 // slower than this (or reversing) earns no checkpoints
export const STALL_STEPS = 300 // 5 seconds without a new checkpoint ends an attempt
export const MAX_STEPS = 2400 // 40 seconds is the longest training attempt (about one lap)
export const RACE_STEPS = 6000 // 100 seconds is the longest race lap

// ---------- ONE CAR ----------
export type Car = {
  track: Track // the road this car is driving on
  spec: CarSpec // its sensors and setup
  x: number
  y: number
  angle: number
  speed: number
  passed: number // checkpoints collected (keeps growing across laps)
  rays: number[] // current ray distances
  dead: boolean // true once the car has crashed
  steps: number // how many steps this attempt has lasted
  sinceProgress: number // steps since the last new checkpoint
  speedSum: number // for the average speed
  steerChange: number // total change in steering, for smoothness
  lastSteer: number
  boost: number // nitro steps left
  near: Float64Array // walls a ray could reach from nearAt, refreshed as the car moves (see nearbyWalls)
  touch: Float64Array // the few of them the car itself could touch (the crash test only needs these)
  nearAt: Point
}

export function createCar(track: Track = DEFAULT_TRACK, spec: CarSpec = DEFAULT_SPEC): Car {
  const car: Car = {
    track,
    spec,
    x: track.start.x,
    y: track.start.y,
    angle: track.start.angle,
    speed: 0,
    passed: 0,
    rays: [],
    dead: false,
    steps: 0,
    sinceProgress: 0,
    speedSum: 0,
    steerChange: 0,
    lastSteer: 0,
    boost: spec.nitro ? NITRO_STEPS : 0,
    near: new Float64Array(0),
    touch: new Float64Array(0),
    nearAt: { x: Infinity, y: Infinity },
  }
  updateRays(car)
  return car
}

export function checkpointPos(track: Track, k: number): Point {
  return track.centerline[(k % CHECKPOINTS) * CHECKPOINT_STRIDE]
}

// Is the car heading the same way the road does at this centerline point?
function movingForward(car: Car, index: number): boolean {
  if (car.speed < MIN_FORWARD_SPEED) return false
  const c = car.track.centerline
  const before = c[(index + POINTS - 1) % POINTS]
  const after = c[(index + 1) % POINTS]
  const tx = after.x - before.x
  const ty = after.y - before.y
  return Math.cos(car.angle) * tx + Math.sin(car.angle) * ty > 0
}

// Math.hypot is about ten times slower than a square root, and these distance checks run for every
// wall on every step. So work out the squared distance first: if it is clearly inside or outside
// the radius, that settles it (-1 inside, 1 outside). Only a close call (0) goes on to ask Math.hypot,
// so every answer is exactly the one Math.hypot alone would give.
function side(dx: number, dy: number, radius: number): -1 | 0 | 1 {
  const distSq = dx * dx + dy * dy
  const inner = radius - 1e-6
  const outer = radius + 1e-6
  if (distSq < inner * inner) return -1
  if (distSq > outer * outer) return 1
  return 0
}

function updateProgress(car: Car) {
  let gained = false
  for (let k = 0; k < CHECKPOINTS; k++) {
    const index = ((car.passed + 1) % CHECKPOINTS) * CHECKPOINT_STRIDE
    const target = car.track.centerline[index]
    const s = side(car.x - target.x, car.y - target.y, CHECKPOINT_RADIUS)
    if (s > 0 || (s === 0 && Math.hypot(car.x - target.x, car.y - target.y) > CHECKPOINT_RADIUS)) break
    if (!movingForward(car, index)) break
    car.passed++
    gained = true
  }
  if (gained) car.sinceProgress = 0
  else car.sinceProgress++
}

// Walls too far away to matter are skipped. A wall can only be seen by a ray, or touched
// by the car, if its middle is within the ray range plus half a wall segment of the car, so
// leaving the rest out gives exactly the same answers, just faster.
// The list is gathered with SLACK extra reach and kept until the car has moved SLACK away,
// so the whole track is only searched now and then instead of every step.
// The car can only touch a wall whose middle is within CAR_RADIUS plus half a wall of it, a much
// smaller reach than a ray's, so the crash test gets its own shorter list (touch), in the same order.
const SLACK = 80

// The walls are kept as flat numbers, which the maths reads much faster than a list of objects:
// each wall's middle (x, y) for the search, and its start (x, y) and length (x, y) for the rays and
// the crash test. Worked out once per track.
type WallData = { count: number; middle: Float64Array; flat: Float64Array }
const wallData = new WeakMap<Track, WallData>()
function wallsOf(track: Track): WallData {
  let data = wallData.get(track)
  if (!data || data.count !== track.walls.length) {
    const middle = new Float64Array(track.walls.length * 2)
    const flat = new Float64Array(track.walls.length * 4)
    track.walls.forEach((w, i) => {
      middle[2 * i] = (w.a.x + w.b.x) / 2
      middle[2 * i + 1] = (w.a.y + w.b.y) / 2
      flat[4 * i] = w.a.x
      flat[4 * i + 1] = w.a.y
      flat[4 * i + 2] = w.b.x - w.a.x
      flat[4 * i + 3] = w.b.y - w.a.y
    })
    data = { count: track.walls.length, middle, flat }
    wallData.set(track, data)
  }
  return data
}

// Wall numbers picked during a search, reused so a search allocates next to nothing
let nearPick = new Int32Array(0)
let touchPick = new Int32Array(0)
function pack(flat: Float64Array, pick: Int32Array, n: number): Float64Array {
  const out = new Float64Array(n * 4)
  for (let k = 0; k < n; k++) {
    const i = pick[k] * 4
    out[4 * k] = flat[i]
    out[4 * k + 1] = flat[i + 1]
    out[4 * k + 2] = flat[i + 2]
    out[4 * k + 3] = flat[i + 3]
  }
  return out
}

function nearbyWalls(car: Car): Float64Array {
  const moved = side(car.x - car.nearAt.x, car.y - car.nearAt.y, SLACK)
  if (moved < 0 || (moved === 0 && Math.hypot(car.x - car.nearAt.x, car.y - car.nearAt.y) <= SLACK)) return car.near
  const { count, middle, flat } = wallsOf(car.track)
  if (nearPick.length < count) {
    nearPick = new Int32Array(count)
    touchPick = new Int32Array(count)
  }
  const reach = Math.max(car.spec.rayRange, CAR_RADIUS) + car.track.longestWall / 2 + 1 + SLACK
  const reachSq = reach * reach
  const touchReach = CAR_RADIUS + car.track.longestWall / 2 + 1 + SLACK
  const touchSq = touchReach * touchReach
  let nearCount = 0
  let touchCount = 0
  for (let i = 0; i < count; i++) {
    const dx = middle[2 * i] - car.x
    const dy = middle[2 * i + 1] - car.y
    const distSq = dx * dx + dy * dy
    if (distSq <= reachSq) {
      nearPick[nearCount++] = i
      if (distSq <= touchSq) touchPick[touchCount++] = i
    }
  }
  car.near = pack(flat, nearPick, nearCount)
  car.touch = pack(flat, touchPick, touchCount)
  car.nearAt = { x: car.x, y: car.y }
  return car.near
}

function updateRays(car: Car, near: Float64Array = nearbyWalls(car)) {
  // at night, rays without headlights reach only NIGHT_RANGE (a ray that sees nothing still reads as full range away)
  const range = car.track.night && !car.spec.lights ? Math.min(car.spec.rayRange, NIGHT_RANGE) : car.spec.rayRange
  car.rays = car.spec.rayAngles.map((a) => {
    const d = castRay(car.x, car.y, car.angle + a, range, near)
    return range === car.spec.rayRange || d < range ? d : car.spec.rayRange
  })
}

// Is the car touching any of these walls? (the distance from the car's middle to the wall segment)
function hitsWall(walls: Float64Array, car: Car): boolean {
  for (let k = 0; k < walls.length; k += 4) {
    const ax = walls[k]
    const ay = walls[k + 1]
    const dx = walls[k + 2]
    const dy = walls[k + 3]
    const lenSq = dx * dx + dy * dy
    let t = lenSq === 0 ? 0 : ((car.x - ax) * dx + (car.y - ay) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const rx = car.x - (ax + t * dx)
    const ry = car.y - (ay + t * dy)
    const s = side(rx, ry, CAR_RADIUS)
    if (s < 0 || (s === 0 && Math.hypot(rx, ry) < CAR_RADIUS)) return true
  }
  return false
}

// Advance one car by one 1/60-second step. A crash marks it dead (it does NOT reset).
export function step(car: Car, input: Input) {
  if (car.dead) return
  const boosting = input.boost === true && car.boost > 0
  if (boosting) car.boost--
  let maxSpeed = boosting ? car.spec.maxSpeed * NITRO_TOP : car.spec.maxSpeed
  if (car.spec.wetTyres && car.track.grip === undefined) maxSpeed *= car.spec.dryTop ?? WET_TYRE_DRY_SPEED // wet tyres are slow on a dry road
  const gripSpeed = gripSpeedOf(car)

  const accel = car.spec.accel ? ACCEL * car.spec.accel : ACCEL
  const pedal = input.throttle < 0 && car.spec.brake ? car.spec.brake : 1 // carbon brakes bite harder
  car.speed += input.throttle * pedal * (boosting ? accel * NITRO_ACCEL : accel)
  car.speed *= FRICTION
  if (car.speed > maxSpeed) car.speed = maxSpeed
  if (car.speed < MAX_REVERSE) car.speed = MAX_REVERSE

  const turnScale = car.speed > gripSpeed ? Math.pow(gripSpeed / car.speed, GRIP_POWER) : 1
  car.angle += input.steer * (car.spec.turn ? TURN_RATE * car.spec.turn : TURN_RATE) * car.speed * turnScale

  car.x += Math.cos(car.angle) * car.speed
  car.y += Math.sin(car.angle) * car.speed
  car.steps++
  car.speedSum += car.speed
  car.steerChange += Math.abs(input.steer - car.lastSteer)
  car.lastSteer = input.steer

  const near = nearbyWalls(car)
  if (hitsWall(car.touch, car)) {
    car.dead = true
    return
  }

  updateProgress(car)
  updateRays(car, near)
}

// The speed the tyres can still turn at here: a wet road lowers it, and wet tyres win most of that back
function gripSpeedOf(car: Car): number {
  const road = car.track.grip ?? 1
  const grip = car.spec.gripSpeed * (car.spec.wetTyres && car.track.grip !== undefined ? Math.min(1, road * (car.spec.wetGrip ?? WET_TYRE_GRIP)) : road)
  return car.track.ice && onIce(car) ? grip * (car.spec.studs ? STUDS_ICE_GRIP : ICE_GRIP) : grip
}
// Is the car on an ice patch? Patches are stretches between checkpoints, so this is where the car is in its lap.
function onIce(car: Car): boolean {
  const k = car.passed % CHECKPOINTS
  return car.track.ice!.some(([a, b]) => k >= a && k < b)
}

// What the brain sees: each ray distance (0 to 1) and the speed, then with grip sense how near the tyres are to letting go
export function getInputs(car: Car): number[] {
  const scale = car.spec.rayScale ?? car.spec.rayRange
  const inputs = [...car.rays.map((d) => d / scale), car.speed / car.spec.maxSpeed]
  if (car.spec.gripSense) inputs.push(Math.min(2, Math.max(0, car.speed) / gripSpeedOf(car)) / 2) // 0.5 is the limit
  if (car.spec.nitro) inputs.push(car.boost / NITRO_STEPS) // how much charge is left
  return inputs
}

export function drive(car: Car, brain: Brain) {
  const { outputs } = think(brain, getInputs(car))
  step(car, { steer: outputs[0], throttle: outputs[1], boost: car.spec.nitro && outputs[2] > 0 })
}

// Progress: whole checkpoints, plus a little extra credit (under 1) for how close the car
// got to its next one. This breaks ties early on, when most random brains collect none.
export function progressOf(car: Car): number {
  const prev = checkpointPos(car.track, car.passed)
  const next = checkpointPos(car.track, car.passed + 1)
  const spacing = Math.hypot(next.x - prev.x, next.y - prev.y)
  const distance = Math.hypot(car.x - next.x, car.y - next.y)
  const closeness = Math.max(0, 1 - distance / spacing)
  return car.passed + closeness * 0.99
}

// The score training uses: progress, adjusted by the player's driving style
export const PACE_BONUS = 10 // checkpoints of bonus for driving at top speed the whole time
export const CRASH_PENALTY = 15 // checkpoints lost for a crash at full safety
export const JERK_PENALTY = 20 // checkpoints lost per unit of average steering change, at full smoothness
export function fitnessOf(car: Car, reward: Reward): number {
  const steps = Math.max(car.steps, 1)
  const avgSpeed = Math.max(0, car.speedSum / steps)
  return (
    progressOf(car) +
    reward.pace * PACE_BONUS * (avgSpeed / car.spec.maxSpeed) -
    (car.dead ? reward.safety * CRASH_PENALTY : 0) -
    reward.smooth * JERK_PENALTY * (car.steerChange / steps)
  )
}

export type RunResult = { fitness: number; checkpoints: number; steps: number; crashed: boolean }

// Run one brain from the start with no drawing. This is what training calls.
export function runBrain(brain: Brain, track: Track, spec: CarSpec, reward: Reward, maxSteps = MAX_STEPS): RunResult {
  const car = createCar(track, spec)
  while (!car.dead && car.steps < maxSteps && car.sinceProgress < STALL_STEPS) drive(car, brain)
  return { fitness: fitnessOf(car, reward), checkpoints: car.passed, steps: car.steps, crashed: car.dead }
}

// One race lap. time is in steps (60 per second), or null if the car did not finish.
export type LapResult = { time: number | null; checkpoints: number; crashed: boolean }
export function runLap(brain: Brain, track: Track, spec: CarSpec): LapResult {
  const car = createCar(track, spec)
  while (!car.dead && car.steps < RACE_STEPS && car.sinceProgress < STALL_STEPS && car.passed < CHECKPOINTS) drive(car, brain)
  const finished = car.passed >= CHECKPOINTS
  return { time: finished ? car.steps : null, checkpoints: Math.min(car.passed, CHECKPOINTS), crashed: car.dead }
}
