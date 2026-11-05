import type { RunResult, Track } from './sim'

// A genome is just the brain's weights as one flat list of numbers.
export type Genome = number[]
// Anything that returns a number from 0 up to (but not including) 1, e.g. the seeded generator.
export type Rng = () => number
// Drive one genome round one track and say how it went
export type Drive = (genome: Genome, track: Track) => RunResult

export type Individual = {
  genome: Genome
  fitness: number // the score evolution uses (the mean over the tracks)
  checkpoints: number // mean over the tracks
  steps: number // total simulated steps over all the tracks (this is what the budget counts)
  crashed: boolean // crashed on at least one track
}

export type Settings = {
  genomeLength: number
  populationSize: number
  eliteCount: number // best cars copied unchanged into the next generation
  tournamentSize: number // how many random cars compete to become a parent
  mutationRate: number // chance that any single weight gets nudged
  mutationSize: number // how big the nudge is
}

export const DEFAULT_SETTINGS: Omit<Settings, 'genomeLength'> = {
  populationSize: 100,
  eliteCount: 10,
  tournamentSize: 3,
  mutationRate: 0.2,
  mutationSize: 0.5,
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

// Drive every genome round the tracks and return them best first.
// A genome's score is its average over all the tracks, so one that only works on one cannot win.
export function scorePopulation(genomes: Genome[], drive: Drive, tracks: Track[]): Individual[] {
  const scored = genomes.map((genome) => {
    const runs = tracks.map((track) => drive(genome, track))
    const mean = (f: (r: RunResult) => number) => runs.reduce((sum, r) => sum + f(r), 0) / runs.length
    return {
      genome,
      fitness: mean((r) => r.fitness),
      checkpoints: mean((r) => r.checkpoints),
      steps: runs.reduce((sum, r) => sum + r.steps, 0),
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
  // 1. The best cars survive unchanged, so progress is never lost.
  for (let i = 0; i < settings.eliteCount; i++) next.push([...sorted[i].genome])
  // 2. Everyone else is a child of two tournament winners.
  while (next.length < settings.populationSize) {
    const a = tournament(sorted, settings.tournamentSize, rng)
    const b = tournament(sorted, settings.tournamentSize, rng)
    next.push(
      a.genome.map((gene, i) => {
        let g = rng() < 0.5 ? gene : b.genome[i] // crossover: each weight from one parent or the other
        if (rng() < settings.mutationRate) g += gauss(rng) * settings.mutationSize // mutation
        return g
      }),
    )
  }
  return next
}

export type GenerationReport = {
  generation: number
  best: Individual
  meanFitness: number
  meanCheckpoints: number
  steps: number // simulated steps this generation used
  tracks: number // how many tracks each car drove
  population: Genome[] // every car of this generation, best first
}

// A starting population built from one existing car: the car itself, then copies of it with the usual mutations
export function populationFrom(start: Genome, settings: Settings, rng: Rng): Genome[] {
  return Array.from({ length: settings.populationSize }, (_, i) =>
    i === 0 ? [...start] : start.map((gene) => (rng() < settings.mutationRate ? gene + gauss(rng) * settings.mutationSize : gene)),
  )
}

// An evolution you can advance one generation at a time (so a viewer can watch each one).
// tracks hands each generation its own tracks. The caller decides when to stop.
// start: an existing car to carry on from, instead of beginning with random brains.
export function createEvolution(rng: Rng, settings: Settings, drive: Drive, tracks: (generation: number) => Track[], start?: Genome) {
  let genomes = start ? populationFrom(start, settings, rng) : Array.from({ length: settings.populationSize }, () => randomGenome(settings.genomeLength, rng))
  let gen = 0
  return {
    step(): GenerationReport {
      const drawn = tracks(gen)
      const scored = scorePopulation(genomes, drive, drawn)
      const report: GenerationReport = {
        generation: gen,
        best: scored[0],
        meanFitness: scored.reduce((sum, x) => sum + x.fitness, 0) / scored.length,
        meanCheckpoints: scored.reduce((sum, x) => sum + x.checkpoints, 0) / scored.length,
        steps: scored.reduce((sum, x) => sum + x.steps, 0),
        tracks: drawn.length,
        population: scored.map((x) => x.genome),
      }
      genomes = breed(scored, settings, rng)
      gen++
      return report
    },
  }
}
