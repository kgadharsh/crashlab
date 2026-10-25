import { INPUTS, HIDDEN, OUTPUTS, type Brain } from './brain'

// Evolution works on a flat list of numbers. This file converts between that list
// and your Brain. The order is: w1 (hidden x inputs), b1, w2 (outputs x hidden), b2.
export const GENOME_LENGTH = HIDDEN * INPUTS + HIDDEN + OUTPUTS * HIDDEN + OUTPUTS // 47

export function genomeToBrain(genome: number[]): Brain {
  let k = 0
  const w1 = Array.from({ length: HIDDEN }, () => Array.from({ length: INPUTS }, () => genome[k++]))
  const b1 = Array.from({ length: HIDDEN }, () => genome[k++])
  const w2 = Array.from({ length: OUTPUTS }, () => Array.from({ length: HIDDEN }, () => genome[k++]))
  const b2 = Array.from({ length: OUTPUTS }, () => genome[k++])
  return { w1, b1, w2, b2 }
}

export function brainToGenome(brain: Brain): number[] {
  return [...brain.w1.flat(), ...brain.b1, ...brain.w2.flat(), ...brain.b2]
}