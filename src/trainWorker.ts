// Runs the training in the background so the page stays smooth.
// Messages in:  { type: 'start', seed, generations, watch }  begin a run
//               { type: 'next' }   (watch mode) compute the next generation
//               { type: 'free' }   (watch mode) stop waiting and finish as fast as possible
// Messages out: { type: 'progress', ... } after every generation, then { type: 'done', ... }
import { createEvolution, scorePopulation, DEFAULT_SETTINGS } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { USE_GRIP, DEFAULT_TRACK, type Track } from './sim'
import { makeTrack, moveBlocks } from './track'

// Each generation drives the practice track plus 4 tracks drawn from a pool of 30, with their
// blocks moved to new spots. Fixed tracks let a brain memorise them (and fail on new roads);
// tracks that keep changing only reward a brain that really steers.
// Each track is built the first time it is drawn, so training starts without a long wait.
const POOL_SIZE = 30
const PER_GENERATION = 4
const FINALISTS = 20 // at the end, the best few are judged on the whole pool
const pool: Track[] = []
const poolTrack = (i: number) => (pool[i] ??= makeTrack(100 + i, 1))

function drawTracks(rng: () => number): Track[] {
  const shuffled = Array.from({ length: POOL_SIZE }, (_, i) => i).sort(() => rng() - 0.5)
  return [DEFAULT_TRACK, ...shuffled.slice(0, PER_GENERATION).map((i) => moveBlocks(poolTrack(i), rng))]
}

type Message =
  | { type: 'start'; seed: number; generations: number; watch: boolean }
  | { type: 'next' }
  | { type: 'free' }

const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<Message>) => void) | null
}

let evolution: ReturnType<typeof createEvolution> | null = null
let generationsRun = 0
let watching = false

// Run one generation and report it. Returns true when the run is over.
function runOne(): boolean {
  if (!evolution) return true
  const { report, finished } = evolution.step()
  generationsRun++
  worker.postMessage({
    type: 'progress',
    generation: report.generation,
    best: report.best.fitness,
    mean: report.meanFitness,
    checkpoints: report.best.checkpoints,
    population: report.population,
  })
  if (finished) {
    // The last generation's tracks were luck of the draw, so pick the winner on all of them
    const winner = scorePopulation(report.population.slice(0, FINALISTS), genomeToBrain, [DEFAULT_TRACK, ...Array.from({ length: POOL_SIZE }, (_, i) => poolTrack(i))], USE_GRIP)[0]
    worker.postMessage({
      type: 'done',
      genome: winner.genome,
      checkpoints: winner.checkpoints,
      generations: generationsRun,
    })
    evolution = null
  }
  return finished
}

worker.onmessage = (event) => {
  const m = event.data
  if (m.type === 'start') {
    const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH, grip: USE_GRIP }
    const trackRng = makeRng(m.seed + 77777) // separate, so the tracks drawn do not change the evolution's own luck
    evolution = createEvolution(genomeToBrain, makeRng(m.seed), m.generations, settings, () => drawTracks(trackRng))
    generationsRun = 0
    watching = m.watch
    if (watching) runOne()
    else while (!runOne()) { /* keep going */ }
  } else if (m.type === 'next') {
    if (watching) runOne()
  } else if (m.type === 'free') {
    watching = false
    while (evolution && !runOne()) { /* keep going */ }
  }
}