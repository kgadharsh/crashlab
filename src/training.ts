// One training run: evolution on the player's practice tracks until the budget is spent.
// The app runs this in a worker (trainWorker.ts); experiments in scripts/ run it directly,
// so they measure exactly what players get.
import { createEvolution, scorePopulation, DEFAULT_SETTINGS, type Drive, type GenerationReport, type Scorer } from './evolve'
import { genomeToBrain } from './genome'
import { makeRng } from './random'
import { runBrain } from './sim'
import { practiceTrack, moveBlocks, trackVariants, wetTrack, withConditions, type Track } from './track'
import { specOf, brainShape, genomeLength, TRAINING_BUDGET, POPULATION, type Build } from './setup'

// Each generation drives every chosen practice track, with its blocks moved to new spots,
// so a brain cannot win by remembering where the blocks are.
// At the end, the best 20 are judged again on the practice tracks plus their mirrored and
// backwards versions, so the car picked is one that can drive, not one that knows its tracks.
// Tested 4 Nov 2026 over 4 seeds: picked cars finished 71 of 80 unseen tracks this way,
// against 62 of 80 when judged on the practice tracks alone.
const FINALISTS = 20
const FINAL_LAYOUTS = 2

export type TrainingStep = { report: GenerationReport; spent: number; finished: boolean }

// How one genome drives one track for this build. The scoring helper threads build the same one, so a car scores the same anywhere.
export function driverFor(build: Build): Drive {
  const spec = specOf(build)
  const shape = brainShape(build)
  return (genome, track) => runBrain(genomeToBrain(genome, shape), track, spec, build.reward)
}

// start: an existing car to carry on training, instead of beginning from random brains. It also
// competes in the final pick, so carrying on never hands back a car the judging scores worse.
export function createTraining(build: Build, seed: number, budget = TRAINING_BUDGET, start?: number[], maxGenerations?: number) {
  const shape = brainShape(build)
  if (start && start.length !== genomeLength(shape)) throw new Error('That car was built for different sensors')
  const trackRng = makeRng(seed + 77777) // separate, so the tracks drawn do not change the evolution's own luck
  const dry = build.practice.map((id) => withConditions(practiceTrack(id), build.cond, id + 1)) // night and ice, if the build practises in them
  const practice = build.weather === 'wet' ? dry.map((t) => wetTrack(t)) : build.weather === 'both' ? dry.flatMap((t) => [t, wetTrack(t)]) : dry
  const layouts = (tracks: Track[], count: number) => Array.from({ length: count }, () => tracks.map((t) => moveBlocks(t, trackRng))).flat()
  const drive = driverFor(build)
  const settings = { ...DEFAULT_SETTINGS, populationSize: POPULATION, genomeLength: genomeLength(shape) }
  const evolution = createEvolution(makeRng(seed), settings, drive, () => layouts(practice, 1), start)
  let spent = 0
  let generations = 0
  const advance = (report: GenerationReport): TrainingStep => {
    spent += report.steps
    generations++
    return { report, spent: Math.min(spent, budget), finished: spent >= budget || (maxGenerations !== undefined && generations >= maxGenerations) }
  }
  // The finalists, and the tracks they are judged on: the practice tracks and their mirrored and backwards versions
  const finalists = (population: number[][]) => (start ? [start, ...population.slice(0, FINALISTS - 1)] : population.slice(0, FINALISTS))
  const judgingTracks = () => layouts(practice.flatMap((t) => [t, ...trackVariants(t)]), FINAL_LAYOUTS)
  return {
    // Run one generation. finished is true once the budget is spent or the optional cap is reached.
    step(): TrainingStep {
      return advance(evolution.step())
    },
    // The same, with a Scorer that may use other threads
    async stepWith(score: Scorer): Promise<TrainingStep> {
      return advance(await evolution.stepWith(score))
    },
    // Pick the car: the finalists drive the practice tracks and their mirrored and backwards versions
    winner(population: number[][]): number[] {
      return scorePopulation(finalists(population), drive, judgingTracks())[0].genome
    },
    async winnerWith(population: number[][], score: Scorer): Promise<number[]> {
      return (await score(finalists(population), judgingTracks()))[0].genome
    },
    get generations() {
      return generations
    },
  }
}
