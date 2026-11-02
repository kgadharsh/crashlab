import { C } from './theme'
import { makeRng } from './random'

// The lessons shown before each mission. People build each idea themselves first,
// and only then get its name. Each slide teaches one idea and says what success looks like.
export type LessonId = 'drive' | 'neuron' | 'hidden' | 'read' | 'weights' | 'training'

type Slide = {
  title: string
  body: string
  render?: () => void // fills the slide's controls
  update?: () => void // redraws whatever depends on them
  gate?: () => true | string // true when the slide's job is done
}

const T = Math.tanh
const fmt = (v: number, d = 1) => {
  const s = v.toFixed(d)
  return /^-0\.?0*$/.test(s) ? (0).toFixed(d) : s
}

const overlay = document.createElement('div')
overlay.className = 'lesson'
overlay.style.display = 'none'
overlay.innerHTML =
  '<div class="lesson-box"><p class="lesson-step" id="l-count"></p><h2 id="l-title"></h2><p id="l-body"></p>' +
  '<div id="l-ctl"></div><p class="lesson-error" id="l-error"></p>' +
  '<div class="actions lesson-nav"><button class="btn" id="l-back">Back</button><button class="btn primary" id="l-next">Next</button></div>' +
  '<div class="lesson-words" id="l-words"></div></div>'
document.body.appendChild(overlay)

const $ = (id: string) => overlay.querySelector('#' + id) as HTMLElement
const input = (id: string) => $(id) as HTMLInputElement
const ctl = (html: string) => ($('l-ctl').innerHTML = html)
const clearError = () => ($('l-error').textContent = '')

// A large card for a new idea: the moment it gets its name
const reveal = (word: string, meaning: string) => '<div class="reveal"><small>New idea</small><strong>' + word + '</strong><span>' + meaning + '</span></div>'

function slider(id: string, label: string, min: number, max: number, step: number, value: number): string {
  return '<label class="lesson-row"><span>' + label + '</span><input id="' + id + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"><b id="' + id + 'v">' + fmt(value) + '</b></label>'
}
function bind(id: string, set: (v: number) => void) {
  input(id).addEventListener('input', () => {
    const v = Number(input(id).value)
    set(v)
    $(id + 'v').textContent = fmt(v)
    clearError()
    current().update?.()
  })
}
function onClicks(selector: string, handle: (b: HTMLElement) => void) {
  overlay.querySelectorAll<HTMLElement>(selector).forEach((b) =>
    b.addEventListener('click', () => {
      handle(b)
      clearError()
      current().update?.()
    }),
  )
}

// ---------- SMALL DRAWINGS ----------
function sideView(left: number, right: number): string {
  return (
    '<svg viewBox="0 0 170 62" role="img" aria-label="Car between two walls">' +
    '<line x1="85" y1="48" x2="' + (85 - left * 75) + '" y2="48" stroke="' + C.accent + '" stroke-width="3"/>' +
    '<line x1="85" y1="48" x2="' + (85 + right * 75) + '" y2="48" stroke="' + C.accent + '" stroke-width="3"/>' +
    '<rect x="' + (83 - left * 75) + '" y="14" width="4" height="46" fill="' + C.wall + '"/>' +
    '<rect x="' + (83 + right * 75) + '" y="14" width="4" height="46" fill="' + C.wall + '"/>' +
    '<rect x="77" y="36" width="16" height="24" rx="4" fill="' + C.positive + '"/></svg>'
  )
}
function roadView(blocked: boolean, steer: number): string {
  return (
    '<svg viewBox="0 0 220 110" role="img" aria-label="Road"><rect x="30" width="160" height="110" fill="' + C.road + '"/>' +
    '<line x1="30" x2="30" y2="110" stroke="' + C.wall + '" stroke-width="3"/><line x1="190" x2="190" y2="110" stroke="' + C.wall + '" stroke-width="3"/>' +
    (blocked ? '<rect x="80" y="12" width="60" height="20" rx="4" fill="' + C.wall + '"/>' : '') +
    '<path d="M110 82 Q110 50 ' + (110 + steer * 75) + ' 26" fill="none" stroke="' + C.accent + '" stroke-width="2.5" stroke-dasharray="5 4"/>' +
    '<rect x="101" y="80" width="18" height="26" rx="5" fill="' + C.positive + '"/></svg>'
  )
}

// ---------- STEERING AND THE PEDAL, BUILT BY HAND ----------
const SPACE: [number, number, string][] = [[0.9, 0.2, 'Left'], [0.3, 0.8, 'Right'], [0.1, 0.7, 'Right']]
const PEDAL: [number, string][] = [[0.1, 'Brake'], [0.9, 'Gas']]
const way = (total: number) => (total > 0 ? 'Right' : total < 0 ? 'Left' : 'Undecided')

const picks: Record<number, string> = {}
let coneAnswer = ''
let leftW = 0
let rightW = 0
let chosen = [-1, 1] // the weights that solved the steering task
let zeroTest = -1
let zeroTried = false
const steeringWorks = () => SPACE.every((m) => way(leftW * m[0] + rightW * m[1]) === m[2])

let spaceW = 1
let bias = 0
const pedalWorks = () => PEDAL.every((m) => (aheadTotal(m[0]) > 0 ? 'Gas' : aheadTotal(m[0]) < 0 ? 'Brake' : '') === m[1])
const aheadTotal = (space: number) => spaceW * space + bias

let strength = 2
let curveOn = true
let curveTried = false

const CHECKS: [string, string[], string][] = [
  ['Which weight makes the car ignore left space?', ['0', '1', '-2'], '0'],
  ['Which weight makes left space count the most?', ['0', '-0.5', '-2'], '-2'],
  ['What is different between the two cars?', ['Their sensors', 'Only their weights', 'Their speed'], 'Only their weights'],
]
const checkAnswers: Record<number, string> = {}

// ---------- ONE NEURON IS NOT ENOUGH ----------
let gapW = 0
let swerved = false

// The four block moments. Position is on the picture; wanted is whether the car should swerve.
type Moment = { x: number; y: number; left: boolean; right: boolean; swerve: boolean; label: string }
const MOMENTS: Moment[] = [
  { x: 160, y: 300, left: false, right: false, swerve: false, label: 'No blocks: keep going' },
  { x: 480, y: 300, left: true, right: false, swerve: true, label: 'Block on left: swerve' },
  { x: 160, y: 100, left: false, right: true, swerve: true, label: 'Block on right: swerve' },
  { x: 480, y: 100, left: true, right: true, swerve: false, label: 'Both blocked: brake' },
]
const lines = { a1: 30, d1: 0, a2: 210, d2: -120 }
let twoNeurons = false
let linesMoved = false
let linesSolved = false

function halfPlane(angle: number, distance: number) {
  const r = (angle * Math.PI) / 180
  const nx = Math.cos(r)
  const ny = Math.sin(r)
  const px = 320 + nx * distance
  const py = 200 + ny * distance
  const far = 900
  const a = [px - ny * far, py + nx * far]
  const b = [px + ny * far, py - nx * far]
  return {
    has: (m: Moment) => (m.x - 320) * nx + (m.y - 200) * ny - distance > 0,
    area: a.join() + ' ' + b.join() + ' ' + [b[0] + nx * far, b[1] + ny * far].join() + ' ' + [a[0] + nx * far, a[1] + ny * far].join(),
    edge: 'x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"',
  }
}

function momentTile(m: Moment, right: boolean): string {
  const { x, y } = m
  let s =
    '<rect x="' + (x - 68) + '" y="' + (y - 72) + '" width="136" height="136" rx="8" fill="' + C.ground + '" stroke="' + (right ? '#3fb56b' : C.negative) + '" stroke-width="3"/>' +
    '<rect x="' + (x - 48) + '" y="' + (y - 68) + '" width="96" height="106" fill="' + C.road + '"/>'
  if (m.left) s += '<rect x="' + (x - 42) + '" y="' + (y - 52) + '" width="38" height="14" rx="3" fill="' + C.wall + '"/>'
  if (m.right) s += '<rect x="' + (x + 4) + '" y="' + (y - 52) + '" width="38" height="14" rx="3" fill="' + C.wall + '"/>'
  if (m.left && m.right) s += '<line x1="' + (x - 12) + '" y1="' + (y - 14) + '" x2="' + (x + 12) + '" y2="' + (y - 14) + '" stroke="' + C.text + '" stroke-width="3"/>'
  else s += '<path d="M' + x + ' ' + (y + 12) + ' Q' + x + ' ' + (y - 20) + ' ' + (x + (m.left ? 24 : m.right ? -24 : 0)) + ' ' + (y - 66) + '" fill="none" stroke="' + C.accent + '" stroke-width="2" stroke-dasharray="4 3"/>'
  return s + '<rect x="' + (x - 8) + '" y="' + (y + 10) + '" width="16" height="26" rx="4" fill="' + C.positive + '"/><text x="' + x + '" y="' + (y + 56) + '" text-anchor="middle" font-size="11" fill="' + C.text + '">' + m.label + '</text>'
}

// ---------- EVOLUTION ON THE BLOCK PROBLEM ----------
// A real, tiny training run: 3 neurons, 9 numbers. 100 brains, the best 10 survive.
// With these settings 95 of 100 test runs solved it, so the slide says so if a run gets stuck.
const CASES = [
  { left: 0, right: 0, want: -1, label: 'No blocks' },
  { left: 1, right: 0, want: 1, label: 'Block on left' },
  { left: 0, right: 1, want: 1, label: 'Block on right' },
  { left: 1, right: 1, want: -1, label: 'Both blocked' },
]
type Case = (typeof CASES)[number]
const SIZE = 100
const KEEP = 10
const runSmall = (g: number[], c: Case) => T(g[6] * T(g[0] * c.left + g[1] * c.right + g[2]) + g[7] * T(g[3] * c.left + g[4] * c.right + g[5]) + g[8])
const correct = (g: number[]) => CASES.filter((c) => (runSmall(g, c) > 0 ? 1 : -1) === c.want).length
const wrongness = (g: number[]) => CASES.reduce((sum, c) => sum + (runSmall(g, c) - c.want) ** 2, 0)

let seed = 1
let rng = makeRng(seed)
let pop: number[][] = []
let generation = 0
let history: number[] = []
const wobble = () => (rng() + rng() + rng() - 1.5) * 1.3
function freshBrains() {
  rng = makeRng(seed)
  pop = Array.from({ length: SIZE }, () => Array.from({ length: 9 }, () => wobble() * 2))
  pop.sort((a, b) => wrongness(a) - wrongness(b))
  generation = 0
  history = [wrongness(pop[0])]
}
function nextGeneration() {
  const best = pop.slice(0, KEEP)
  pop = [...best]
  while (pop.length < SIZE) {
    const parent = best[Math.floor(rng() * KEEP)]
    pop.push(parent.map((v) => (rng() < 0.5 ? v + wobble() * 2 : v)))
  }
  pop.sort((a, b) => wrongness(a) - wrongness(b))
  generation++
  history.push(wrongness(pop[0]))
}
freshBrains()
const randomBrain = pop[50].slice()

// ---------- PREDICTING THE REAL CAR ----------
const RAYS = [0.9, 0.7, 0.3, 0.2, 0.1]
const SPEED = 0.6
const ANGLES = [-60, -30, 0, 30, 60]
const sum1 = -3 * RAYS[0] - 3 * RAYS[1] + 3 * RAYS[3] + 3 * RAYS[4]
const sum2 = -3 * RAYS[2] + 1.5
const sum3 = 3 * SPEED
const [n1, n2, n3] = [T(sum1), T(sum2), T(sum3)]
const steerSum = 4 * n1
const pedalSum = 1.2 - 1.5 * n2 - 2 * n3
const PREDICTIONS: { ask: string; options: string[]; answer: string; hint: string; sum: string }[] = [
  { ask: 'Neuron 1 asks: is the right side more open than the left?', options: ['Yes', 'No'], answer: 'No', hint: 'Compare the two sides: the left lines are long and the right lines are short.',
    sum: '(0.9 × -3) + (0.7 × -3) + (0.2 × 3) + (0.1 × 3) = ' + fmt(sum1, 2) + '. The curve makes it ' + fmt(n1, 2) + ', a firm no.' },
  { ask: 'Neuron 2 asks: is a wall close ahead?', options: ['Yes', 'No'], answer: 'Yes', hint: 'Look at the line straight ahead.',
    sum: '(0.3 × -3) + bias 1.5 = ' + fmt(sum2, 2) + '. The curve makes it ' + fmt(n2, 2) + ', a fairly clear yes.' },
  { ask: 'Neuron 3 asks: am I going fast?', options: ['Yes', 'No'], answer: 'Yes', hint: 'The speed is 0.6 out of 1.',
    sum: '0.6 × 3 = ' + fmt(sum3, 2) + '. The curve makes it ' + fmt(n3, 2) + ', a yes.' },
  { ask: 'Steering listens to neuron 1. Which way does the car steer?', options: ['Left', 'Right'], answer: 'Left', hint: 'Neuron 1 said the right side is not more open.',
    sum: fmt(n1, 2) + ' × 4 = ' + fmt(steerSum, 2) + '. The curve makes it ' + fmt(T(steerSum), 2) + ', full left.' },
  { ask: 'The pedal listens to neurons 2 and 3. Gas or brake?', options: ['Gas', 'Brake'], answer: 'Brake', hint: 'A wall is close and the car is fast, and both weights are negative.',
    sum: 'Bias 1.2, then ' + fmt(n2, 2) + ' × -1.5, then ' + fmt(n3, 2) + ' × -2 = ' + fmt(pedalSum, 2) + '. The curve makes it ' + fmt(T(pedalSum), 2) + ', braking.' },
]
const predicted: Record<number, string> = {}

function carMoment(): string {
  let s = '<svg viewBox="0 0 640 210" role="img" aria-label="Car with long sensor lines to the left and short ones ahead and to the right"><rect x="170" width="300" height="210" fill="' + C.road + '"/>'
  ANGLES.forEach((deg, i) => {
    const r = (deg * Math.PI) / 180
    const reach = RAYS[i] * 170
    const x = 320 + Math.sin(r) * reach
    const y = 175 - Math.cos(r) * reach
    s += '<line x1="320" y1="175" x2="' + x + '" y2="' + y + '" stroke="' + C.accent + '" stroke-width="3"/><circle cx="' + x + '" cy="' + y + '" r="4" fill="' + C.accent + '"/>' +
      '<text x="' + (320 + Math.sin(r) * (reach + 18)) + '" y="' + (175 - Math.cos(r) * (reach + 18)) + '" text-anchor="middle" font-size="13" fill="' + C.text + '">' + RAYS[i] + '</text>'
  })
  return s + '<rect x="309" y="160" width="22" height="34" rx="5" fill="' + C.positive + '"/><text x="560" y="180" text-anchor="middle" font-size="13" fill="' + C.muted + '">Speed 0.6</text></svg>'
}

// ---------- THE SLIDES ----------
const LESSONS: Record<LessonId, { start: string; slides: Slide[] }> = {
  drive: {
    start: 'Start driving',
    slides: [
      {
        title: 'Teach a car to think',
        body: 'Neural networks are behind chatbots, face unlock and self-driving cars. Here, a small one drives a car, and you will open it up, change it and break it. You do not need maths or coding. Crashing costs nothing, and a short explanation comes before each mission.',
      },
      {
        title: 'The car cannot see',
        body: 'This car has no eyes. It has sensors that measure open space: <b>0</b> means touching a wall and <b>1</b> means wide open. <b>Your job:</b> using only the two numbers, pick a direction. Keep the car away from the walls in all three moments.',
        render() {
          ctl('<div class="lesson-grid">' + SPACE.map((m, k) => '<div>Left space <b>' + m[0] + '</b><br>Right space <b>' + m[1] + '</b><div id="pick' + k + '"></div><button class="btn" data-k="' + k + '" data-v="Left">Left</button> <button class="btn" data-k="' + k + '" data-v="Right">Right</button></div>').join('') + '</div>')
          onClicks('[data-k]', (b) => (picks[Number(b.dataset.k)] = b.dataset.v!))
        },
        update() {
          SPACE.forEach((m, k) => {
            if (picks[k]) $('pick' + k).innerHTML = sideView(m[0], m[1]) + '<span class="' + (picks[k] === m[2] ? 'good' : 'bad') + '">' + (picks[k] === m[2] ? 'Clear of the wall' : 'Heading for the wall') + '</span>'
          })
        },
        gate: () => SPACE.every((m, k) => picks[k] === m[2]) || 'Keep the car clear in all three moments first.',
      },
      {
        title: 'What it cannot sense',
        body: 'These two sensors point sideways. Both read <b>1.0</b>, wide open. A cone sits straight ahead, between them. Can the car avoid it?',
        render() {
          ctl(
            '<div id="cone"></div><svg viewBox="0 0 640 130" role="img" aria-label="Car with sideways sensors and a cone ahead"><line x1="320" y1="105" x2="120" y2="105" stroke="' + C.accent + '" stroke-width="3"/><line x1="320" y1="105" x2="520" y2="105" stroke="' + C.accent + '" stroke-width="3"/><rect x="309" y="88" width="22" height="34" rx="5" fill="' + C.positive + '"/><path d="M320 10 L336 44 L304 44 Z" fill="' + C.wall + '"/></svg>' +
              '<div class="actions"><button class="btn" data-a="yes">Yes, it will dodge</button><button class="btn" data-a="no">No, it cannot know</button></div>',
          )
          onClicks('[data-a]', (b) => (coneAnswer = b.dataset.a!))
        },
        update() {
          if (coneAnswer) $('cone').innerHTML = coneAnswer === 'no' ? reveal('Inputs', 'The numbers a network receives. They are all it knows about the world. What it cannot sense does not exist for it.') : '<p class="bad">Look again. Nothing in the two numbers shows the cone.</p>'
        },
        gate: () => coneAnswer === 'no' || 'Choose the right answer first.',
      },
      {
        title: 'Your turn: drive one lap',
        body: 'Before we open the brain, do its job yourself. Finish one lap without hitting a wall or a block. A crash puts the car back at the start, so just try again. It is easier if you go slowly.',
      },
    ],
  },
  neuron: {
    start: 'Open the real neuron',
    slides: [
      {
        title: 'Turn your thinking into a sum',
        body: 'You judged the road in your head, but the car can only do arithmetic. Each number gets a <b>multiplier</b>, which decides how much it counts and which way it pulls. Bigger counts more. Negative pulls the other way. Both results are added into one total. <b>Above 0 steers right, below 0 steers left.</b> <b>Your job:</b> left space should pull left and right space should pull right. Get all three moments correct.',
        render() {
          ctl(slider('wl', 'Left multiplier', -2, 2, 0.5, leftW) + slider('wr', 'Right multiplier', -2, 2, 0.5, rightW) + '<div class="lesson-grid" id="out"></div>')
          bind('wl', (v) => (leftW = v))
          bind('wr', (v) => (rightW = v))
        },
        update() {
          $('out').innerHTML = SPACE.map((m) => {
            const total = leftW * m[0] + rightW * m[1]
            return '<div>(' + m[0] + ' × ' + fmt(leftW) + ') + (' + m[1] + ' × ' + fmt(rightW) + ') = <b>' + fmt(total, 2) + '</b><br><span class="' + (way(total) === m[2] ? 'good' : 'bad') + '">' + way(total) + ', wanted ' + m[2] + '</span></div>'
          }).join('')
        },
        gate() {
          if (!steeringWorks()) return 'Not all three are right yet. A negative left multiplier makes left space pull left.'
          chosen = [leftW, rightW]
          zeroTest = leftW
          return true
        },
      },
      {
        title: 'What does a multiplier of 0 do?',
        body: 'Your rule works. <b>Your job:</b> slide the left multiplier to 0 and see which moment breaks.',
        render() {
          ctl(slider('z', 'Left multiplier', -2, 2, 0.5, zeroTest) + '<div class="lesson-grid" id="out"></div><p id="zero"></p>')
          bind('z', (v) => {
            zeroTest = v
            if (v === 0) zeroTried = true
          })
        },
        update() {
          $('out').innerHTML = SPACE.map((m) => {
            const d = way(zeroTest * m[0] + chosen[1] * m[1])
            return '<div>Left ' + m[0] + ', right ' + m[1] + '<br><span class="' + (d === m[2] ? 'good' : 'bad') + '">' + d + ', wanted ' + m[2] + '</span></div>'
          }).join('')
          $('zero').textContent = zeroTried ? 'At 0, the left number is multiplied away, so the car ignores it.' : 'Slide it all the way to 0.'
        },
        gate: () => zeroTried || 'Slide the left multiplier to 0 first.',
      },
      {
        title: 'You just set weights',
        body: 'This is the most important idea in neural networks. The car has no rules written inside it. <b>Everything it knows how to do is stored in its weights.</b> Change the weights and the same car drives differently.',
        render() {
          const m = SPACE[0]
          ctl(
            reveal('Weights', 'Numbers that decide how much each input matters and which way it pulls. Yours are ' + fmt(chosen[0]) + ' and ' + fmt(chosen[1]) + '.') +
              '<div class="lesson-grid"><div><b>Your car</b><br>Weights ' + fmt(chosen[0]) + ' and ' + fmt(chosen[1]) + sideView(m[0], m[1]) + '<span class="good">Steers ' + way(chosen[0] * m[0] + chosen[1] * m[1]) + ', away from the wall</span></div>' +
              '<div><b>Same car, flipped weights</b><br>Weights ' + fmt(-chosen[0]) + ' and ' + fmt(-chosen[1]) + sideView(m[0], m[1]) + '<span class="bad">Steers ' + way(-chosen[0] * m[0] - chosen[1] * m[1]) + ', into the wall</span></div></div>' +
              CHECKS.map((q, k) => '<div class="lesson-question"><b>' + q[0] + '</b><br>' + q[1].map((o) => '<button class="btn" data-c="' + k + '" data-v="' + o + '">' + o + '</button>').join(' ') + ' <span id="check' + k + '"></span></div>').join(''),
          )
          onClicks('[data-c]', (b) => (checkAnswers[Number(b.dataset.c)] = b.dataset.v!))
        },
        update() {
          CHECKS.forEach((q, k) => {
            if (checkAnswers[k]) $('check' + k).innerHTML = checkAnswers[k] === q[2] ? '<span class="good">Right</span>' : '<span class="bad">Try again</span>'
          })
        },
        gate: () => CHECKS.every((q, k) => checkAnswers[k] === q[2]) || 'Answer all three questions correctly first.',
      },
      {
        title: 'A new job: the pedal',
        body: 'Steering is done. Now use one new number, the <b>space ahead</b>, to control the pedal. <b>Above 0 means gas, below 0 means brake.</b> Space is never negative, and neither is this weight, so the total can never go below 0 and the car can never brake. To fix that, add a <b>starting number</b> to the total. <b>Your job:</b> brake when the space is 0.1 and accelerate when it is 0.9.',
        render() {
          ctl('<div id="idea"></div>' + slider('sw', 'Weight on space', 0, 2, 0.5, spaceW) + slider('sb', 'Starting number', -2, 2, 0.1, bias) + '<div class="lesson-grid" id="out"></div>')
          bind('sw', (v) => (spaceW = v))
          bind('sb', (v) => (bias = v))
        },
        update() {
          $('out').innerHTML = PEDAL.map((m) => {
            const total = aheadTotal(m[0])
            const d = total > 0 ? 'Gas' : total < 0 ? 'Brake' : 'Undecided'
            return '<div>(' + m[0] + ' × ' + fmt(spaceW) + ') + ' + fmt(bias) + ' = <b>' + fmt(total, 2) + '</b><br><span class="' + (d === m[1] ? 'good' : 'bad') + '">' + d + ', wanted ' + m[1] + '</span></div>'
          }).join('')
          $('idea').innerHTML = pedalWorks() ? reveal('Bias', 'A number added to every total, so the neuron has a starting lean. Yours leans towards braking until there is enough space.') : ''
        },
        gate: () => pedalWorks() || 'Make it brake at 0.1 and accelerate at 0.9. Try a negative starting number.',
      },
      {
        title: 'A steering wheel has limits',
        body: 'Back to steering, with left space 0.2 and right space 0.9. Make both weights stronger: the left becomes negative that amount and the right positive. The total keeps growing, but the wheel can only turn from <b>-1</b> (full left) to <b>+1</b> (full right). <b>Your job:</b> turn up the strength, then switch the curve off and on.',
        render() {
          ctl(
            '<div id="idea"></div>' + slider('st', 'Strength of both weights', 1, 40, 1, strength) +
              '<div class="lesson-grid"><div>Calculation<br><b id="sum"></b></div><div>Total<br><b class="lesson-big" id="total"></b></div><div>Sent to the wheel<br><b class="lesson-big" id="wheel"></b></div></div>' +
              '<svg id="curve" viewBox="0 0 640 140" role="img" aria-label="S-shaped curve"></svg><div class="actions"><button class="btn" id="toggle"></button></div>',
          )
          bind('st', (v) => (strength = v))
          onClicks('#toggle', () => {
            curveOn = !curveOn
            curveTried = true
          })
        },
        update() {
          const total = strength * 0.7
          const out = curveOn ? T(total) : total
          $('sum').textContent = '(0.2 × -' + strength + ') + (0.9 × ' + strength + ')'
          $('toggle').textContent = curveOn ? 'Turn the curve off' : 'Turn the curve on'
          $('total').textContent = fmt(total)
          $('wheel').innerHTML = fmt(out, 2) + (out > 1.001 ? ' <span class="bad">not possible</span>' : '')
          let path = ''
          for (let u = -6; u <= 6; u += 0.2) path += (path ? 'L' : 'M') + (320 + u * 45) + ' ' + (70 - T(u) * 55) + ' '
          const dot = Math.min(total, 6)
          $('curve').innerHTML = '<line x1="50" y1="70" x2="590" y2="70" stroke="' + C.wall + '"/><path d="' + path + '" fill="none" stroke="' + C.positive + '" stroke-width="2.5"/><circle cx="' + (320 + dot * 45) + '" cy="' + (70 - T(dot) * 55) + '" r="7" fill="' + C.accent + '"/>'
          $('idea').innerHTML = curveTried ? reveal('Activation function', 'A curve that turns any total into a limited answer. It is nearly straight in the middle and flat at both ends. This one is called tanh.') : ''
        },
        gate: () => curveTried || 'Switch the curve off once to see what it does.',
      },
      {
        title: 'You just built a neuron',
        body: 'Here is your steering rule on the moment with left 0.3 and right 0.8. Your weights are what make it ask this question. Different weights would make it ask something else. The name comes loosely from brain cells, but nothing inside it is alive.',
        render() {
          const total = chosen[0] * 0.3 + chosen[1] * 0.8
          ctl(
            reveal('Neuron', 'One small question answered with a number. Yours asks, "Is the right side more open?"') +
              '<div class="lesson-flow"><div>Inputs<br>0.3, 0.8</div><span>×</span><div>Weights<br>' + fmt(chosen[0]) + ', ' + fmt(chosen[1]) + '</div><span>+</span><div>Bias<br>0.0</div><span>=</span><div>Total<br>' + fmt(total, 2) + '</div><span>→</span><div>Curve<br>' + fmt(T(total), 2) + '</div></div>',
          )
        },
      },
      {
        title: 'Your turn: a real neuron',
        body: 'The car is frozen mid-lap, and one of its real neurons is outlined. It has six inputs: five sensors and speed. <b>Your job:</b> move its six weights until the car would steer left. The bars show each input pulling, and the line on the track shows where the car would go.',
      },
    ],
  },
  hidden: {
    start: 'Show me the neurons',
    slides: [
      {
        title: 'Problem 1: the car cannot tell two roads apart',
        body: 'New rule: <b>if something blocks the road, swerve. If the road is clear, go straight.</b> The car has one input: <b>how much wider the right side is</b>, which is 0.6 on both roads below. <b>Your job:</b> find a weight that gets both roads right.',
        render() {
          ctl(slider('gw', 'Weight on the input', 0, 3, 0.5, gapW) + '<div class="lesson-grid" id="out"></div><p id="lesson"></p>')
          bind('gw', (v) => (gapW = v))
        },
        update() {
          const total = gapW * 0.6
          const out = T(total)
          const swerves = out > 0.3
          if (swerves) swerved = true
          $('out').innerHTML =
            '<div><b>Road A: block ahead</b><br>Wanted: swerve' + roadView(true, out) + '<span class="' + (swerves ? 'good' : 'bad') + '">' + (swerves ? 'Misses the block' : 'Hits the block') + '</span></div>' +
            '<div><b>Road B: clear</b><br>Wanted: straight' + roadView(false, out) + '<span class="' + (swerves ? 'bad' : 'good') + '">' + (swerves ? 'Swerves for nothing' : 'Stays straight') + '</span></div>' +
            '<div><b>The sum, same on both roads</b><br>0.6 × ' + fmt(gapW) + ' = ' + fmt(total, 2) + '<br>Curve: ' + fmt(out, 2) + '<br>' + (swerves ? 'Swerve' : 'Straight') + '</div>'
          $('lesson').textContent = swerved ? 'The car gets the same number on both roads, so it cannot tell them apart. It needs more inputs.' : ''
        },
        gate: () => swerved || 'Raise the weight until the car swerves on Road A.',
      },
      {
        title: 'Problem 2: more inputs are still not enough',
        body: 'Now the car has two front sensors that look for blocks, so it can tell the roads apart. <b>No block:</b> keep going. <b>One block:</b> swerve round it. <b>Two blocks:</b> no way round, so brake. A neuron decides by drawing <b>one straight line</b>: yes on the shaded side, no on the other. <b>Your job:</b> put the two swerving cars on the shaded side and the other two outside it.',
        render() {
          const line = (id: 'a1' | 'd1' | 'a2' | 'd2', label: string, turn: boolean) =>
            '<label class="lesson-row"><span>' + label + '</span><input id="' + id + '" type="range" min="' + (turn ? 0 : -190) + '" max="' + (turn ? 355 : 190) + '" step="5" value="' + lines[id] + '"></label>'
          ctl(
            '<svg id="map" viewBox="0 0 640 400" role="img" aria-label="Four road scenes with dividing lines"></svg>' + line('a1', 'Turn line 1', true) + line('d1', 'Move line 1', false) +
              '<div id="second">' + line('a2', 'Turn line 2', true) + line('d2', 'Move line 2', false) + '</div><p class="lesson-score" id="score"></p><div class="actions"><button class="btn" id="add"></button></div><p id="lesson"></p>',
          )
          for (const id of ['a1', 'd1', 'a2', 'd2'] as const) {
            input(id).addEventListener('input', () => {
              lines[id] = Number(input(id).value)
              linesMoved = true
              clearError()
              current().update?.()
            })
          }
          onClicks('#add', () => (twoNeurons = !twoNeurons))
        },
        update() {
          const first = halfPlane(lines.a1, lines.d1)
          const second = halfPlane(lines.a2, lines.d2)
          let right = 0
          let tiles = ''
          for (const m of MOMENTS) {
            const ok = (first.has(m) && (!twoNeurons || second.has(m))) === m.swerve
            if (ok) right++
            tiles += momentTile(m, ok)
          }
          if (twoNeurons && right === 4) linesSolved = true
          $('map').innerHTML =
            '<defs><clipPath id="frame"><rect width="640" height="400" rx="8"/></clipPath><clipPath id="side"><polygon points="' + first.area + '"/></clipPath></defs><rect width="640" height="400" rx="8" fill="' + C.ground + '"/>' +
            '<g clip-path="url(#frame)"><g clip-path="url(#side)"><polygon points="' + (twoNeurons ? second.area : first.area) + '" fill="' + C.accent + '" opacity=".28"/></g><line ' + first.edge + ' stroke="' + C.text + '" stroke-width="3"/>' + (twoNeurons ? '<line ' + second.edge + ' stroke="' + C.text + '" stroke-width="3" stroke-dasharray="10 6"/>' : '') + '</g>' + tiles
          $('score').textContent = right + ' of 4 correct'
          $('second').style.display = twoNeurons ? 'block' : 'none'
          $('add').textContent = twoNeurons ? 'Back to one neuron' : 'Add a second neuron'
          $('lesson').textContent = twoNeurons
            ? linesSolved ? 'Two neurons, two lines. More inputs give the car more information. More neurons let it combine that information.' : 'Only the area on the shaded side of both lines counts as swerve. Aim for a band through the two swerving cars.'
            : linesMoved ? 'One neuron draws one straight line, and these four cars cannot be split by one line. Try adding a second neuron.' : ''
        },
        gate: () => linesSolved || 'Add a second neuron and get all 4 correct.',
      },
      {
        title: 'What the extra neurons do',
        body: 'The two lines are two questions. Neuron A asks, "Is there at least one block?" Neuron B asks, "Are there two blocks?" A final neuron combines them: <b>swerve if A says yes and B says no</b>. Their weights are what make them ask this. The curve matters too: it makes each answer close to yes or no. Without it, everything would merge into one big sum, and you would be back to one line.',
        render() {
          const answer = (c: Case) => [T(6 * c.left + 6 * c.right - 3), T(6 * c.left + 6 * c.right - 9)]
          ctl(
            reveal('Hidden layer', 'Neurons between the inputs and the final answer. Their weights break one hard problem into smaller questions.') +
              '<div class="lesson-grid">' + CASES.map((c) => {
                const [a, b] = answer(c)
                return '<div><b>' + c.label + '</b><br>A: ' + (a > 0 ? 'Yes' : 'No') + '<br>B: ' + (b > 0 ? 'Yes' : 'No') + '<br><span class="good">' + (c.want > 0 ? 'Swerve' : c.left ? 'Brake' : 'Keep going') + '</span></div>'
              }).join('') + '</div><div class="lesson-grid"><div><b>Neuron A</b><br>Each block × 6, bias -3</div><div><b>Neuron B</b><br>Each block × 6, bias -9</div><div><b>Final neuron</b><br>A × 3, B × -3, bias -3</div></div>',
          )
        },
      },
      {
        title: 'Your turn: read the road',
        body: 'The real car has five hidden neurons, and its starter brain uses three. Pick a neuron and the road shows its answer at each spot of a real lap. <b>Your job:</b> try all three and work out what each one is asking.',
        render() {
          ctl('<div class="key"><span><i class="yes"></i>Blue: yes</span><span><i class="no"></i>Red: no</span><span><i class="unsure"></i>Faint: unsure</span></div>')
        },
      },
    ],
  },
  read: {
    start: 'Start guessing',
    slides: [
      {
        title: 'Meet the real car',
        body: 'The real car has the same parts with more of them: <b>6 inputs</b> (five sensors and speed), <b>5 hidden neurons</b>, and <b>2 outputs</b>. Its starter network was written by hand and uses three of the five hidden neurons. Read the weights below: they are what make each neuron ask its question.',
        render() {
          ctl(
            reveal('Outputs', 'The final neurons, whose answers become actions: here, steering and the pedal.') +
              '<div class="lesson-grid"><div><b>Neuron 1: is the right more open?</b><br>Left sensors × -3, right sensors × 3</div><div><b>Neuron 2: is a wall close ahead?</b><br>Ahead sensor × -3, bias 1.5</div><div><b>Neuron 3: am I going fast?</b><br>Speed × 3</div><div><b>Steering output</b><br>Neuron 1 × 4</div><div><b>Pedal output</b><br>Neuron 2 × -1.5, neuron 3 × -2, bias 1.2</div></div>',
          )
        },
      },
      {
        title: 'Predict the car',
        body: 'This is one frozen moment. The lines show the five sensors, and a longer line means more open space. <b>Your job:</b> use the picture to answer each question. Guessing wrong is fine, because each answer shows the sum behind it.',
        render() {
          ctl(carMoment() + '<div id="predictions"></div>')
        },
        update() {
          const reached = Object.keys(predicted).length
          let html = ''
          PREDICTIONS.forEach((q, k) => {
            if (k > reached) return
            html += '<div class="lesson-question"><b>' + q.ask + '</b><br>'
            if (predicted[k]) html += '<span class="' + (predicted[k] === q.answer ? 'good' : 'bad') + '">You said ' + predicted[k] + '. It said ' + q.answer + '.</span> ' + q.sum
            else html += q.hint + '<br>' + q.options.map((o) => '<button class="btn" data-p="' + k + '" data-v="' + o + '">' + o + '</button>').join(' ')
            html += '</div>'
          })
          if (reached === PREDICTIONS.length) html += '<p><b>One thought is done: steer left and brake.</b> The car repeats this 60 times a second.</p>'
          $('predictions').innerHTML = html
          onClicks('[data-p]', (b) => (predicted[Number(b.dataset.p)] = b.dataset.v!))
        },
        gate: () => Object.keys(predicted).length === PREDICTIONS.length || 'Make all five predictions first.',
      },
      {
        title: 'Your turn: read the brain',
        body: 'Same game, real track. You will see six frozen moments and answer a question about each, such as which way the car will steer or whether it will brake. <b>Your job:</b> look at the sensors first, then guess. The answer appears after you choose.',
      },
    ],
  },
  weights: {
    start: 'Start setting weights',
    slides: [
      {
        title: 'One weight changes the whole drive',
        body: 'Every moment of a lap uses the same weights, so changing one number changes the whole drive. Here the car is yours: its neurons already ask their three questions, and you set how strongly the outputs listen. <b>Your job:</b> move the three sliders until the car laps by itself. Change one slider at a time. The line on the track shows where the car will go, and it turns into dashes with a cross if it will crash. It may take several tries, and that is the point: finding even three weights by hand is slow.',
      },
    ],
  },
  training: {
    start: 'Start evolution',
    slides: [
      {
        title: 'How wrong is a brain?',
        body: 'Remember neurons A, B and the final neuron. Together they have 9 numbers: 6 weights and 3 biases. You saw good values for them. Here they are random. <b>Error</b> adds up how far each answer is from the right one, and big misses count extra. +1 means swerve and -1 means do not swerve. Lower error is better, and 0 is perfect.',
        render() {
          ctl('<div class="lesson-grid">' + CASES.map((c) => '<div>' + c.label + '<br>Wanted <b>' + fmt(c.want, 0) + '</b>, said <b>' + fmt(runSmall(randomBrain, c), 2) + '</b></div>').join('') + '<div>Error for this brain<br><b class="lesson-big">' + fmt(wrongness(randomBrain), 2) + '</b></div></div>')
        },
      },
      {
        title: 'Let it find its own weights',
        body: 'One <b>generation</b>: test 100 brains, keep the 10 with the lowest error, then fill the rest with copies that have random changes to their weights. Repeat. Nobody tells them the answer. <b>Your job:</b> run generations until the best brain gets all four moments.',
        render() {
          ctl(
            '<div id="idea"></div><div class="lesson-grid"><div>Generation<br><b class="lesson-big" id="gen"></b></div><div>Moments correct<br><b class="lesson-big" id="right"></b></div><div>Lowest error<br><b class="lesson-big" id="err"></b></div></div>' +
              '<svg id="bars" viewBox="0 0 640 100" role="img" aria-label="Error falling by generation"></svg><p id="cases"></p><div class="actions"><button class="btn primary" id="one">Run one generation</button><button class="btn" id="ten">Run ten</button><button class="btn" id="fresh">New random brains</button></div>',
          )
          onClicks('#one', nextGeneration)
          onClicks('#ten', () => {
            for (let i = 0; i < 10; i++) nextGeneration()
          })
          onClicks('#fresh', () => {
            seed++
            freshBrains()
          })
        },
        update() {
          const best = pop[0]
          const most = Math.max(...history, 0.01)
          const width = 620 / Math.max(history.length, 20)
          const done = correct(best) === 4
          $('gen').textContent = String(generation)
          $('right').textContent = correct(best) + ' of 4'
          $('err').textContent = fmt(wrongness(best), 2)
          $('bars').innerHTML = '<line x1="10" y1="92" x2="630" y2="92" stroke="' + C.wall + '"/>' + history.map((e, i) => '<rect x="' + (10 + i * width) + '" y="' + (92 - (e / most) * 84) + '" width="' + Math.max(width - 2, 1) + '" height="' + (e / most) * 84 + '" fill="' + C.positive + '"/>').join('')
          $('cases').innerHTML = CASES.map((c) => {
            const out = runSmall(best, c)
            return c.label + ': <span class="' + ((out > 0 ? 1 : -1) === c.want ? 'good' : 'bad') + '">' + (out > 0 ? 'Swerve' : 'No swerve') + '</span>'
          }).join(' | ')
          $('idea').innerHTML = done
            ? reveal('Training', 'Finding the weights automatically. Only the weights changed, and that alone made the brain work. Evolution is one way. Most AI uses gradient descent, which calculates which way to adjust each weight instead of trying random changes.')
            : generation >= 40 ? '<p>This group has got stuck on an answer that is nearly right. Real training can do this too. Press New random brains to start again.</p>' : ''
        },
        gate: () => correct(pop[0]) === 4 || 'Keep running until it gets all four moments.',
      },
      {
        title: 'Your turn: all 47 numbers',
        body: 'Now the real thing. The car has 47 weights and biases, and 100 random cars will try the track. <b>Your job:</b> press Train a new brain and watch the cars improve, then test the winner on tracks it has never driven.',
      },
    ],
  },
}

// ---------- SHOWING A LESSON ----------
let lesson = LESSONS.drive
let index = 0
let finished: (() => void) | null = null
let reviewing = false
const words: string[] = []
const WORDS = ['Inputs', 'Weights', 'Bias', 'Activation function', 'Neuron', 'Hidden layer', 'Outputs', 'Training']
const current = () => lesson.slides[index]

function showSlide() {
  const s = current()
  $('l-count').textContent = 'Step ' + (index + 1) + ' of ' + lesson.slides.length
  $('l-title').textContent = s.title
  $('l-body').innerHTML = s.body
  clearError()
  ctl('')
  s.render?.()
  s.update?.()
  $('l-back').style.visibility = index ? 'visible' : 'hidden'
  $('l-next').textContent = index < lesson.slides.length - 1 ? 'Next' : reviewing ? 'Back to the mission' : lesson.start
  overlay.scrollTop = 0
  noteWord()
}

// The ideas earned so far collect at the bottom, as a growing glossary
function noteWord() {
  const seen = overlay.querySelector('.reveal strong')?.textContent
  if (seen && WORDS.includes(seen) && !words.includes(seen)) words.push(seen)
  $('l-words').innerHTML = words.map((w) => '<span>' + w + '</span>').join('')
}

$('l-back').addEventListener('click', () => {
  index--
  showSlide()
})
$('l-next').addEventListener('click', () => {
  const pass = reviewing ? true : (current().gate?.() ?? true)
  if (pass !== true) {
    $('l-error').textContent = pass
    return
  }
  noteWord()
  if (index < lesson.slides.length - 1) {
    index++
    showSlide()
    return
  }
  overlay.style.display = 'none'
  const done = finished
  finished = null
  done?.()
})

export const lessonOpen = () => overlay.style.display !== 'none'

export function showLesson(id: LessonId, onDone: () => void, review = false) {
  lesson = LESSONS[id]
  index = 0
  finished = onDone
  reviewing = review
  overlay.style.display = 'block'
  showSlide()
}
