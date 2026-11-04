import { castRay, type Point, type Segment } from './sensors'
import { think, type Brain } from './brain'
import { CHECKPOINTS, CHECKPOINT_STRIDE, DEFAULT_TRACK, POINTS, type Track } from './track'
import { DEFAULT_SPEC, type CarSpec, type Reward } from './setup'

export { CHECKPOINTS, CHECKPOINT_STRIDE, DEFAULT_TRACK }
export type { Track, Brain }
export type Input = { throttle: number; steer: number }

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

function distToSegment(px: number, py: number, s: Segment): number {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - s.a.x) * dx + (py - s.a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (s.a.x + t * dx), py - (s.a.y + t * dy))
}

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
  near: Segment[] // walls close to nearAt, refreshed as the car moves (see nearbyWalls)
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
    near: [],
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

function updateProgress(car: Car) {
  let gained = false
  for (let k = 0; k < CHECKPOINTS; k++) {
    const index = ((car.passed + 1) % CHECKPOINTS) * CHECKPOINT_STRIDE
    const target = car.track.centerline[index]
    if (Math.hypot(car.x - target.x, car.y - target.y) > CHECKPOINT_RADIUS) break
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
const SLACK = 80
function nearbyWalls(car: Car): Segment[] {
  if (Math.hypot(car.x - car.nearAt.x, car.y - car.nearAt.y) <= SLACK) return car.near
  const reach = Math.max(car.spec.rayRange, CAR_RADIUS) + car.track.longestWall / 2 + 1 + SLACK
  const reachSq = reach * reach
  const near: Segment[] = []
  for (const w of car.track.walls) {
    const dx = (w.a.x + w.b.x) / 2 - car.x
    const dy = (w.a.y + w.b.y) / 2 - car.y
    if (dx * dx + dy * dy <= reachSq) near.push(w)
  }
  car.near = near
  car.nearAt = { x: car.x, y: car.y }
  return near
}

function updateRays(car: Car, near: Segment[] = nearbyWalls(car)) {
  car.rays = car.spec.rayAngles.map((a) => castRay(car.x, car.y, car.angle + a, car.spec.rayRange, near))
}

function hitsWall(near: Segment[], car: Car): boolean {
  for (const w of near) {
    if (distToSegment(car.x, car.y, w) < CAR_RADIUS) return true
  }
  return false
}

// Advance one car by one 1/60-second step. A crash marks it dead (it does NOT reset).
export function step(car: Car, input: Input) {
  if (car.dead) return
  const { maxSpeed, gripSpeed } = car.spec

  car.speed += input.throttle * ACCEL
  car.speed *= FRICTION
  if (car.speed > maxSpeed) car.speed = maxSpeed
  if (car.speed < MAX_REVERSE) car.speed = MAX_REVERSE

  const turnScale = car.speed > gripSpeed ? Math.pow(gripSpeed / car.speed, GRIP_POWER) : 1
  car.angle += input.steer * TURN_RATE * car.speed * turnScale

  car.x += Math.cos(car.angle) * car.speed
  car.y += Math.sin(car.angle) * car.speed
  car.steps++
  car.speedSum += car.speed
  car.steerChange += Math.abs(input.steer - car.lastSteer)
  car.lastSteer = input.steer

  const near = nearbyWalls(car)
  if (hitsWall(near, car)) {
    car.dead = true
    return
  }

  updateProgress(car)
  updateRays(car, near)
}

// What the brain sees: each ray distance (0 to 1) and the speed
export function getInputs(car: Car): number[] {
  return [...car.rays.map((d) => d / car.spec.rayRange), car.speed / car.spec.maxSpeed]
}

export function drive(car: Car, brain: Brain) {
  const { outputs } = think(brain, getInputs(car))
  step(car, { steer: outputs[0], throttle: outputs[1] })
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
