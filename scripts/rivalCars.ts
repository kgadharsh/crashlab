// Makes candidate cars for the rival ladder (src/rivals.ts): the default build trained with a share of the usual budget,
// so the ladder runs from a car that barely learned to one trained in full. Each is raced on Grand Prix 1 and saved with
// its brain, so the ladder can be picked from the results.
// Usage: npx tsx scripts/rivalCars.ts train <out.json> <budget %> <seed> [default|rally|drifter]   (one run per call: rest between calls)
//        npx tsx scripts/rivalCars.ts list <out.json>                      (no training)
//        npx tsx scripts/rivalCars.ts write <out.json>                     (writes src/rivalCars.ts from PICKS)
//        npx tsx scripts/rivalCars.ts check                               (are the stored results still true?)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { RACE_COUNT, better, raceCar } from '../src/race'
import { DEFAULT_BUILD, TRAINING_BUDGET, type Build } from '../src/setup'

// the top of the ladder is quicker than the default build gets: builds that the skill tree and car types allow
const BUILDS: Record<string, Build> = {
  default: DEFAULT_BUILD,
  rally: { ...DEFAULT_BUILD, parts: { rally: true } },
  drifter: { ...DEFAULT_BUILD, chassis: 'drifter', parts: { quick: true } },
}
// the ladder, weakest first: a candidate as build:budget:seed, and the name it races under
const PICKS: [string, string][] = [
  ['default:2:1', 'Wrong Turn'],
  ['default:4:1', 'Sunday Driver'],
  ['default:4:2', 'Late Braker'],
  ['default:12:2', 'Kerb Hopper'],
  ['default:35:2', 'Second Wind'],
  ['default:7:1', 'Safe Hands'],
  ['default:35:1', 'Clean Lap'],
  ['default:100:1', 'Works Car'],
  ['drifter:100:2', 'Sideways'],
  ['rally:100:2', 'Gravel King'],
]
type Row = { build?: string; budget: number; seed: number; generations: number; finished: number; totalTime: number; genome: number[] }
const [mode, out, budgetArg, seedArg, buildArg = 'default'] = process.argv.slice(2)
const saved: Row[] = out && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
const line = (r: Row) => `${(r.build ?? 'default').padEnd(8)} budget ${r.budget}% seed ${r.seed} | ${r.generations} generations | ${r.finished}/${RACE_COUNT} | ${r.totalTime.toFixed(1)} s`
if (mode === 'train') {
  const budget = Number(budgetArg)
  const seed = Number(seedArg)
  const build = BUILDS[buildArg]
  const training = createTraining(build, seed, Math.round((TRAINING_BUDGET * budget) / 100))
  let step = training.step()
  while (!step.finished) step = training.step()
  const genome = training.winner(step.report.population)
  const result = raceCar({ name: 'rival', build, genome })
  const row: Row = { build: buildArg, budget, seed, generations: training.generations, finished: result.finished, totalTime: result.totalTime, genome }
  saved.push(row)
  writeFileSync(out, JSON.stringify(saved))
  console.log(line(row))
} else if (mode === 'write') {
  // the ladder itself: the picked candidates, weakest first, written as the data file the game loads
  const cars = PICKS.map(([key, name]) => {
    const r = saved.find((x) => (x.build ?? 'default') + ':' + x.budget + ':' + x.seed === key)
    if (!r) throw new Error('No candidate ' + key)
    return { name, build: r.build && r.build !== 'default' ? BUILDS[r.build] : undefined, finished: r.finished, totalTime: Math.round(r.totalTime * 1000) / 1000, genome: r.genome }
  })
  cars.forEach((c, i) => {
    if (i && !better(c, cars[i - 1])) throw new Error(c.name + ' is not better than the rival below it')
  })
  writeFileSync(
    'src/rivalCars.ts',
    "// Written by scripts/rivalCars.ts write: the rival ladder's cars, weakest first. Do not edit by hand.\nimport type { Build } from './setup'\n\nexport const RIVAL_CARS: { name: string; build?: Build; finished: number; totalTime: number; genome: number[] }[] = " +
      JSON.stringify(cars, null, 1).replace(/\n\s+(-?[\d.e-]+,?)(?=\n)/g, ' $1') +
      '\n',
  )
  console.log('Wrote ' + cars.length + ' rivals: ' + cars.map((c) => c.name + ' ' + c.finished + '/' + RACE_COUNT + ' ' + c.totalTime.toFixed(1)).join(' | '))
} else if (mode === 'check') {
  // every rival's stored result must be what the game computes for it now (run after any change to the sim or tracks)
  const { RIVALS } = await import('../src/rivals')
  let wrong = 0
  for (const r of RIVALS) {
    const now = raceCar(r.car)
    if (now.finished !== r.finished || Math.abs(now.totalTime - r.totalTime) > 0.002) {
      wrong++
      console.log('STALE ' + r.car.name + ': stored ' + r.finished + '/' + r.totalTime + ', now ' + now.finished + '/' + now.totalTime.toFixed(3))
    }
  }
  console.log(wrong ? wrong + ' stale rivals: run write again' : 'All ' + RIVALS.length + ' rivals match')
  process.exitCode = wrong ? 1 : 0
} else if (mode === 'list') {
  // weakest first: fewer tracks finished, then a slower time
  saved.sort((a, b) => a.finished - b.finished || b.totalTime - a.totalTime).forEach((r, i) => console.log(String(i).padStart(2) + '  ' + line(r)))
}
