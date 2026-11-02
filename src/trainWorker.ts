// Runs the training in the background so the page stays smooth.
// Messages in:  { type: 'start', seed, generations, watch }  begin a run
//               { type: 'next' }   (watch mode) compute the next generation
//               { type: 'free' }   (watch mode) stop waiting and finish as fast as possible
// Messages out: { type: 'progress', ... } after every generation, then { type: 'done', ... }
import { createEvolution, DEFAULT_SETTINGS } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { USE_GRIP, DEFAULT_TRACK } from './sim'
import { makeTrack } from './track'

// The cars now learn on 5 tracks (the practice track plus 4 generated ones),
// so a brain that only works on one track cannot win.
const TRAIN_TRACKS = [DEFAULT_TRACK, ...Array.from({ length: 4 }, (_, i) => makeTrack(100 + i, 1))]

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
    worker.postMessage({
      type: 'done',
      genome: report.best.genome,
      checkpoints: report.best.checkpoints,
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
    evolution = createEvolution(genomeToBrain, makeRng(m.seed), m.generations, settings, TRAIN_TRACKS)
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