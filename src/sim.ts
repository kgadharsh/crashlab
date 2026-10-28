import { castRay, type Point, type Segment } from './sensors'
import { think } from './brain'
import { CHECKPOINTS, CHECKPOINT_STRIDE, DEFAULT_TRACK, POINTS, type Track } from './track'

export { CHECKPOINTS, CHECKPOINT_STRIDE, DEFAULT_TRACK }
export type { Track }

// Whatever shape your brain has, this picks up its type from think()
export type Brain = Parameters<typeof think>[0]
export type Input = { throttle: number; steer: number }

// ---------- CAR SETTINGS ----------
export const CAR_RADIUS = 12
export const ACCEL = 0.15
export const FRICTION = 0.98
export const MAX_SPEED = 6
export const MAX_REVERSE = -2
export const TURN_RATE = 0.008

// ---------- GRIP (cars use it by default, following USE_GRIP below) ----------
// With grip on, the tyres can only turn the car so hard. Above GRIP_SPEED the turning
// weakens as the car speeds up, so you must brake before a bend. With grip off, the
// turning radius is the same at every speed and braking never helps.
export const GRIP_SPEED = 3
export const GRIP_POWER = 2
// ONE switch for the whole app (missions, training, swarm, scores): every function defaults to it. false = the old physics.
export const USE_GRIP = true

// ---------- PROGRESS SETTINGS ----------
export const CHECKPOINT_RADIUS = 50
const MIN_FORWARD_SPEED = 0.5 // slower than this (or reversing) earns no checkpoints
export const STALL_STEPS = 300 // 5 seconds without a new checkpoint ends an attempt
export const MAX_STEPS = 1200 // 20 seconds is the longest attempt

// ---------- RAY SETTINGS ----------
export const RAY_ANGLES = [-60, -30, 0, 30, 60].map((deg) => (deg * Math.PI) / 180)
export const RAY_RANGE = 200

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
  x: number
  y: number
  angle: number
  speed: number
  passed: number // checkpoints collected (keeps growing across laps)
  rays: number[] // current ray distances
  dead: boolean // true once the car has crashed
  steps: number // how many steps this attempt has lasted
  sinceProgress: number // steps since the last new checkpoint
  grip: boolean // true = turning weakens above GRIP_SPEED
}

export function createCar(track: Track = DEFAULT_TRACK, grip = USE_GRIP): Car {
  const car: Car = {
    track,
    x: track.start.x,
    y: track.start.y,
    angle: track.start.angle,
    speed: 0,
    passed: 0,
    rays: [],
    dead: false,
    steps: 0,
    sinceProgress: 0,
    grip,
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
// by the car, if its middle is within RAY_RANGE plus half a wall segment of the car, so
// leaving the rest out gives exactly the same answers, just faster.
function nearbyWalls(car: Car): Segment[] {
  const reach = RAY_RANGE + car.track.longestWall / 2 + 1
  const reachSq = reach * reach
  const near: Segment[] = []
  for (const w of car.track.walls) {
    const dx = (w.a.x + w.b.x) / 2 - car.x
    const dy = (w.a.y + w.b.y) / 2 - car.y
    if (dx * dx + dy * dy <= reachSq) near.push(w)
  }
  return near
}

function updateRays(car: Car, near: Segment[] = nearbyWalls(car)) {
  car.rays = RAY_ANGLES.map((a) => castRay(car.x, car.y, car.angle + a, RAY_RANGE, near))
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

  car.speed += input.throttle * ACCEL
  car.speed *= FRICTION
  if (car.speed > MAX_SPEED) car.speed = MAX_SPEED
  if (car.speed < MAX_REVERSE) car.speed = MAX_REVERSE

  const turnScale = car.grip && car.speed > GRIP_SPEED ? Math.pow(GRIP_SPEED / car.speed, GRIP_POWER) : 1
  car.angle += input.steer * TURN_RATE * car.speed * turnScale

  car.x += Math.cos(car.angle) * car.speed
  car.y += Math.sin(car.angle) * car.speed
  car.steps++

  const near = nearbyWalls(car)
  if (hitsWall(near, car)) {
    car.dead = true
    return
  }

  updateProgress(car)
  updateRays(car, near)
}

// What the brain sees: 5 ray distances (0 to 1) and the speed
export function getInputs(car: Car): number[] {
  return [...car.rays.map((d) => d / RAY_RANGE), car.speed / MAX_SPEED]
}

// The score evolution uses: whole checkpoints, plus a little extra credit (under 1)
// for how close the car got to its next checkpoint. This breaks ties early on, when
// most random brains collect zero checkpoints but some get closer than others.
export function fitnessOf(car: Car): number {
  const prev = checkpointPos(car.track, car.passed)
  const next = checkpointPos(car.track, car.passed + 1)
  const spacing = Math.hypot(next.x - prev.x, next.y - prev.y)
  const distance = Math.hypot(car.x - next.x, car.y - next.y)
  const closeness = Math.max(0, 1 - distance / spacing)
  return car.passed + closeness * 0.99
}

// Run one brain from the start with no drawing. This is what evolution will call.
export function runBrain(brain: Brain, track: Track = DEFAULT_TRACK, maxSteps: number = MAX_STEPS, grip = USE_GRIP) {
  const car = createCar(track, grip)
  while (!car.dead && car.steps < maxSteps && car.sinceProgress < STALL_STEPS) {
    const { outputs } = think(brain, getInputs(car))
    step(car, { steer: outputs[0], throttle: outputs[1] })
  }
  return {
    checkpoints: car.passed,
    fitness: fitnessOf(car),
    steps: car.steps,
    crashed: car.dead,
  }
}

// How many steps a brain needs to collect one full lap of checkpoints (null if it never does).
export function lapSteps(brain: Brain, track: Track = DEFAULT_TRACK, grip = USE_GRIP): number | null {
  const car = createCar(track, grip)
  while (!car.dead && car.steps < 3000 && car.sinceProgress < STALL_STEPS && car.passed < CHECKPOINTS) {
    const { outputs } = think(brain, getInputs(car))
    step(car, { steer: outputs[0], throttle: outputs[1] })
  }
  return car.passed >= CHECKPOINTS ? car.steps : null
}