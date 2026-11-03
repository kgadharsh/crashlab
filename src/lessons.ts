import { C } from './theme'
import { makeRng } from './random'

// The short lessons shown before each mission, built around one goal (docs/focus.md):
// a neuron is a weighted vote on what the sensors see. Each slide has one idea and one task.
export type LessonId = 'drive' | 'neuron' | 'hidden' | 'read' | 'training'

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


// ---------- A SMALL DRAWING ----------
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

// ---------- STEERING, BUILT BY HAND ----------
const SPACE: [number, number, string][] = [[0.9, 0.2, 'Left'], [0.3, 0.8, 'Right'], [0.1, 0.7, 'Right']]
const way = (total: number) => (total > 0 ? 'Right' : total < 0 ? 'Left' : 'Undecided')

const picks: Record<number, string> = {}
let leftW = 0
let rightW = 0
let chosen = [-1, 1] // the weights that solved the steering task
const steeringWorks = () => SPACE.every((m) => way(leftW * m[0] + rightW * m[1]) === m[2])

// ---------- EVOLUTION ON A SMALL PROBLEM ----------
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

// ---------- THE SLIDES ----------
const LESSONS: Record<LessonId, { start: string; slides: Slide[] }> = {
  drive: {
    start: 'Start the warm-up',
    slides: [
      {
        title: 'A car that thinks',
        body: 'A small neural network drives this car. In a few minutes you will see how it decides, using sliders instead of maths.<br><br><b>First, an optional warm-up:</b> try one lap yourself. Go slowly. If it is hard, skip it: you will not miss anything.',
      },
    ],
  },
  neuron: {
    start: 'Open the real neuron',
    slides: [
      {
        title: 'The car cannot see',
        body: 'The car has no eyes, only sensors that measure open space: <b>0</b> means touching a wall and <b>1</b> means wide open. <b>Your job:</b> you decide for the car. In each box, read the two numbers and press <b>Left</b> or <b>Right</b>. Keep it away from the walls.',
        render() {
          ctl('<div id="idea"></div><div class="lesson-grid">' + SPACE.map((m, k) => '<div>Left space <b>' + m[0] + '</b><br>Right space <b>' + m[1] + '</b><div id="pick' + k + '"></div><button class="btn" data-k="' + k + '" data-v="Left">Left</button> <button class="btn" data-k="' + k + '" data-v="Right">Right</button></div>').join('') + '</div>')
          onClicks('[data-k]', (b) => (picks[Number(b.dataset.k)] = b.dataset.v!))
        },
        update() {
          SPACE.forEach((m, k) => {
            if (picks[k]) $('pick' + k).innerHTML = sideView(m[0], m[1]) + '<span class="' + (picks[k] === m[2] ? 'good' : 'bad') + '">' + (picks[k] === m[2] ? 'Clear of the wall' : 'Heading for the wall') + '</span>'
          })
          $('idea').innerHTML = SPACE.every((m, k) => picks[k] === m[2])
            ? reveal('Inputs', 'The numbers the car gets from its sensors. They are everything it knows: anything its sensors miss does not exist for it.')
            : ''
        },
        gate: () => SPACE.every((m, k) => picks[k] === m[2]) || 'Keep the car clear in all three boxes first.',
      },
      {
        title: 'Turn your choice into a vote',
        body: 'You chose the side with more space. The car can only multiply and add, so each sensor gets a vote:<br><br>1. Multiply the left space by the left slider.<br>2. Multiply the right space by the right slider.<br>3. Add the two votes. <b>Above 0 turns right, below 0 turns left.</b><br><br>A negative slider pulls the total below 0, and 0 means "ignore this sensor". <b>Your job:</b> move the sliders until all three boxes turn green.',
        render() {
          ctl('<div id="idea"></div>' + slider('wl', 'Left slider', -2, 2, 0.5, leftW) + slider('wr', 'Right slider', -2, 2, 0.5, rightW) + '<div class="lesson-grid" id="out"></div>')
          bind('wl', (v) => (leftW = v))
          bind('wr', (v) => (rightW = v))
        },
        update() {
          $('out').innerHTML = SPACE.map((m) => {
            const total = leftW * m[0] + rightW * m[1]
            return '<div>(' + m[0] + ' × ' + fmt(leftW) + ') + (' + m[1] + ' × ' + fmt(rightW) + ') = <b>' + fmt(total, 2) + '</b><br><span class="' + (way(total) === m[2] ? 'good' : 'bad') + '">' + way(total) + ', wanted ' + m[2] + '</span></div>'
          }).join('')
          $('idea').innerHTML = steeringWorks()
            ? reveal('Weights', 'The sliders are called weights. Each one decides how loud a sensor\'s vote is and which way it pushes. Everything the car knows is stored in its weights.')
            : ''
        },
        gate() {
          if (!steeringWorks()) return 'Not all three are right yet. Try a negative left slider.'
          chosen = [leftW, rightW]
          return true
        },
      },
      {
        title: 'That is a neuron',
        body: 'Read the boxes from left to right: your recipe on one moment. Real neurons add two small steps: a <b>bias</b>, a fixed number added to the total so it has a starting lean, and a step that squeezes the total into the range -1 to +1, so a huge total still means "fully right".<br><br><b>Next:</b> a real neuron with six inputs. Move its weights until the car would steer left.',
        render() {
          const total = chosen[0] * 0.3 + chosen[1] * 0.8
          ctl(
            reveal('Neuron', 'A weighted vote: each input votes, its weight decides how loud and which way, and the votes are added up into one answer.') +
              '<div class="lesson-flow"><div>Sensors<br>0.3, 0.8</div><span>×</span><div>Weights<br>' + fmt(chosen[0]) + ', ' + fmt(chosen[1]) + '</div><span>=</span><div>Votes added<br>' + fmt(total, 2) + '</div><span>→</span><div>Answer<br>' + way(total) + '</div></div>',
          )
        },
      },
    ],
  },
  hidden: {
    start: 'Show me the neurons',
    slides: [
      {
        title: 'Many neurons, many questions',
        body: 'The real car has five neurons between its sensors and its controls. Each is a weighted vote with its own weights, so each answers a different question, such as "Is a wall close ahead?". Its starter brain uses three of them.<br><br><b>Your job:</b> pick a neuron, and the road shows its answer at each spot of a real lap. Try all three and work out what each one asks.',
        render() {
          ctl(
            reveal('Hidden layer', 'The neurons between the inputs and the final answer. Their answers are the votes for the next step.') +
              '<div class="key"><span><i class="yes"></i>Blue: yes</span><span><i class="no"></i>Red: no</span><span><i class="unsure"></i>Faint: unsure</span></div>',
          )
        },
      },
    ],
  },
  read: {
    start: 'Start guessing',
    slides: [
      {
        title: 'How the votes become driving',
        body: 'The last two neurons are the <b>outputs</b>: one for steering, one for the pedal. They take the hidden neurons\' answers as votes, the same way your recipe took the sensors.<br><br><b>Your job:</b> the car will freeze at six moments. Look at its sensor lines, predict what it does next, and then see the answer.',
        render() {
          ctl(
            reveal('Outputs', 'The final neurons, whose answers become actions: here, steering and the pedal.') +
              '<div class="lesson-grid"><div><b>Steering</b><br>Follows the neuron that asks "Is the right more open?": yes turns right, no turns left</div><div><b>Pedal</b><br>Wants gas, but a close wall or high speed votes for the brake</div></div>',
          )
        },
      },
    ],
  },
  training: {
    start: 'Start evolution',
    slides: [
      {
        title: 'Nobody sets the weights by hand',
        body: 'The real car has 47 weights, far too many to set by hand. <b>Training</b> finds them. Here is a mini version: tiny brains learn when to swerve round blocks (one block: swerve; none or two: do not). Each brain gets an <b>error</b> score for how wrong its answers are. The best 10 of 100 survive, and the rest are copies with small random changes to their weights.<br><br><b>Your job:</b> run generations until the best brain gets all four right.',
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
            ? reveal('Training', 'Finding the weights automatically. Only the weights changed. Next, 100 real cars do the same with all 47.')
            : generation >= 40 ? '<p>This group has got stuck on an answer that is nearly right. Real training can do this too. Press New random brains to start again.</p>' : ''
        },
        gate: () => correct(pop[0]) === 4 || 'Keep running until it gets all four moments.',
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
const WORDS = ['Inputs', 'Weights', 'Neuron', 'Hidden layer', 'Outputs', 'Training']
const current = () => lesson.slides[index]

function showSlide() {
  const s = current()
  $('l-count').textContent = lesson.slides.length > 1 ? 'Step ' + (index + 1) + ' of ' + lesson.slides.length : ''
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
