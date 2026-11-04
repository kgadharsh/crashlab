// Runs training in the background so the page stays smooth.
// Messages in:  { type: 'start', build, seed, watch }  begin a run
//               { type: 'next' }   (watch mode) compute the next generation
//               { type: 'free' }   (watch mode) stop waiting and finish as fast as possible
// Messages out: { type: 'progress', ... } after every generation, then { type: 'done', ... }
import { createTraining } from './training'
import { TRAINING_BUDGET, type Build } from './setup'

type Message =
  | { type: 'start'; build: Build; seed: number; watch: boolean }
  | { type: 'next' }
  | { type: 'free' }

const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<Message>) => void) | null
}

let run: ReturnType<typeof createTraining> | null = null
let watching = false

// Run one generation and report it. Returns true when the budget is spent.
function runOne(): boolean {
  if (!run) return true
  const { report, spent, finished } = run.step()
  worker.postMessage({
    type: 'progress',
    generation: report.generation,
    best: report.best.fitness,
    mean: report.meanFitness,
    checkpoints: report.best.checkpoints,
    meanCheckpoints: report.meanCheckpoints,
    bestSteps: report.best.steps / report.tracks, // how long the best car lasted, per track
    spent,
    budget: TRAINING_BUDGET,
    population: report.population,
  })
  if (finished) {
    worker.postMessage({ type: 'judging' })
    worker.postMessage({ type: 'done', genome: run.winner(report.population), generations: run.generations, spent })
    run = null
  }
  return finished
}

worker.onmessage = (event) => {
  const m = event.data
  if (m.type === 'start') {
    run = createTraining(m.build, m.seed)
    watching = m.watch
    if (watching) runOne()
    else while (!runOne()) { /* keep going */ }
  } else if (m.type === 'next') {
    if (watching) runOne()
  } else if (m.type === 'free') {
    watching = false
    while (run && !runOne()) { /* keep going */ }
  }
}
