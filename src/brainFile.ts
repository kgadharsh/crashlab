import { INPUTS, HIDDEN, OUTPUTS } from './brain'
import { GENOME_LENGTH } from './genome'

const FORMAT = 'crashlab-brain'
const MAX_WEIGHT = 1000 // anything bigger is certainly not a real brain

// A brain as text you can save to a file.
export function brainToJson(genome: number[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, inputs: INPUTS, hidden: HIDDEN, outputs: OUTPUTS, genome }, null, 1)
}

// Read a saved brain. Returns the 47 weights, or a plain-words reason it cannot be used.
export function brainFromJson(text: string): { genome: number[] } | { error: string } {
  if (text.length > 20000) return { error: 'That file is too big to be a brain.' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { error: 'That file is not valid JSON.' }
  }
  const d = data as { format?: unknown; inputs?: unknown; hidden?: unknown; outputs?: unknown; genome?: unknown }
  if (!d || typeof d !== 'object' || d.format !== FORMAT) return { error: 'That file is not a saved brain from this app.' }
  if (d.inputs !== INPUTS || d.hidden !== HIDDEN || d.outputs !== OUTPUTS) {
    return { error: 'That brain has a different shape (' + String(d.inputs) + '-' + String(d.hidden) + '-' + String(d.outputs) + '), so it cannot drive this car.' }
  }
  if (!Array.isArray(d.genome) || d.genome.length !== GENOME_LENGTH) return { error: 'That brain should have ' + GENOME_LENGTH + ' weights.' }
  for (const w of d.genome) {
    if (typeof w !== 'number' || !Number.isFinite(w) || Math.abs(w) > MAX_WEIGHT) return { error: 'That brain contains a weight that is not a sensible number.' }
  }
  return { genome: d.genome as number[] }
}