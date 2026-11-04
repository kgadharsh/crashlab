// One training run: evolution on the player's practice tracks until the budget is spent.
// The app runs this in a worker (trainWorker.ts); experiments in scripts/ run it directly,
// so they measure exactly what players get.
import { createEvolution, scorePopulation, DEFAULT_SETTINGS, type Drive, type GenerationReport } from './evolve'
import { genomeToBrain } from './genome'
import { makeRng } from './random'
import { runBrain } from './sim'
import { practiceTrack, moveBlocks, trackVariants, type Track } from './track'
import { specOf, shapeOf, genomeLength, TRAINING_BUDGET, POPULATION, type Build } from './setup'

// Each generation drives every chosen practice track, with its blocks moved to new spots,
// so a brain cannot win by remembering where the blocks are.
// At the end, the best 20 are judged again on the practice tracks plus their mirrored and
// backwards versions, so the car picked is one that can drive, not one that knows its tracks.
// Tested 4 Nov 2026 over 4 seeds: picked cars finished 71 of 80 unseen tracks this way,
// against 62 of 80 when judged on the practice tracks alone.
const FINALISTS = 20
const FINAL_LAYOUTS = 2

export type TrainingStep = { report: GenerationReport; spent: number; finished: boolean }

export function createTraining(build: Build, seed: number, budget = TRAINING_BUDGET) {
  const spec = specOf(build)
  const shape = shapeOf(build.sensors)
  const trackRng = makeRng(seed + 77777) // separate, so the tracks drawn do not change the evolution's own luck
  const practice = build.practice.map(practiceTrack)
  const layouts = (tracks: Track[], count: number) => Array.from({ length: count }, () => tracks.map((t) => moveBlocks(t, trackRng))).flat()
  const drive: Drive = (genome, track) => runBrain(genomeToBrain(genome, shape), track, spec, build.reward)
  const settings = { ...DEFAULT_SETTINGS, populationSize: POPULATION, genomeLength: genomeLength(shape) }
  const evolution = createEvolution(makeRng(seed), settings, drive, () => layouts(practice, 1))
  let spent = 0
  let generations = 0
  return {
    // Run one generation. finished is true once the budget is spent.
    step(): TrainingStep {
      const report = evolution.step()
      spent += report.steps
      generations++
      return { report, spent: Math.min(spent, budget), finished: spent >= budget }
    },
    // Pick the car: the finalists drive the practice tracks and their mirrored and backwards versions
    winner(population: number[][]): number[] {
      const judging = practice.flatMap((t) => [t, ...trackVariants(t)])
      return scorePopulation(population.slice(0, FINALISTS), drive, layouts(judging, FINAL_LAYOUTS))[0].genome
    },
    get generations() {
      return generations
    },
  }
}
