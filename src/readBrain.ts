import { starterBrain, think, type Brain } from './brain'
import { createCar, faceAngle, getInputs, predictPath, step, USE_GRIP, type Car } from './sim'

const TILT = 0.4 // how far the car is turned off its line, so both answers come up
const HARD_TILT = 1.2 // turned hard at a wall, where some cars cannot recover
const NEURONS = ['Which side is more open', 'A wall ahead', 'Its speed']

export type Round = {
  car: Car
  brain: Brain
  question: string
  hint: string
  options: string[]
  answer: number // index into options
  why: string
}
type Moment = { car: Car; brain: Brain; outputs: number[]; hidden: number[] }
type Question = (m: Moment) => Round | null

const round = (m: Moment, question: string, hint: string, options: string[], answer: number, why: string): Round => ({
  car: m.car, brain: m.brain, question, hint, options, answer, why,
})

// Each question answers from the real brain at this moment, or passes if the moment is unclear
const steering: Question = (m) => {
  if (Math.abs(m.hidden[0]) < 0.4) return null
  const right = m.outputs[0] > 0
  return round(m, 'The car is paused here. Which way will it turn next?', 'Longer lines mean more open space, and the car turns towards the open side.', ['Left', 'Right'], right ? 1 : 0,
    'The lines on the ' + (right ? 'right' : 'left') + ' are longer, so the car turns that way.')
}

const pedal: Question = (m) => {
  if (Math.abs(m.outputs[1]) < 0.3) return null
  const gas = m.outputs[1] > 0
  return round(m, 'What will the car do next: speed up or brake?', 'A short line ahead or a high speed means brake.', ['Brake', 'Speed up'], gas ? 1 : 0,
    gas ? 'There is enough space ahead and the car is not going too fast.' : 'Something is close ahead, or the car is going too fast.')
}

const crash: Question = (m) => {
  const crashed = predictPath(m.car, m.brain).crashed
  return round(m, 'The car has been turned to face this way. If it drives on from here, will it crash?', 'Look at where its nose points and how much space its lines show.', ['No, it recovers', 'Yes, it crashes'], crashed ? 1 : 0,
    crashed ? 'It is pointing too far towards the wall to turn away in time.' : 'It has enough room to steer back onto the road.')
}

const strongest: Question = (m) => {
  const size = m.hidden.slice(0, NEURONS.length).map(Math.abs)
  const top = size.indexOf(Math.max(...size))
  if (size[top] - [...size].sort((a, b) => b - a)[1] < 0.15) return null
  return round(m, 'At this moment, what is the car paying the most attention to?', 'Look at the lines and the speed. What stands out most?', NEURONS, top,
    NEURONS[top] + ' gives the strongest signal at this moment.')
}

// Real moments from a lap of the starter brain, each turned a little so the answer is clear
export function pickRounds(): Round[] {
  const brain = starterBrain()
  const car = createCar(undefined, USE_GRIP)
  // question, how far to turn the car, and the answer wanted (null = either), so the game
  // includes the rarer cases such as a real crash
  const plan: [Question, number, number | null][] = [
    [steering, TILT, null],
    [crash, HARD_TILT, 1],
    [pedal, 0, 0], // a real brake moment, as the car meets a block
    [strongest, 0, null],
    [crash, TILT, 0],
    [pedal, 0, 1],
  ]
  const rounds: Round[] = []
  let nextStep = 40
  while (rounds.length < plan.length && car.steps < 1500) {
    if (car.steps >= nextStep) {
      const [ask, tilt, wanted] = plan[rounds.length]
      const moment = faceAngle(car, car.angle + tilt)
      const { outputs, hidden } = think(brain, getInputs(moment))
      const found = ask({ car: moment, brain, outputs, hidden })
      if (found && (wanted === null || found.answer === wanted)) {
        rounds.push(found)
        nextStep = car.steps + 50
      }
    }
    const { outputs } = think(brain, getInputs(car))
    step(car, { steer: outputs[0], throttle: outputs[1] })
  }
  return rounds
}

// The guessing game. showRound puts a car on the track, reveal draws where it really goes.
export function runReadGame(
  panel: HTMLElement,
  rounds: Round[],
  showRound: (round: Round) => void,
  reveal: (round: Round) => void,
  onDone: (score: number, total: number) => void,
) {
  let index = 0
  let score = 0

  function ask() {
    const current = rounds[index]
    showRound(current)
    panel.innerHTML =
      '<p class="goal">' + current.question + '</p>' +
      '<div class="actions">' + current.options.map((o, i) => '<button class="btn" data-answer="' + i + '">' + o + '</button>').join('') + '</div>' +
      '<p class="note">' + current.hint + '</p>' +
      '<p class="note">Question ' + (index + 1) + ' of ' + rounds.length + ' · ' + score + ' correct</p>'
    const answer = (picked: number) => {
      const correct = picked === current.answer
      if (correct) score++
      reveal(current)
      panel.innerHTML =
        '<p class="goal ' + (correct ? 'right' : 'wrong') + '">' + (correct ? 'Correct: ' : 'Wrong: ') + current.options[current.answer] + '</p>' +
        '<p class="note">' + current.why + ' The line shows where it goes.</p>' +
        '<div class="actions"><button class="btn primary" id="r-next">' + (index + 1 < rounds.length ? 'Next question' : 'See your score') + '</button></div>'
      panel.querySelector('#r-next')!.addEventListener('click', () => {
        index++
        if (index < rounds.length) ask()
        else onDone(score, rounds.length)
      })
    }
    panel.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.answer))))
  }
  ask()
}
