import { runBrain, DEFAULT_TRACK, type Brain, type Track } from './sim'

// A genome is just the brain's weights as one flat list of numbers.
export type Genome = number[]
// Anything that returns a number from 0 up to (but not including) 1, e.g. your seeded generator.
export type Rng = () => number

export type Individual = {
  genome: Genome
  fitness: number // the score evolution uses (checkpoints plus closeness to the next one)
  checkpoints: number
  steps: number
  crashed: boolean
}

export type Settings = {
  genomeLength: number // 47 for the 6-5-2 brain
  populationSize: number
  eliteCount: number // best cars copied unchanged into the next generation
  tournamentSize: number // how many random cars compete to become a parent
  mutationRate: number // chance that any single weight gets nudged
  mutationSize: number // how big the nudge is
  goodEnough: number // a best score at or above this counts as "learned"
  patience: number // stop early after this many generations with no new best, once learned
}

export const DEFAULT_SETTINGS: Settings = {
  genomeLength: 47,
  populationSize: 100,
  eliteCount: 10,
  tournamentSize: 3,
  mutationRate: 0.1,
  mutationSize: 0.3,
  goodEnough: 100,
  patience: 8,
}

// A bell-curve random number (mostly small, sometimes bigger), built from two uniform ones
function gauss(rng: Rng): number {
  const u = 1 - rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function randomGenome(length: number, rng: Rng): Genome {
  return Array.from({ length }, () => rng() * 2 - 1)
}

export function initialPopulation(settings: Settings, rng: Rng): Genome[] {
  return Array.from({ length: settings.populationSize }, () => randomGenome(settings.genomeLength, rng))
}

// Drive every genome around the track(s) and return them best first.
// With several tracks, a genome's score is its average over all of them, so a brain
// that only works on one track cannot win.
export function scorePopulation(
  genomes: Genome[],
  makeBrain: (genome: Genome) => Brain,
  tracks: Track[] = [DEFAULT_TRACK],
): Individual[] {
  const scored = genomes.map((genome) => {
    const brain = makeBrain(genome)
    const runs = tracks.map((track) => runBrain(brain, track))
    const mean = (f: (r: (typeof runs)[number]) => number) => runs.reduce((sum, r) => sum + f(r), 0) / runs.length
    return {
      genome,
      fitness: mean((r) => r.fitness),
      checkpoints: Math.round(mean((r) => r.checkpoints)),
      steps: Math.round(mean((r) => r.steps)),
      crashed: runs.some((r) => r.crashed),
    }
  })
  return scored.sort((a, b) => b.fitness - a.fitness)
}

// Pick a parent: a few random cars compete and the best of them wins.
function tournament(sorted: Individual[], size: number, rng: Rng): Individual {
  let winner = sorted[Math.floor(rng() * sorted.length)]
  for (let i = 1; i < size; i++) {
    const challenger = sorted[Math.floor(rng() * sorted.length)]
    if (challenger.fitness > winner.fitness) winner = challenger
  }
  return winner
}

// Build the next generation from a scored one (best first).
export function breed(sorted: Individual[], settings: Settings, rng: Rng): Genome[] {
  const next: Genome[] = []

  // 1. The best cars survive unchanged, so we never lose our progress.
  for (let i = 0; i < settings.eliteCount; i++) next.push([...sorted[i].genome])

  // 2. Everyone else is a child of two tournament winners.
  while (next.length < settings.populationSize) {
    const a = tournament(sorted, settings.tournamentSize, rng)
    const b = tournament(sorted, settings.tournamentSize, rng)
    const child = a.genome.map((gene, i) => {
      // crossover: each weight comes from one parent or the other
      let g = rng() < 0.5 ? gene : b.genome[i]
      // mutation: now and then, nudge the weight a little
      if (rng() < settings.mutationRate) g += gauss(rng) * settings.mutationSize
      return g
    })
    next.push(child)
  }
  return next
}

export type GenerationReport = {
  generation: number
  best: Individual
  meanFitness: number
}

// Run the whole thing. onGeneration lets you print progress or draw it.
export function evolve(
  makeBrain: (genome: Genome) => Brain,
  rng: Rng,
  generations: number,
  settings: Settings = DEFAULT_SETTINGS,
  onGeneration?: (report: GenerationReport) => void,
  tracks: Track[] = [DEFAULT_TRACK],
): Individual {
  let genomes = initialPopulation(settings, rng)
  let best: Individual | undefined
  let topScore = -Infinity
  let lastImproved = 0
  for (let gen = 0; gen < generations; gen++) {
    const scored = scorePopulation(genomes, makeBrain, tracks)
    const meanFitness = scored.reduce((sum, s) => sum + s.fitness, 0) / scored.length
    best = scored[0]
    onGeneration?.({ generation: gen, best, meanFitness })
    if (best.fitness > topScore + 1e-9) {
      topScore = best.fitness
      lastImproved = gen
    }
    // Learned and no longer improving: more generations would only waste time
    if (topScore >= settings.goodEnough && gen - lastImproved >= settings.patience) break
    genomes = breed(scored, settings, rng)
  }
  return best as Individual
}