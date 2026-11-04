// A small neural network: inputs → hidden layer → outputs (steering, throttle).
// Its size follows from the car's sensors (see setup.ts).
export type Brain = {
  w1: number[][] // w1[h][i] = weight from input i to hidden neuron h
  b1: number[] // bias of each hidden neuron
  w2: number[][] // w2[o][h] = weight from hidden neuron h to output o
  b2: number[] // bias of each output
}

export type Thought = { hidden: number[]; outputs: number[] }

// Run the network: numbers in, numbers out. tanh squashes any number into -1 to +1.
export function think(brain: Brain, inputs: number[]): Thought {
  const hidden = brain.w1.map((row, h) =>
    Math.tanh(row.reduce((sum, w, i) => sum + w * inputs[i], brain.b1[h])),
  )
  const outputs = brain.w2.map((row, o) =>
    Math.tanh(row.reduce((sum, w, h) => sum + w * hidden[h], brain.b2[o])),
  )
  return { hidden, outputs }
}
