import { evolve, DEFAULT_SETTINGS, type Individual } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { CHECKPOINTS } from './sim'

// Train from scratch and print the best score of every generation.
// Returns the best car found, so you can load it into the viewer later.
export function train(seed = 1, generations = 40): Individual {
  const rng = makeRng(seed)
  const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH }
  return evolve(genomeToBrain, rng, generations, settings, (r) => {
    console.log(
      'generation ' + String(r.generation + 1).padStart(2) +
        ' | best: ' + String(r.best.checkpoints).padStart(3) + ' checkpoints (' +
        (r.best.checkpoints / CHECKPOINTS).toFixed(1) + ' laps)' +
        (r.best.crashed ? ', crashed' : ', survived') +
        ' | average score: ' + r.meanFitness.toFixed(1),
    )
  })
}