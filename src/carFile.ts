import { buildProblem, genomeLength, shapeOf, type Build } from './setup'
import { PRACTICE_COUNT } from './track'

// A car is its garage build plus its trained weights, saved as text.
const FORMAT = 'crashlab-car'
const VERSION = 2
const MAX_WEIGHT = 1000 // anything bigger is certainly not a real brain

export type CarFile = { name: string; build: Build; genome: number[] }

export function carToJson(car: CarFile): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, ...car })
}

// Read a saved car. Returns it, or a plain-words reason it cannot be used.
export function carFromJson(text: string): CarFile | { error: string } {
  if (text.length > 50000) return { error: 'That file is too big to be a car.' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'That file is not valid JSON.' }
  }
  const d = data as { format?: unknown; version?: unknown; name?: unknown; build?: unknown; genome?: unknown }
  if (!d || typeof d !== 'object' || d.format !== FORMAT) return { error: 'That file is not a CrashLab car.' }
  if (d.version !== VERSION) return { error: 'That car was saved by a different version of CrashLab.' }
  const problem = buildProblem(d.build, PRACTICE_COUNT)
  if (problem) return { error: 'That car has an illegal setup: ' + problem + '.' }
  const build = d.build as Build
  const length = genomeLength(shapeOf(build.sensors))
  if (!Array.isArray(d.genome) || d.genome.length !== length) return { error: 'That car should have ' + length + ' weights.' }
  for (const w of d.genome) {
    if (typeof w !== 'number' || !Number.isFinite(w) || Math.abs(w) > MAX_WEIGHT) return { error: 'That car has a weight that is not a sensible number.' }
  }
  const name = typeof d.name === 'string' ? d.name.slice(0, 40) : 'Unnamed'
  return { name, build, genome: d.genome as number[] }
}
