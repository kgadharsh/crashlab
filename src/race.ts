// Race day: a Grand Prix of tracks no practice track looks like exactly, driven once each.
// Everything here is plain simulation, so the same car always gets the same result
// (and a server can re-run it later to check a score).
import type { Point } from './sensors'
import { genomeToBrain } from './genome'
import { CAR_RADIUS, CHECKPOINTS, RACE_STEPS, STALL_STEPS, createCar, drive, type Brain, type Car } from './sim'
import { BLOCK_HALF, CORE_PRACTICE, HAIRPIN_RADIUS, PRACTICE, bendRadii, makeStyledTrack, styleFor, wetTrack, type Track } from './track'
import { shapeOf, specOf, type CarSpec } from './setup'
import type { CarFile } from './carFile'

// ---------- THE GRAND PRIX ----------
// One track in the style of each practice track (but a different shape), plus one wild one.
// Players never see these before the race.
// The same eight tracks are raced twice: on a dry road (Grand Prix 1) and on a wet one (Grand Prix 2).
const RACE_STYLES = [...PRACTICE.slice(1, CORE_PRACTICE).map((p) => p.style!), styleFor(0.9)]
export const RACE_COUNT = RACE_STYLES.length
const raceTracks: Track[] = []
const wetRaceTracks: Track[] = []
export const raceTrack = (i: number, wet = false): Track => {
  const dry = (raceTracks[i] ??= makeStyledTrack(7001 + i, RACE_STYLES[i]))
  return wet ? (wetRaceTracks[i] ??= wetTrack(dry)) : dry
}

// ---------- ONE TRACK ----------
export type Cause = 'block' | 'tight bend' | 'wall' | 'stuck' | 'too slow'
export type TrackResult = {
  time: number | null // seconds, or null if the car did not finish
  progress: number // share of the lap completed, 0 to 1
  cause: Cause | null // why it did not finish
  at: Point | null // where it stopped
}

// Why a car that stopped did not finish, worked out from where and how it stopped
export function causeOf(car: Car): Cause {
  if (!car.dead) return car.sinceProgress >= STALL_STEPS ? 'stuck' : 'too slow'
  const reach = BLOCK_HALF * Math.SQRT2 + CAR_RADIUS + 3
  if (car.track.blocks.some((k) => Math.hypot(k.x - car.x, k.y - car.y) < reach)) return 'block'
  // the centerline point nearest the crash, and how tight the road bends there
  const c = car.track.centerline
  let nearest = 0
  c.forEach((p, i) => {
    if (Math.hypot(p.x - car.x, p.y - car.y) < Math.hypot(c[nearest].x - car.x, c[nearest].y - car.y)) nearest = i
  })
  const radii = bendRadii(car.track)
  const around = [-6, -3, 0, 3, 6].map((k) => radii[(nearest + k + c.length) % c.length])
  return Math.min(...around) < HAIRPIN_RADIUS * 1.3 ? 'tight bend' : 'wall'
}

export function lapIsOver(car: Car): boolean {
  return car.dead || car.passed >= CHECKPOINTS || car.sinceProgress >= STALL_STEPS || car.steps >= RACE_STEPS
}

export function finishLap(car: Car): TrackResult {
  if (car.passed >= CHECKPOINTS) return { time: car.steps / 60, progress: 1, cause: null, at: null }
  return { time: null, progress: car.passed / CHECKPOINTS, cause: causeOf(car), at: { x: car.x, y: car.y } }
}

export function raceOne(brain: Brain, track: Track, spec: CarSpec): TrackResult {
  const car = createCar(track, spec)
  while (!lapIsOver(car)) drive(car, brain)
  return finishLap(car)
}

// ---------- THE WHOLE RACE ----------
export type RaceResult = { tracks: TrackResult[]; finished: number; totalTime: number }

export function summarise(tracks: TrackResult[]): RaceResult {
  const done = tracks.filter((t) => t.time !== null)
  return { tracks, finished: done.length, totalTime: done.reduce((s, t) => s + t.time!, 0) }
}

export function raceCar(car: CarFile, gp: GrandPrix = GRAND_PRIXES[0]): RaceResult {
  const brain = genomeToBrain(car.genome, shapeOf(car.build.sensors))
  const spec = specOf(car.build)
  return summarise(Array.from({ length: RACE_COUNT }, (_, i) => raceOne(brain, raceTrack(i, gp.wet), spec)))
}

// More tracks finished wins; among equals, the lower total time wins
export const better = (a: { finished: number; totalTime: number }, b: { finished: number; totalTime: number }) =>
  a.finished !== b.finished ? a.finished > b.finished : a.totalTime < b.totalTime

// Who won a head-to-head, in plain words, from "you" (the first result) against a named rival
export function versus(mine: RaceResult, theirs: RaceResult, name: string): string {
  const tracks = (n: number) => n + (n === 1 ? ' more track' : ' more tracks') + ' finished.'
  if (better(mine, theirs)) {
    return mine.finished > theirs.finished ? 'You beat ' + name + ': ' + tracks(mine.finished - theirs.finished) : 'You beat ' + name + ' by ' + (theirs.totalTime - mine.totalTime).toFixed(1) + ' s.'
  }
  if (better(theirs, mine)) {
    return theirs.finished > mine.finished ? name + ' beat you: ' + tracks(theirs.finished - mine.finished) : name + ' beat you by ' + (mine.totalTime - theirs.totalTime).toFixed(1) + ' s.'
  }
  return 'A dead heat with ' + name + '.'
}

// Medals: finishing gets you on the podium, speed gets you gold. Set 5 Nov 2026 from 16 trained
// cars (see docs/experiments.md): 9 finished all 8, in 143 to 156 s, and 149 s gives gold to about
// the fastest quarter of all cars. Times barely differ between cars that finish, so revisit this
// once players have raced. (It was 200 s until then, which made gold the same as finishing all 8.)
export const GOLD_TIME = 149
// The wet Grand Prix is much harder: of 9 cars practised on wet roads, 2 finished all 8 (184 and 188 s),
// 4 got bronze and 3 nothing (docs/experiments.md). Any line from 188 s up makes gold mean "finish all 8".
export const WET_GOLD_TIME = 190
export const BRONZE_FINISHES = RACE_COUNT - 2

// Each Grand Prix has its own medals and personal best (the first keeps its old save key)
export type GrandPrix = { id: string; name: string; wet: boolean; goldTime: number }
export const GRAND_PRIXES: GrandPrix[] = [
  { id: 'gp1', name: 'Grand Prix 1', wet: false, goldTime: GOLD_TIME },
  { id: 'gp2', name: 'Grand Prix 2 · wet', wet: true, goldTime: WET_GOLD_TIME },
]

export type Medal = 'gold' | 'silver' | 'bronze' | null
export function medalFor(r: { finished: number; totalTime: number }, gp: GrandPrix = GRAND_PRIXES[0]): Medal {
  if (r.finished === RACE_COUNT) return r.totalTime <= gp.goldTime ? 'gold' : 'silver'
  return r.finished >= BRONZE_FINISHES ? 'bronze' : null
}
export const medalRules = (gp: GrandPrix = GRAND_PRIXES[0]) =>
  'Gold: all ' + RACE_COUNT + ' in under ' + gp.goldTime + ' s · Silver: all ' + RACE_COUNT + ' · Bronze: ' + BRONZE_FINISHES + ' or more'

// ---------- WHAT TO CHANGE ----------
const ADVICE: Record<Cause, string> = {
  block: 'Blocks caught your car. A wider view sees them sooner, and Block Alley is good practice.',
  'tight bend': 'Tight bends caught your car. More grip helps, and so does practice on Hairpin Valley or Chicanes.',
  wall: 'Your car left the road on open bends. Punishing crashes more teaches it to take bends carefully.',
  stuck: 'Your car stopped or turned round. Rewarding speed pushes training to keep cars moving.',
  'too slow': 'Your car was too slow to finish in time. Rewarding speed or a faster setup helps.',
}
export const CAUSE_LABEL: Record<Cause, string> = {
  block: 'hit a block',
  'tight bend': 'crashed in a tight bend',
  wall: 'hit the wall',
  stuck: 'got stuck',
  'too slow': 'ran out of time',
}

// One piece of advice, for the most common reason the car failed
// The advice only suggests changes that keep the car's brain size (no new rays), so "Keep training" still works afterwards.
export function adviceFor(result: RaceResult, gp: GrandPrix = GRAND_PRIXES[0], practisedWet = false): string {
  const counts = new Map<Cause, number>()
  for (const t of result.tracks) if (t.cause) counts.set(t.cause, (counts.get(t.cause) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) return 'Every track finished. Now chase time: a faster setup or rewarding speed, but watch for new crashes. Keep training in Practice can also shave a little off the time.'
  const again = ' Then press Keep training in Practice to improve this car without starting over.'
  // on a wet road the tyres give up turning power sooner, whatever the track did to the car
  if (gp.wet && !practisedWet) return 'The wet road caught your car: the tyres lose grip at lower speeds. Set Road to Wet in the Garage so training practises on wet tracks.' + again
  // a car already practised on wet roads has done that, and the wet Grand Prix is still hard for it (docs/experiments.md)
  if (gp.wet) return 'The wet Grand Prix is much harder than the dry one, even for a car practised on wet roads. ' + ADVICE[top[0]] + again
  return ADVICE[top[0]] + again
}
