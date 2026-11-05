// Can a network learn to use nitro, and does it help? Trains the default build with nitro (the brain gets a
// charge-left input and a boost output), then races the car on the dry Grand Prix, counting every boosted
// step and whether it was on a straight or in a bend. Compare with the same seeds trained without nitro
// (seeds 21 to 23 give 8/8 in 148.2, 148.3 and 146.9 s; see docs/experiments.md).
// Usage: npx tsx scripts/nitroCheck.ts train <out.json> <seed>   (one training per call: rest between calls)
//        npx tsx scripts/nitroCheck.ts report <out.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { genomeToBrain } from '../src/genome'
import { CHECKPOINTS, CHECKPOINT_STRIDE, NITRO_STEPS, createCar, drive } from '../src/sim'
import { RACE_COUNT, finishLap, lapIsOver, raceTrack } from '../src/race'
import { bendRadii } from '../src/track'
import { DEFAULT_BUILD as base, shapeOf, specOf, type Build } from '../src/setup'

const STRAIGHT = 400 // a road bending no tighter than this radius counts as a straight
const build: Build = { ...base, perks: { nitro: true } }
type Row = { seed: number; finished: number; totalTime: number; boostPerLap: number; boostOnStraight: number; straightShare: number; times: (number | null)[] }

function race(genome: number[]): Omit<Row, 'seed'> {
  const brain = genomeToBrain(genome, shapeOf(build.sensors, true))
  const spec = specOf(build)
  let boosted = 0
  let onStraight = 0
  let straightLength = 0
  let length = 0
  const times: (number | null)[] = []
  for (let i = 0; i < RACE_COUNT; i++) {
    const track = raceTrack(i)
    const radii = bendRadii(track)
    straightLength += radii.filter((r) => r >= STRAIGHT).length
    length += radii.length
    const car = createCar(track, spec)
    while (!lapIsOver(car)) {
      const before = car.boost
      drive(car, brain)
      if (car.boost < before) {
        boosted++
        if (radii[(car.passed % CHECKPOINTS) * CHECKPOINT_STRIDE] >= STRAIGHT) onStraight++
      }
    }
    times.push(finishLap(car).time)
  }
  const done = times.filter((t): t is number => t !== null)
  return {
    finished: done.length,
    totalTime: done.reduce((a, b) => a + b, 0),
    boostPerLap: boosted / RACE_COUNT / NITRO_STEPS, // share of the charge used per lap
    boostOnStraight: boosted ? onStraight / boosted : 0,
    straightShare: straightLength / length, // what share of the road is straight, for comparison
    times,
  }
}

const [mode, out, seedArg] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const seed = Number(seedArg)
  const training = createTraining(build, seed)
  let step = training.step()
  while (!step.finished) step = training.step()
  const row: Row = { seed, ...race(training.winner(step.report.population)) }
  saved.push(row)
  writeFileSync(out, JSON.stringify(saved))
  console.log('seed ' + seed + ' | ' + training.generations + ' generations | ' + row.finished + '/' + RACE_COUNT + (row.finished === RACE_COUNT ? ' in ' + row.totalTime.toFixed(1) + ' s' : '') + ' | charge used per lap ' + Math.round(100 * row.boostPerLap) + '% | boost on straights ' + Math.round(100 * row.boostOnStraight) + '% (straights are ' + Math.round(100 * row.straightShare) + '% of the road)')
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  for (const r of rows) console.log('seed ' + r.seed + ' | ' + r.finished + '/' + RACE_COUNT + (r.finished === RACE_COUNT ? ' in ' + r.totalTime.toFixed(1) + ' s' : '') + ' | charge used ' + Math.round(100 * r.boostPerLap) + '% | on straights ' + Math.round(100 * r.boostOnStraight) + '% vs ' + Math.round(100 * r.straightShare) + '% of road')
}
