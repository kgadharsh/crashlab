// Runs training in the background so the page stays smooth.
// Messages in:  { type: 'start', build, seed, watch }  begin a run
// Messages out: { type: 'progress', ... } after every generation, then { type: 'done', ... }
// Training always runs at full speed. When the player is watching, every REPLAY_EVERY-th
// generation also carries its cars, so the page can replay it while training carries on.
import { createTraining } from './training'
import { REPLAY_EVERY, TRAINING_BUDGET, type Build } from './setup'

type Message = { type: 'start'; build: Build; seed: number; watch: boolean }

const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<Message>) => void) | null
}

// Run one generation and report it. Returns true when the budget is spent.
function runOne(run: ReturnType<typeof createTraining>, watch: boolean): boolean {
  const { report, spent, finished } = run.step()
  const replay = watch && report.generation % REPLAY_EVERY === 0
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
    population: replay ? report.population : null,
  })
  if (finished) {
    worker.postMessage({ type: 'judging' })
    worker.postMessage({ type: 'done', genome: run.winner(report.population), generations: run.generations, spent })
  }
  return finished
}

worker.onmessage = (event) => {
  const m = event.data
  if (m.type !== 'start') return
  const run = createTraining(m.build, m.seed)
  while (!runOne(run, m.watch)) { /* keep going */ }
}
