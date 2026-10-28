import { evolve, DEFAULT_SETTINGS, type Individual } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { CHECKPOINTS, USE_GRIP, type Track } from './sim'

export type History = { best: number; mean: number }[]

// Train from scratch. Prints the best score of every generation to the console and
// also returns the whole history so it can be drawn as a graph.
export function trainWithHistory(
  seed = 1,
  generations = 40,
  tracks?: Track[],
  quiet = false,
  onProgress?: (generation: number, point: History[number], best: Individual) => void,
): { winner: Individual; history: History } {
  const rng = makeRng(seed)
  const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH, grip: USE_GRIP }
  const history: History = []
  const winner = evolve(genomeToBrain, rng, generations, settings, (r) => {
    history.push({ best: r.best.fitness, mean: r.meanFitness })
    onProgress?.(r.generation, history[history.length - 1], r.best)
    if (!quiet) console.log(
      'generation ' + String(r.generation + 1).padStart(2) +
        ' | best: ' + String(r.best.checkpoints).padStart(3) + ' checkpoints (' +
        (r.best.checkpoints / CHECKPOINTS).toFixed(1) + ' laps)' +
        (r.best.crashed ? ', crashed' : ', survived') +
        ' | average score: ' + r.meanFitness.toFixed(1),
    )
  }, tracks)
  return { winner, history }
}

export function train(seed = 1, generations = 40): Individual {
  return trainWithHistory(seed, generations).winner
}