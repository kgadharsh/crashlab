import { starterBrain, think, type Brain } from './brain'
import { createCar, getInputs, step, USE_GRIP, type Car } from './sim'

// The mission looks at the first hidden neuron: "is the right side more open than the left?"
export const NEURON = 0
const BLANK_ROW = 4 // the row the player multiplies out themselves
const LABELS = ['ray -60°', 'ray -30°', 'ray 0°', 'ray +30°', 'ray +60°', 'speed']

const round2 = (x: number) => Math.round(x * 100) / 100

export type Moment = {
  car: Car
  brain: Brain
  inputs: number[] // shown to 2 decimals, and the arithmetic below uses those same numbers
  weights: number[]
  bias: number
  sum: number
  output: number
}

// Drive the starter brain until the neuron is doing something readable: a sum that is
// clearly left or right, but not so big that the squash flattens it to exactly 1.
export function findMoment(): Moment {
  const brain = starterBrain()
  const car = createCar(undefined, USE_GRIP)
  const weights = brain.w1[NEURON]
  const bias = brain.b1[NEURON]
  for (;;) {
    const raw = getInputs(car)
    const inputs = raw.map(round2)
    const sum = round2(inputs.reduce((s, x, i) => s + x * weights[i], bias))
    const output = round2(Math.tanh(sum))
    const { outputs, hidden } = think(brain, raw)
    const big = car.steps > 60 && Math.abs(sum) >= 0.4 && Math.abs(sum) <= 1.2
    const matchesPanel = round2(hidden[NEURON]) === output // the network panel must show the same number
    if ((big && matchesPanel && inputs[BLANK_ROW] >= 0.2) || car.steps > 400) {
      return { car, brain, inputs, weights, bias, sum, output }
    }
    step(car, { steer: outputs[0], throttle: outputs[1] })
  }
}

const row = (cells: string[], tag = 'td') =>
  '<tr>' + cells.map((c) => '<' + tag + ' style="padding:2px 12px 2px 0;text-align:right">' + c + '</' + tag + '>').join('') + '</tr>'

// Walk through one neuron: multiply, add, squash, then predict the steering.
export function runNeuronSteps(panel: HTMLElement, m: Moment, onDone: () => void) {
  const answer = round2(m.inputs[BLANK_ROW] * m.weights[BLANK_ROW])

  function table(blank: boolean): string {
    const rows = m.inputs.map((x, i) => {
      const product = blank && i === BLANK_ROW ? '<input id="n-answer" inputmode="decimal" style="width:64px;font-size:16px">' : round2(x * m.weights[i]).toFixed(2)
      return row([LABELS[i], x.toFixed(2), '× ' + m.weights[i], '= ' + product])
    })
    return '<table style="border-collapse:collapse">' + row(['input', 'value', 'weight', 'result'], 'th') + rows.join('') + '</table>'
  }

  function multiply() {
    panel.innerHTML =
      '<b>Step 1 of 3: multiply.</b> The inputs are the 5 ray distances and the speed, scaled so that 1 means as far or as fast as possible. ' +
      'The neuron multiplies each input by its weight. A weight of 0 means it ignores that input.' + table(true) +
      '<button id="n-check" style="margin-top:8px;padding:6px 12px">Check</button> <span id="n-note">Work out the empty box.</span>'
    const box = panel.querySelector('#n-answer') as HTMLInputElement
    const note = panel.querySelector('#n-note') as HTMLElement
    const check = () => {
      const typed = Number(box.value.trim())
      if (box.value.trim() !== '' && Math.abs(typed - answer) < 0.015) add()
      else note.textContent = 'Not quite. Multiply ' + m.inputs[BLANK_ROW].toFixed(2) + ' by ' + m.weights[BLANK_ROW] + '.'
    }
    panel.querySelector('#n-check')!.addEventListener('click', check)
    box.addEventListener('keydown', (e) => {
      e.stopPropagation() // typing here must not drive the car
      if (e.key === 'Enter') check()
    })
    box.focus()
  }

  function add() {
    panel.innerHTML =
      '<b>Step 2 of 3: add.</b> It adds up all the results, plus one extra number of its own called the <b>bias</b> (here ' + m.bias + '). ' +
      'Left rays have negative weights and right rays positive ones, so more open space on the right makes the total go up.' + table(false) +
      '<p style="margin:8px 0"><b>Total: ' + m.sum.toFixed(2) + '</b></p><button id="n-next" style="padding:6px 12px">Next</button>'
    panel.querySelector('#n-next')!.addEventListener('click', squash)
  }

  function squash() {
    panel.innerHTML =
      '<b>Step 3 of 3: squash.</b> Totals can be any size, so the neuron squeezes its total into the range -1 to +1 with a function called <b>tanh</b>. ' +
      'Big totals land near 1, and small ones stay about the same.<br>' +
      '<table style="border-collapse:collapse;margin:8px 0">' + row(['total', '-3', '-1', '0', '1', '3', '<b>' + m.sum.toFixed(2) + '</b>']) +
      row(['after tanh', ...[-3, -1, 0, 1, 3].map((v) => Math.tanh(v).toFixed(2)), '<b>' + m.output.toFixed(2) + '</b>']) + '</table>' +
      'This neuron outputs <b>' + m.output.toFixed(2) + '</b>, and that number goes on to the steering output: positive steers right, negative steers left. Which way will the car steer?<br>' +
      '<button id="n-left" style="margin-top:8px;padding:6px 12px">Left</button> <button id="n-right" style="padding:6px 12px">Right</button> <span id="n-note"></span>'
    const note = panel.querySelector('#n-note') as HTMLElement
    const pick = (right: boolean) => {
      if (right === m.output > 0) onDone()
      else note.textContent = 'Look at the sign of ' + m.output.toFixed(2) + ' again.'
    }
    panel.querySelector('#n-left')!.addEventListener('click', () => pick(false))
    panel.querySelector('#n-right')!.addEventListener('click', () => pick(true))
  }

  multiply()
}
