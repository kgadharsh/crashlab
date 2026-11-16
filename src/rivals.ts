// The rival ladder: ready-made cars to race in Grand Prix 1, from one that barely learned to drive up to one that wins
// gold. It gives a player something to beat from the first minute, with nobody else needed on the leaderboard. The cars
// are the default build trained with a growing share of the usual budget, and at the top quicker builds the skill tree
// and car types allow (scripts/rivalCars.ts). A rival drives beside the player's car as a ghost, exactly as a friend's
// car from a challenge link does.
import type { CarFile } from './carFile'
import { DEFAULT_BUILD } from './setup'
import { RACE_COUNT, better } from './race'
import { RIVAL_CARS } from './rivalCars'

export type Rival = { car: CarFile; finished: number; totalTime: number }
// weakest first. finished and totalTime are each car's Grand Prix 1 result (scripts/rivalCars.ts check keeps them true)
export const RIVALS: Rival[] = RIVAL_CARS.map((r) => ({ car: { name: r.name, build: r.build ?? DEFAULT_BUILD, genome: r.genome }, finished: r.finished, totalTime: r.totalTime }))

const KEY = 'crashlab.ladder' // how many rivals have been beaten, counted from the bottom
export function rivalsBeaten(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return Number.isInteger(n) && n > 0 ? Math.min(n, RIVALS.length) : 0
  } catch {
    return 0
  }
}
// The rival to race next: the first one not yet beaten, and the top one again once all are
export function nextRival(): { car: CarFile; index: number } | null {
  if (!RIVALS.length) return null
  const index = Math.min(rivalsBeaten(), RIVALS.length - 1)
  return { car: RIVALS[index].car, index }
}
// A Grand Prix 1 result against a rival: the ladder moves past every rival it beats, so a strong car does not have to
// climb one race at a time
export function ladderRaced(result: { finished: number; totalTime: number }) {
  let n = 0
  while (n < RIVALS.length && better(result, RIVALS[n])) n++
  if (n <= rivalsBeaten()) return
  try {
    localStorage.setItem(KEY, String(n))
  } catch {
    /* storage blocked: the ladder only lasts this visit */
  }
}
export const ladderList = () => {
  const beaten = rivalsBeaten()
  return RIVALS.map((r, i) => ({ name: r.car.name, score: r.finished === RACE_COUNT ? r.totalTime.toFixed(1) + ' s' : r.finished + '/' + RACE_COUNT, beaten: i < beaten }))
}
