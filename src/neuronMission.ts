import { starterBrain, think, type Brain } from './brain'
import { createCar, getInputs, step, USE_GRIP, type Car } from './sim'

// The mission looks at the first hidden neuron: "is the right side more open than the left?"
export const NEURON = 0
const SLIDER_ROW = 3 // the weight the player drags
const LABELS = ['Far left', 'Left', 'Ahead', 'Right', 'Far right', 'Speed']
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

// Every weight of the neuron can be dragged. Each input pulls the steering left or right,
// and the strongest side wins. onChange lets the page redraw the predicted path.
export function runNeuronLab(panel: HTMLElement, m: Moment, onChange: () => void, onDone: () => void) {
  const start = [...m.weights]
  const bias = m.brain.b1[NEURON]

  panel.innerHTML =
    '<p class="goal">Change the weights until the car would steer <b>left</b>.</p>' +
    m.inputs.map((_, i) =>
      '<div class="pull"><span>' + LABELS[i] + '</span>' +
      '<input id="n-w' + i + '" type="range" min="-4" max="4" step="0.1" aria-label="Weight of ' + LABELS[i] + '">' +
      '<b id="n-v' + i + '"></b><div class="bar"><i id="n-b' + i + '"></i></div></div>').join('') +
    '<p class="verdict" id="n-verdict"></p>' +
    '<div class="actions"><button class="btn" id="n-reset">Reset</button></div>' +
    '<p class="note" id="n-note">Longer bars pull harder. A weight of 0 means the neuron ignores that input.</p>'
  const sliders = m.inputs.map((_, i) => panel.querySelector('#n-w' + i) as HTMLInputElement)
  const values = m.inputs.map((_, i) => panel.querySelector('#n-v' + i) as HTMLElement)
  const bars = m.inputs.map((_, i) => panel.querySelector('#n-b' + i) as HTMLElement)
  const verdict = panel.querySelector('#n-verdict') as HTMLElement
  const note = panel.querySelector('#n-note') as HTMLElement
  const actions = panel.querySelector('.actions') as HTMLElement
  const done = document.createElement('button')
  done.className = 'btn primary'
  done.textContent = 'Continue'
  done.addEventListener('click', () => {
    start.forEach((w, i) => (m.weights[i] = w)) // the car drives on with its real brain
    onDone()
  })

  function show() {
    sliders.forEach((box, i) => (m.weights[i] = Number(box.value)))
    const total = totalOf(m.inputs, m.weights, bias)
    const output = Math.tanh(total)
    m.inputs.forEach((x, i) => {
      const pull = x * m.weights[i]
      values[i].textContent = (m.weights[i] > 0 ? '+' : '') + m.weights[i].toFixed(1)
      const size = Math.min(50, (Math.abs(pull) / 3) * 50)
      bars[i].style.width = size + '%'
      bars[i].style.left = (pull < 0 ? 50 - size : 50) + '%'
      bars[i].className = pull < 0 ? 'left' : ''
    })
    onChange()
    verdict.textContent = Math.abs(output) < 0.1 ? 'Going straight' : output < 0 ? 'Steering left' : 'Steering right'
    if (output < GOAL) {
      note.textContent = 'Those weights changed the decision. The line shows where the car would go.'
      actions.appendChild(done)
    } else done.remove()
  }
  sliders.forEach((box) => {
    box.addEventListener('input', show)
    box.addEventListener('keydown', (e) => e.stopPropagation()) // arrow keys move the slider, not the car
  })
  panel.querySelector('#n-reset')!.addEventListener('click', () => {
    sliders.forEach((box, i) => (box.value = String(start[i])))
    show()
  })
  sliders.forEach((box, i) => (box.value = String(start[i])))
  show()
}
