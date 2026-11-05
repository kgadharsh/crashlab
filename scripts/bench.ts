// Speed and exactness check for the simulation. Trains a build for a fixed number of generations,
// races its best car on the Grand Prix, and prints how long the training took plus a fingerprint of
// everything produced. A speed-up that keeps the fingerprint is the same simulation, just faster.
// Usage: npx tsx scripts/bench.ts [generations] [default|wide]   (about 1 s per generation; low priority, one at a time)
import { createHash } from 'node:crypto'
import { createTraining } from '../src/training'
import { raceCar } from '../src/race'
import { DEFAULT_BUILD, type Build } from '../src/setup'

const builds: Record<string, Build> = {
  default: DEFAULT_BUILD,
  wide: { ...DEFAULT_BUILD, sensors: { count: 9, spread: 180 }, balance: 0.8, reward: { pace: 0.6, safety: 0.8, smooth: 0.3 } },
}
const generations = Number(process.argv[2] ?? 25)
const which = process.argv[3] ?? 'default'
const build = builds[which]
const training = createTraining(build, 1, Infinity)
const hash = createHash('sha1')
let spent = 0
let best: number[] = []
const t0 = performance.now()
for (let g = 0; g < generations; g++) {
  const step = training.step()
  spent = step.spent
  best = step.report.population[0]
  hash.update(JSON.stringify([step.report.best.fitness, step.report.meanFitness, step.report.steps]))
  if (g === generations - 1) hash.update(JSON.stringify(step.report.population))
}
const secs = (performance.now() - t0) / 1000
const race = raceCar({ name: 'bench', build, genome: best })
hash.update(JSON.stringify(race))
console.log(
  which.padEnd(8) + generations + ' generations | ' + (spent / 1e6).toFixed(2) + 'M steps | ' + secs.toFixed(1) + ' s | ' + Math.round(spent / secs / 1000) + 'k steps/s | race ' + race.finished + '/' + race.tracks.length + ' | fingerprint ' + hash.digest('hex').slice(0, 12),
)
