// Runs training in the background so the page stays smooth.
// Messages in:  { type: 'start', build, seed, watch }  begin a run
//               { type: 'next' }   (watch mode) compute the next generation
//               { type: 'free' }   (watch mode) stop waiting and finish as fast as possible
// Messages out: { type: 'progress', ... } after every generation, then { type: 'done', ... }
import { createEvolution, scorePopulation, DEFAULT_SETTINGS, type Drive } from './evolve'
import { genomeToBrain } from './genome'
import { makeRng } from './random'
import { runBrain, type Track } from './sim'
import { practiceTrack, moveBlocks } from './track'
import { specOf, shapeOf, genomeLength, TRAINING_BUDGET, POPULATION, type Build } from './setup'

// Each generation drives every chosen practice track, with its blocks moved to new spots,
// so a brain cannot win by remembering where the blocks are.
const FINALISTS = 20 // at the end, the best few are judged again on fresh block layouts
const FINAL_LAYOUTS = 3

type Message =
  | { type: 'start'; build: Build; seed: number; watch: boolean }
  | { type: 'next' }
  | { type: 'free' }

const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<Message>) => void) | null
}

type Run = {
  evolution: ReturnType<typeof createEvolution>
  drive: Drive
  layouts: (count: number) => Track[]
  spent: number
  generations: number
}
let run: Run | null = null
let watching = false

// Run one generation and report it. Returns true when the budget is spent.
function runOne(): boolean {
  if (!run) return true
  const report = run.evolution.step()
  run.spent += report.steps
  run.generations++
  const finished = run.spent >= TRAINING_BUDGET
  worker.postMessage({
    type: 'progress',
    generation: report.generation,
    best: report.best.fitness,
    mean: report.meanFitness,
    checkpoints: report.best.checkpoints,
    spent: Math.min(run.spent, TRAINING_BUDGET),
    budget: TRAINING_BUDGET,
    population: report.population,
  })
  if (finished) {
    // The last generation's block layouts were luck of the draw, so judge the finalists on new ones
    const winner = scorePopulation(report.population.slice(0, FINALISTS), run.drive, run.layouts(FINAL_LAYOUTS))[0]
    worker.postMessage({ type: 'done', genome: winner.genome, generations: run.generations, spent: run.spent })
    run = null
  }
  return finished
}

worker.onmessage = (event) => {
  const m = event.data
  if (m.type === 'start') {
    const { build } = m
    const spec = specOf(build)
    const shape = shapeOf(build.sensors)
    const trackRng = makeRng(m.seed + 77777) // separate, so the tracks drawn do not change the evolution's own luck
    const layouts = (count: number) =>
      Array.from({ length: count }, () => build.practice.map((id) => moveBlocks(practiceTrack(id), trackRng))).flat()
    const drive: Drive = (genome, track) => runBrain(genomeToBrain(genome, shape), track, spec, build.reward)
    const settings = { ...DEFAULT_SETTINGS, populationSize: POPULATION, genomeLength: genomeLength(shape) }
    run = { evolution: createEvolution(makeRng(m.seed), settings, drive, () => layouts(1)), drive, layouts, spent: 0, generations: 0 }
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
