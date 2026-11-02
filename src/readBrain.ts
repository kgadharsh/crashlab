import { starterBrain, think, type Brain } from './brain'
import { createCar, faceAngle, getInputs, step, USE_GRIP, type Car } from './sim'

const ROUNDS = 5
const TILT = 0.4 // how far the car is turned off its line, so both answers come up

export type Round = { car: Car; brain: Brain; steersRight: boolean }

// Real moments from a lap of the starter brain. Each car is tilted a little, alternating
// left and right, so the rays clearly favour one side.
export function pickRounds(): Round[] {
  const brain = starterBrain()
  const car = createCar(undefined, USE_GRIP)
  const rounds: Round[] = []
  let nextStep = 40
  while (rounds.length < ROUNDS && car.steps < 900) {
    if (car.steps >= nextStep) {
      const tilted = faceAngle(car, car.angle + (rounds.length % 2 === 0 ? TILT : -TILT))
      const { outputs, hidden } = think(brain, getInputs(tilted))
      if (Math.abs(hidden[0]) > 0.4) {
        rounds.push({ car: tilted, brain, steersRight: outputs[0] > 0 })
        nextStep = car.steps + 60
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
  onDone: (score: number) => void,
) {
  let index = 0
  let score = 0

  function ask() {
    const round = rounds[index]
    showRound(round)
    panel.innerHTML =
      '<p class="goal">Which way will the brain steer?</p>' +
      '<div class="actions"><button class="btn" id="r-left">Left</button><button class="btn" id="r-right">Right</button></div>' +
      '<p class="note" id="r-note">Compare the rays on each side of the car.</p>' +
      '<p class="note">Car ' + (index + 1) + ' of ' + rounds.length + ' · ' + score + ' correct</p>'
    const answer = (right: boolean) => {
      const correct = right === round.steersRight
      if (correct) score++
      reveal(round)
      const side = round.steersRight ? 'right' : 'left'
      panel.innerHTML =
        '<p class="goal ' + (correct ? 'right' : 'wrong') + '">' + (correct ? 'Correct: ' : 'Wrong: ') + 'it steers ' + side + '</p>' +
        '<p class="note">The ' + side + ' rays reach further, so the neuron pulls that way. The line shows where it goes.</p>' +
        '<div class="actions"><button class="btn primary" id="r-next">' + (index + 1 < rounds.length ? 'Next car' : 'See your score') + '</button></div>'
      panel.querySelector('#r-next')!.addEventListener('click', () => {
        index++
        if (index < rounds.length) ask()
        else onDone(score)
      })
    }
    panel.querySelector('#r-left')!.addEventListener('click', () => answer(false))
    panel.querySelector('#r-right')!.addEventListener('click', () => answer(true))
  }
  ask()
}
