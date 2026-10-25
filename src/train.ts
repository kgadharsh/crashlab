import { evolve, DEFAULT_SETTINGS, type Individual } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { CHECKPOINTS } from './sim'

export type History = { best: number; mean: number }[]

// Train from scratch. Prints the best score of every generation to the console and
// also returns the whole history so it can be drawn as a graph.
export function trainWithHistory(seed = 1, generations = 40): { winner: Individual; history: History } {
  const rng = makeRng(seed)
  const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH }
  const history: History = []
  const winner = evolve(genomeToBrain, rng, generations, settings, (r) => {
    history.push({ best: r.best.fitness, mean: r.meanFitness })
    console.log(
      'generation ' + String(r.generation + 1).padStart(2) +
        ' | best: ' + String(r.best.checkpoints).padStart(3) + ' checkpoints (' +
        (r.best.checkpoints / CHECKPOINTS).toFixed(1) + ' laps)' +
        (r.best.crashed ? ', crashed' : ', survived') +
        ' | average score: ' + r.meanFitness.toFixed(1),
    )
  })
  return { winner, history }
}

export function train(seed = 1, generations = 40): Individual {
  return trainWithHistory(seed, generations).winner
}