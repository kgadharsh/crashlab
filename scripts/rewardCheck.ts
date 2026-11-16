// Do the "What to reward" sliders change how a car drives? Trains a car exactly as the app does (full budget, then the
// final pick) with one slider at full and the rest at zero, then drives it on 40 dry tracks it has never seen: the 8 of
// Grand Prix 1 and 32 more from four fixed seeds. It records what each slider is meant to change: crashes, average
// speed, steering changes, laps finished and lap time.
// strength multiplies the slider's weight (sim.ts), so a stronger weight can be tried before the constant is changed:
// 1 is the weight as shipped.
// Usage: npx tsx scripts/rewardCheck.ts train <out.json> <none|pace|safety|smooth|p,s,m> <seed> [strength] [fast]   (one run per call: rest between calls)
//        npx tsx scripts/rewardCheck.ts report <out.json>                                              (no training)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { GRAND_PRIXES, RACE_COUNT, gpTrack, lapIsOver, weeklyGp, type GrandPrix } from '../src/race'
import { DEFAULT_BUILD as base, brainShape, specOf, type Build, type Reward } from '../src/setup'
import { createCar, drive } from '../src/sim'
import { genomeToBrain } from '../src/genome'
import { CHECKPOINTS } from '../src/track'

const SETTINGS: Record<string, Reward> = {
  none: { pace: 0, safety: 0, smooth: 0 },
  pace: { pace: 1, safety: 0, smooth: 0 },
  safety: { pace: 0, safety: 1, smooth: 0 },
  smooth: { pace: 0, safety: 0, smooth: 1 },
}
type Row = {
  setting: string
  strength: number
  seed: number
  generations: number
  finished: number // of TRACKS
  crashed: number
  speed: number // average speed as a share of top speed, over every track
  steer: number // average change in steering per step
  lap: number // mean lap time in seconds on the 8 tracks every car in the file finished, filled in by the report
  times: (number | null)[]
  gp: number // finished of the 8 in Grand Prix 1
  gpTime: number
}

// the tracks: Grand Prix 1, then four fixed sets of eight in the styles the weekly uses, all dry and by day
const SETS: GrandPrix[] = [GRAND_PRIXES[0], ...[101, 202, 303, 404].map((seed) => ({ ...weeklyGp(0, seed), id: 'check:' + seed, wet: false, night: false, ice: false }))]
const TRACKS = SETS.flatMap((gp) => Array.from({ length: RACE_COUNT }, (_, i) => gpTrack(gp, i)))

const [mode, out, setting, seedArg, strengthArg, carArg] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const strength = Number(strengthArg ?? 1)
  const seed = Number(seedArg)
  // a named slider, or three weights as pace,safety,smooth to try sliders together
  const [pace, safety, smooth] = setting.split(',').map(Number)
  const r = SETTINGS[setting] ?? { pace, safety, smooth }
  // car 'fast' is the setup slider at full top speed, the car most likely to crash
  const build: Build = { ...base, balance: carArg === 'fast' ? 1 : base.balance, reward: { pace: r.pace * strength, safety: r.safety * strength, smooth: r.smooth * strength } }
  const training = createTraining(build, seed)
  let step = training.step()
  while (!step.finished) step = training.step()
  const brain = genomeToBrain(training.winner(step.report.population), brainShape(build))
  const spec = specOf(build)
  let crashed = 0
  let speedSum = 0
  let steerSum = 0
  let steps = 0
  const times = TRACKS.map((track) => {
    const car = createCar(track, spec)
    while (!lapIsOver(car)) drive(car, brain)
    if (car.dead) crashed++
    speedSum += car.speedSum / spec.maxSpeed
    steerSum += car.steerChange
    steps += car.steps
    return car.passed >= CHECKPOINTS ? car.steps / 60 : null
  })
  const gpTimes = times.slice(0, RACE_COUNT).filter((t) => t !== null)
  const row: Row = {
    setting: (carArg === 'fast' ? 'fast ' : '') + setting,
    strength,
    seed,
    generations: training.generations,
    finished: times.filter((t) => t !== null).length,
    crashed,
    speed: speedSum / steps,
    steer: steerSum / steps,
    lap: 0,
    times,
    gp: gpTimes.length,
    gpTime: gpTimes.reduce((s, t) => s + t, 0),
  }
  saved.push(row)
  writeFileSync(out, JSON.stringify(saved))
  console.log(
    `${row.setting} x${strength} seed ${seed} | ${row.generations} generations | finished ${row.finished}/${TRACKS.length} | crashed ${crashed} | speed ${(100 * row.speed).toFixed(0)}% | steer ${row.steer.toFixed(3)} | GP1 ${row.gp}/${RACE_COUNT}`,
  )
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1)
  const sd = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1)))
  const show = (xs: number[], digits: number, scale = 1) => (mean(xs) * scale).toFixed(digits) + ' ±' + (sd(xs) * scale).toFixed(digits)
  // lap time only means something on the same tracks for every car: the ones all of them finished
  const shared = TRACKS.map((_, i) => i).filter((i) => rows.every((r) => r.times[i] !== null))
  for (const r of rows) r.lap = mean(shared.map((i) => r.times[i]!))
  console.log(`${rows.length} cars, ${TRACKS.length} unseen tracks each. Lap time is the mean over the ${shared.length} tracks every car finished. Values are mean ±sd between seeds.`)
  console.log('setting      cars  finished     crashed      speed %     steer/step      lap s')
  const groups = [...new Set(rows.map((r) => r.setting + ' x' + r.strength))]
  for (const g of groups) {
    const mine = rows.filter((r) => r.setting + ' x' + r.strength === g)
    console.log(
      g.padEnd(13) +
        String(mine.length).padEnd(6) +
        show(mine.map((r) => r.finished), 1).padEnd(13) +
        show(mine.map((r) => r.crashed), 1).padEnd(13) +
        show(mine.map((r) => r.speed), 0, 100).padEnd(12) +
        show(mine.map((r) => r.steer), 3).padEnd(16) +
        (shared.length ? show(mine.map((r) => r.lap), 1) : '-'),
    )
  }
}
