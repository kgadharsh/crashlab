// The track board: how a car drives a lap of every practice track, the medal each lap earns, and the
// stars those medals add up to. Stars unlock car designs (see looks.ts). Everything here is plain
// simulation, so the same car always gets the same laps.
import type { CarFile } from './carFile'
import { genomeToBrain } from './genome'
import { CHECKPOINTS, runLap, type Brain } from './sim'
import { brainShape, specOf } from './setup'
import { practiceOnRoad } from './track'
import type { Medal } from './race'

// Gold lap times in seconds on a dry road, one per practice track (in track order): 0.5% under the median lap of
// the cars measured by scripts/boardCalibration.ts (four default trainings, and one each of wide vision, fast and
// cautious, and six practice tracks, all on a dry road). Lap times cluster tightly, because cars drive near
// top speed, so gold means clearly beating a typical car and silver means being typical.
// Only seven cars went into them: see docs/experiments.md before trusting them.
export const PAR = [15.0, 19.3, 16.7, 16.8, 15.4, 21.7, 18.9, 17.8, 15.5, 20.7, 19.5, 18.0]
export const WET_FACTOR = 1.1 // a wet lap takes about 10% longer (the median over the laps that finished both ways)
export const SILVER_SLACK = 1.055 // silver is within 5% of the median lap

export type Lap = { id: number; time: number | null; progress: number; medal: Medal }

// The gold time for a track on a dry or a wet road
export const parFor = (id: number, wet: boolean) => (PAR[id] ?? Infinity) * (wet ? WET_FACTOR : 1)

// Gold: at or under par. Silver: within 5.5% of it. Bronze: finished the lap.
export function lapMedal(id: number, seconds: number | null, wet: boolean): Medal {
  if (seconds === null) return null
  const par = parFor(id, wet)
  if (seconds <= par) return 'gold'
  return seconds <= par * SILVER_SLACK ? 'silver' : 'bronze'
}

export function brainOf(car: CarFile): Brain {
  return genomeToBrain(car.genome, brainShape(car.build))
}

// One lap of one practice track, on the road the car was trained for
export function driveLap(car: CarFile, brain: Brain, id: number): Lap {
  const wet = car.build.weather === 'wet'
  const r = runLap(brain, practiceOnRoad(id, wet), specOf(car.build))
  const time = r.time === null ? null : r.time / 60
  return { id, time, progress: r.checkpoints / CHECKPOINTS, medal: lapMedal(id, time, wet) }
}

// ---------- WHAT THE PLAYER HAS EARNED ----------
// The best medal on each track and road, kept in this browser, and the stars they are worth
export const STARS: Record<Exclude<Medal, null>, number> = { bronze: 1, silver: 2, gold: 3 }
export const GP_STARS: Record<Exclude<Medal, null>, number> = { bronze: 3, silver: 6, gold: 10 }
const RANK: Record<Exclude<Medal, null>, number> = { bronze: 1, silver: 2, gold: 3 }
const KEY = 'crashlab.medals'

export type Medals = Record<string, { medal: Exclude<Medal, null>; time: number }>
const slot = (id: number, wet: boolean) => id + (wet ? ':wet' : ':dry')

export function loadMedals(): Medals {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Medals) : {}
  } catch {
    return {}
  }
}

// Keep the better of what was earned before and these laps. Returns the stars gained.
export function recordLaps(laps: Lap[], wet: boolean, before: Medals = loadMedals()): { medals: Medals; gained: number } {
  const medals = { ...before }
  let gained = 0
  for (const l of laps) {
    if (!l.medal || l.time === null) continue
    const old = medals[slot(l.id, wet)]
    const better = !old || RANK[l.medal] > RANK[old.medal] || (RANK[l.medal] === RANK[old.medal] && l.time < old.time)
    if (!better) continue
    gained += STARS[l.medal] - (old ? STARS[old.medal] : 0)
    medals[slot(l.id, wet)] = { medal: l.medal, time: l.time }
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(medals))
  } catch {
    /* storage blocked: the medals only last this visit */
  }
  return { medals, gained }
}

export const bestOn = (medals: Medals, id: number, wet: boolean) => medals[slot(id, wet)] ?? null

// All the stars: track medals plus the best Grand Prix medals (passed in, one per Grand Prix)
export function totalStars(medals: Medals, grandPrixMedals: Medal[]): number {
  let n = 0
  for (const m of Object.values(medals)) n += STARS[m.medal] ?? 0
  for (const m of grandPrixMedals) if (m) n += GP_STARS[m]
  return n
}

// ---------- THE FEWEST GENERATIONS ----------
// The fewest generations of training a car needed to win each Grand Prix medal, kept in this browser.
// It rewards a build that learns quickly, not only one that drives well.
const FEWEST_KEY = 'crashlab.fewest'
export type Fewest = Partial<Record<Exclude<Medal, null>, number>>

function loadAllFewest(): Record<string, Fewest> {
  try {
    const data = JSON.parse(localStorage.getItem(FEWEST_KEY) ?? '{}')
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, Fewest>) : {}
  } catch {
    return {}
  }
}
export const loadFewest = (gpId: string): Fewest => loadAllFewest()[gpId] ?? {}

export function recordFewest(gpId: string, medal: Exclude<Medal, null>, generations: number): Fewest {
  const all = loadAllFewest()
  const mine = { ...(all[gpId] ?? {}) }
  if (mine[medal] === undefined || generations < mine[medal]!) mine[medal] = generations
  all[gpId] = mine
  try {
    localStorage.setItem(FEWEST_KEY, JSON.stringify(all))
  } catch {
    /* storage blocked: the record only lasts this visit */
  }
  return mine
}
