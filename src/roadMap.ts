import { think, type Brain } from './brain'
import { CHECKPOINTS, createCar, getInputs, step, USE_GRIP } from './sim'

export type HeatPoint = { x: number; y: number; value: number }

// Drive this brain for one lap on a copy of the car and note how strongly a hidden
// neuron fires along the way. If the car crashes, the trace simply stops there.
export function traceNeuron(brain: Brain, neuron: number): HeatPoint[] {
  const car = createCar(undefined, USE_GRIP)
  const points: HeatPoint[] = []
  while (!car.dead && car.steps < 900 && car.passed < CHECKPOINTS) {
    const { outputs, hidden } = think(brain, getInputs(car))
    if (car.steps % 6 === 0) points.push({ x: car.x, y: car.y, value: hidden[neuron] })
    step(car, { steer: outputs[0], throttle: outputs[1] })
  }
  return points
}
