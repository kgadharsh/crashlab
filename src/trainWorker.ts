// Runs training in the background so the page stays smooth.
// Messages in:  { type: 'start', build, seed, watch, maxGenerations? }  begin a run
// Messages out: { type: 'progress', ... } after every generation, then { type: 'done', ... }
// Training always runs at full speed. When the player is watching, every REPLAY_EVERY-th
// generation also carries its cars, so the page can replay it while training carries on.
import { createTraining, driverFor, type TrainingStep } from './training'
import { createPoolScorer } from './scorePool'
import type { Scorer } from './evolve'
import { REPLAY_EVERY, TRAINING_BUDGET, type Build } from './setup'

// start: an existing car to carry on from, and budget: how much to spend (both left out for a fresh run)
// threads: how many threads to score cars on (left out: as many as the device has, up to MAX_THREADS)
type Message = { type: 'start'; build: Build; seed: number; watch: boolean; start?: number[]; budget?: number; maxGenerations?: number; threads?: number }

const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<Message>) => void) | null
}

// Scoring a car does not depend on any other car, so the population can be scored on several threads
// and the cars that come out are exactly the ones a single thread would give. The main page keeps one core free.
const MAX_THREADS = 4
const threadsHere = () => Math.min(MAX_THREADS, Math.max(1, (self.navigator?.hardwareConcurrency ?? 1) - 1))

type Run = ReturnType<typeof createTraining>

// Tell the page how a generation went, and (when it was the last) the car that was picked
function report({ report, spent }: TrainingStep, watch: boolean, budget: number) {
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
    budget,
    population: replay ? report.population : null,
  })
}
function finish(run: Run, genome: number[], spent: number) {
  worker.postMessage({ type: 'done', genome, generations: run.generations, spent })
}

// Run one generation on this thread and report it. Returns true when the budget or optional cap is reached.
function runOne(run: Run, watch: boolean, budget: number): boolean {
  const step = run.step()
  report(step, watch, budget)
  if (step.finished) {
    worker.postMessage({ type: 'judging' })
    finish(run, run.winner(step.report.population), step.spent)
  }
  return step.finished
}

// The same, scoring the cars with a Scorer
async function runOneWith(run: Run, watch: boolean, budget: number, score: Scorer): Promise<boolean> {
  const step = await run.stepWith(score)
  report(step, watch, budget)
  if (step.finished) {
    worker.postMessage({ type: 'judging' })
    finish(run, await run.winnerWith(step.report.population, score), step.spent)
  }
  return step.finished
}

worker.onmessage = async (event) => {
  const m = event.data
  if (m.type !== 'start') return
  const budget = m.budget ?? TRAINING_BUDGET
  const run = createTraining(m.build, m.seed, budget, m.start, m.maxGenerations)
  const threads = m.threads ?? threadsHere()
  const pool = threads > 1 ? createPoolScorer(m.build, driverFor(m.build), threads - 1) : null
  if (!pool) {
    while (!runOne(run, m.watch, budget)) { /* keep going */ }
    return
  }
  try {
    while (!(await runOneWith(run, m.watch, budget, pool.score))) { /* keep going */ }
  } catch (why) {
    setTimeout(() => {
      throw why // surfaces as a worker error, so the page says training failed
    })
  } finally {
    pool.close()
  }
}
