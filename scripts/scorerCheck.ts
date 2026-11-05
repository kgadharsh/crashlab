// Does training with a Scorer (the path that scores cars on several threads) give exactly the cars the plain
// path gives? Same seed, a few generations, then the final pick, compared by fingerprint. Here the Scorer runs
// on one thread, so this checks the code around it; the threads themselves are checked in the browser by
// training the same seed with threads 1 and 4 and comparing the cars (see docs/experiments.md).
// Usage: npx tsx scripts/scorerCheck.ts [generations]   (about 1 s per generation; low priority, one at a time)
import { createHash } from 'node:crypto'
import { createTraining, driverFor } from '../src/training'
import { scorePopulation } from '../src/evolve'
import { DEFAULT_BUILD } from '../src/setup'

const generations = Number(process.argv[2] ?? 12)
const build = DEFAULT_BUILD
const fingerprint = (parts: unknown[]) => createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12)

const plain = createTraining(build, 1, Infinity)
const seen: unknown[] = []
let population: number[][] = []
for (let g = 0; g < generations; g++) {
  const { report } = plain.step()
  seen.push([report.best.fitness, report.meanFitness, report.steps])
  population = report.population
}
seen.push(plain.winner(population))

const drive = driverFor(build)
const score = async (genomes: number[][], tracks: Parameters<typeof scorePopulation>[2]) => scorePopulation(genomes, drive, tracks)
const viaScorer = createTraining(build, 1, Infinity)
const seen2: unknown[] = []
for (let g = 0; g < generations; g++) {
  const { report } = await viaScorer.stepWith(score)
  seen2.push([report.best.fitness, report.meanFitness, report.steps])
  population = report.population
}
seen2.push(await viaScorer.winnerWith(population, score))

const a = fingerprint(seen)
const b = fingerprint(seen2)
console.log('plain path ' + a + ' | scorer path ' + b + ' | ' + (a === b ? 'SAME' : 'DIFFERENT'))
if (a !== b) process.exitCode = 1
