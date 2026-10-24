export const INPUTS = 6 // 5 rays + speed
export const HIDDEN = 5
export const OUTPUTS = 2 // steering, throttle

export type Brain = {
  w1: number[][] // w1[h][i] = weight from input i to hidden neuron h
  b1: number[] // bias of each hidden neuron
  w2: number[][] // w2[o][h] = weight from hidden neuron h to output o
  b2: number[] // bias of each output
}

export type Thought = { hidden: number[]; outputs: number[] }

// Run the network: numbers in, numbers out.
// tanh squashes any number into the range -1 to +1.
export function think(brain: Brain, inputs: number[]): Thought {
  const hidden = brain.w1.map((row, h) =>
    Math.tanh(row.reduce((sum, w, i) => sum + w * inputs[i], brain.b1[h])),
  )
  const outputs = brain.w2.map((row, o) =>
    Math.tanh(row.reduce((sum, w, h) => sum + w * hidden[h], brain.b2[o])),
  )
  return { hidden, outputs }
}

// A hand-written brain. Inputs: [ray -60, ray -30, ray 0, ray +30, ray +60, speed]
export function starterBrain(): Brain {
  const K = 3
  return {
    w1: [
      [-K, -K, 0, K, K, 0], // neuron 0: is the right side more open than the left?
      [0, 0, -3, 0, 0, 0], // neuron 1: is a wall close ahead?
      [0, 0, 0, 0, 0, 3], // neuron 2: how fast am I going?
      [0, 0, 0, 0, 0, 0], // neurons 3 and 4: unused for now
      [0, 0, 0, 0, 0, 0],
    ],
    b1: [0, 1.5, 0, 0, 0],
    w2: [
      [3, 0, 0, 0, 0], // steering follows neuron 0
      [0, -1.5, -0.8, 0, 0], // throttle: ease off for a wall ahead or high speed
    ],
    b2: [0, 1.2], // a steady urge to accelerate
  }
}