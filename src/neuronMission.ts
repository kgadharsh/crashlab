import { starterBrain, think, type Brain } from './brain'
import { createCar, getInputs, step, USE_GRIP, type Car } from './sim'

// The mission looks at the first hidden neuron: "is the right side more open than the left?"
export const NEURON = 0
const SLIDER_ROW = 3 // the weight the player drags
const LABELS = ['ray -60°', 'ray -30°', 'ray 0°', 'ray +30°', 'ray +60°', 'speed']
const GOAL = -0.3 // the output counts as "steering left" below this

const round2 = (x: number) => Math.round(x * 100) / 100

export type Moment = {
  car: Car
  brain: Brain
  inputs: number[] // shown to 2 decimals, and the arithmetic below uses those same numbers
  weights: number[] // the brain's own weights, so dragging the slider changes the real network
}

const totalOf = (inputs: number[], weights: number[], bias: number) =>
  inputs.reduce((s, x, i) => s + x * weights[i], bias)

// Drive the starter brain until the neuron is doing something readable: steering clearly
// right, with one ray strong enough that dragging its weight can turn the car left.
export function findMoment(): Moment {
  const brain = starterBrain()
  const car = createCar(undefined, USE_GRIP)
  const weights = brain.w1[NEURON]
  const bias = brain.b1[NEURON]
  for (;;) {
    const raw = getInputs(car)
    const inputs = raw.map(round2)
    const sum = totalOf(inputs, weights, bias)
    const { outputs, hidden } = think(brain, raw)
    const readable = car.steps > 60 && sum >= 0.4 && sum <= 1.2
    const canFlip = sum - weights[SLIDER_ROW] * inputs[SLIDER_ROW] < GOAL * 2
    const matchesPanel = round2(hidden[NEURON]) === round2(Math.tanh(sum)) // the network panel must show the same number
    if ((readable && canFlip && matchesPanel) || car.steps > 400) return { car, brain, inputs, weights }
    step(car, { steer: outputs[0], throttle: outputs[1] })
  }
}

// One live panel: drag a weight and watch the sum, the squash and the steering follow.
export function runNeuronLab(panel: HTMLElement, m: Moment, onDone: () => void) {
  const start = m.weights[SLIDER_ROW]
  const bias = m.brain.b1[NEURON]
  const used = m.inputs.map((_, i) => i).filter((i) => m.weights[i] !== 0)

  panel.innerHTML =
    '<p class="goal">Drag the slider until the car would steer <b>left</b>.</p>' +
    '<label class="slider"><span>Weight of ' + LABELS[SLIDER_ROW] + '</span>' +
    '<input id="n-weight" type="range" min="-3" max="3" step="0.1" value="' + start + '"><b id="n-value"></b></label>' +
    '<table><tbody id="n-rows"></tbody></table>' +
    '<div class="gauge"><span>Left</span><div><i id="n-mark"></i></div><span>Right</span></div>' +
    '<p class="note" id="n-note"></p>'
  const slider = panel.querySelector('#n-weight') as HTMLInputElement
  const rows = panel.querySelector('#n-rows') as HTMLElement
  const mark = panel.querySelector('#n-mark') as HTMLElement
  const note = panel.querySelector('#n-note') as HTMLElement
  const value = panel.querySelector('#n-value') as HTMLElement

  function show() {
    const w = Number(slider.value)
    m.weights[SLIDER_ROW] = w
    value.textContent = w.toFixed(1)
    const total = totalOf(m.inputs, m.weights, bias)
    const output = Math.tanh(total)
    rows.innerHTML =
      used.map((i) =>
        '<tr' + (i === SLIDER_ROW ? ' class="live"' : '') + '><td>' + LABELS[i] + '</td><td>' + m.inputs[i].toFixed(2) + ' × ' + m.weights[i].toFixed(1) +
        '</td><td>' + (m.inputs[i] * m.weights[i]).toFixed(2) + '</td></tr>').join('') +
      '<tr class="sum"><td colspan="2">Add them up</td><td>' + total.toFixed(2) + '</td></tr>' +
      '<tr class="sum"><td colspan="2">Squash to -1…1</td><td>' + output.toFixed(2) + '</td></tr>'
    mark.style.left = ((output + 1) / 2) * 100 + '%'
    if (output < GOAL) {
      note.innerHTML = 'That one weight changed the car\'s decision.<br><button class="btn primary" id="n-done">Continue</button>'
      panel.querySelector('#n-done')!.addEventListener('click', () => {
        m.weights[SLIDER_ROW] = start // the car drives on with its real brain
        onDone()
      })
    } else note.textContent = 'Each input × weight, added up, then squashed. That is one neuron.'
  }
  slider.addEventListener('input', show)
  slider.addEventListener('keydown', (e) => e.stopPropagation()) // arrow keys move the slider, not the car
  show()
}
