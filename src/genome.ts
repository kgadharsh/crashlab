import type { Brain } from './brain'
import type { Shape } from './setup'

// Evolution works on a flat list of numbers. This file converts between that list
// and a Brain of a given shape. The order is: w1 (hidden x inputs), b1, w2 (outputs x hidden), b2.
export function genomeToBrain(genome: number[], shape: Shape): Brain {
  let k = 0
  const w1 = Array.from({ length: shape.hidden }, () => Array.from({ length: shape.inputs }, () => genome[k++]))
  const b1 = Array.from({ length: shape.hidden }, () => genome[k++])
  const w2 = Array.from({ length: shape.outputs }, () => Array.from({ length: shape.hidden }, () => genome[k++]))
  const b2 = Array.from({ length: shape.outputs }, () => genome[k++])
  return { w1, b1, w2, b2 }
}

export function brainToGenome(brain: Brain): number[] {
  return [...brain.w1.flat(), ...brain.b1, ...brain.w2.flat(), ...brain.b2]
}
