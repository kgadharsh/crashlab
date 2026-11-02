// How often does a fresh training run do well on the 10 unseen mission tracks?
// One run at a time with a rest between, so the laptop can cool down.
// Run with: npx tsx scripts/unseenTest.ts [runs] [firstSeed] [trainTracks] [patience]
import { createEvolution, DEFAULT_SETTINGS } from '../src/evolve'
import { genomeToBrain, GENOME_LENGTH } from '../src/genome'
import { makeRng } from '../src/random'
import { lapSteps, USE_GRIP, DEFAULT_TRACK } from '../src/sim'
import { makeTrack } from '../src/track'

const RUNS = Number(process.argv[2] ?? 6)
const FIRST = Number(process.argv[3] ?? 1000)
const TRAIN_COUNT = Number(process.argv[4] ?? 4)
const PATIENCE = Number(process.argv[5] ?? DEFAULT_SETTINGS.patience)
const REST_SECONDS = 15
const GENERATIONS = 80

const train = [DEFAULT_TRACK, ...Array.from({ length: TRAIN_COUNT }, (_, i) => makeTrack(100 + i, 1))]
const unseen = Array.from({ length: 10 }, (_, i) => makeTrack(9000 + i, 1))
const settings = { ...DEFAULT_SETTINGS, patience: PATIENCE, genomeLength: GENOME_LENGTH, grip: USE_GRIP }

const scores: number[] = []
for (let r = 0; r < RUNS; r++) {
  const started = Date.now()
  const evolution = createEvolution(genomeToBrain, makeRng(FIRST + r), GENERATIONS, settings, train)
  let gens = 0
  let best = evolution.step()
  gens++
  while (!best.finished) {
    best = evolution.step()
    gens++
  }
  const brain = genomeToBrain(best.report.best.genome)
  const laps = unseen.filter((t) => lapSteps(brain, t, USE_GRIP) !== null).length
  scores.push(laps)
  console.log('seed ' + (FIRST + r) + ': ' + laps + ' of 10, stopped at generation ' + gens + ', fitness ' + best.report.best.fitness.toFixed(1) + ', ' + Math.round((Date.now() - started) / 1000) + ' s')
  if (r < RUNS - 1) await new Promise((resolve) => setTimeout(resolve, REST_SECONDS * 1000))
}
console.log('scores: ' + scores.join(' ') + ', mean ' + (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
