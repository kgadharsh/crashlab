// Race day: a Grand Prix of tracks no practice track looks like exactly, driven once each.
// Everything here is plain simulation, so the same car always gets the same result
// (and a server can re-run it later to check a score).
import type { Point } from './sensors'
import { genomeToBrain } from './genome'
import { CAR_RADIUS, CHECKPOINTS, RACE_STEPS, STALL_STEPS, createCar, drive, type Brain, type Car } from './sim'
import { BLOCK_HALF, CORE_PRACTICE, HAIRPIN_RADIUS, PRACTICE, bendRadii, makeStyledTrack, styleFor, wetTrack, withConditions, type Track, type TrackStyle } from './track'
import { makeRng } from './random'
import { brainShape, specOf, type CarSpec } from './setup'
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

// ---------- THE WEEKLY GRAND PRIX ----------
// Every week has 8 new tracks made from a seed only the server knows until the week is over, so nobody can
// practise on them. Each track takes the style of a random practice track, and about one week in three is wet.
// Weeks start on Monday at 00:00 UTC.
const WEEK_MS = 7 * 86400000
const CONDITIONS_FROM = 2966
const HARDER_FROM = 2967 // from the week of 16 Nov 2026 no week is a plain road, and one in five is both night and ice
const FIRST_MONDAY = Date.UTC(1970, 0, 5)
export const weekOf = (now: number) => Math.floor((now - FIRST_MONDAY) / WEEK_MS)
export const weekStart = (week: number) => FIRST_MONDAY + week * WEEK_MS
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const weekName = (week: number) => {
  const d = new Date(weekStart(week))
  return 'Week of ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
}
const WEEKLY_STYLES =[...PRACTICE.flatMap((p) => (p.style ? [p.style] : [])), styleFor(0.9)]

export function weeklyGp(week: number, seed: number): GrandPrix {
  const rng = makeRng(seed)
  const wet = rng() < 1 / 3
  const tracks = Array.from({ length: RACE_COUNT }, () => {
    const style = WEEKLY_STYLES[Math.floor(rng() * WEEKLY_STYLES.length)]
    return { seed: Math.floor(rng() * 1e6), style }
  })
  // From the week of 9 Nov 2026 a week may also be raced at night or with ice patches (drawn after everything
  // above, so the week of 2 Nov, raced before conditions existed, keeps exactly its tracks)
  const c = week >= CONDITIONS_FROM ? rng() : 1
  // the weekly is the hard one: from HARDER_FROM it always has a twist (the daily has one too), and sometimes two at once
  const twist = week >= HARDER_FROM ? (c < 0.4 ? { night: true } : c < 0.8 ? { ice: true } : { night: true, ice: true }) : c < 0.3 ? { night: true } : c < 0.6 ? { ice: true } : {}
  return { id: 'w:' + week, name: weekName(week), wet, goldTime: 0, week, tracks, ...twist }
}

// ---------- THE DAILY CHALLENGE ----------
// Built to feel unlike the weekly: every track in a day has the SAME style (a theme day: all hairpins, all blocks...),
// and one twist is always on (wet, night or ice), where a week is a mix and often plain. It is raced for a place
// on the day's board, not for trophies. Days run from 00:00 UTC, and the tracks are secret until the day is over.
const DAY_MS = 86400000
export const dayOf = (now: number) => Math.floor(now / DAY_MS)
export const dayStart = (day: number) => day * DAY_MS
const DAILY_THEMES = PRACTICE.flatMap((p) => (p.style ? [{ name: p.name, style: p.style }] : [])).concat({ name: 'Wild', style: styleFor(0.9) })
export type DailyTwist = 'wet' | 'night' | 'ice'
export const dayLabel = (day: number) => {
  const d = new Date(dayStart(day))
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
}
export const dailyName = (day: number, theme: string) => {
  const d = new Date(dayStart(day))
  return theme + ' day · ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
}
export function dailyGp(day: number, seed: number): GrandPrix {
  const rng = makeRng(seed)
  const theme = DAILY_THEMES[Math.floor(rng() * DAILY_THEMES.length)]
  const tracks = Array.from({ length: RACE_COUNT }, () => ({ seed: Math.floor(rng() * 1e6), style: theme.style }))
  const t = rng()
  const twist: DailyTwist = t < 1 / 3 ? 'wet' : t < 2 / 3 ? 'night' : 'ice'
  return { id: 'd:' + day, name: dailyName(day, theme.name), wet: twist === 'wet', goldTime: 0, day, tracks, ...(twist === 'night' ? { night: true } : twist === 'ice' ? { ice: true } : {}) }
}
// A Grand Prix whose tracks are secret and whose result is a place on a board, not a medal (weekly or daily)
export const isSecretGp = (gp: GrandPrix) => gp.week !== undefined || gp.day !== undefined

// Track i of a Grand Prix: the fixed race tracks, or the ones a weekly seed makes (made once, then kept)
const weeklyTracks = new Map<string, Track[]>()
export function gpTrack(gp: GrandPrix, i: number): Track {
  if (!gp.tracks) return raceTrack(i, gp.wet)
  const key = gp.id + ':' + gp.tracks.map((t) => t.seed).join(',')
  let made = weeklyTracks.get(key)
  if (!made) weeklyTracks.set(key, (made = []))
  const { seed, style } = gp.tracks[i]
  return (made[i] ??= withConditions(((t) => (gp.wet ? wetTrack(t) : t))(makeStyledTrack(seed, style)), gp, seed))
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
  const brain = genomeToBrain(car.genome, brainShape(car.build))
  const spec = specOf(car.build)
  return summarise(Array.from({ length: RACE_COUNT }, (_, i) => raceOne(brain, gpTrack(gp, i), spec)))
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
// A weekly Grand Prix also has its week number and the seed and style of each of its tracks
export type GrandPrix = { id: string; name: string; wet: boolean; goldTime: number; week?: number; day?: number; tracks?: { seed: number; style: TrackStyle }[]; night?: boolean; ice?: boolean }
export const GRAND_PRIXES: GrandPrix[] = [
  { id: 'gp1', name: 'Grand Prix 1', wet: false, goldTime: GOLD_TIME },
  { id: 'gp2', name: 'Grand Prix 2 · wet', wet: true, goldTime: WET_GOLD_TIME },
]

export type Medal = 'gold' | 'silver' | 'bronze' | null
export function medalFor(r: { finished: number; totalTime: number }, gp: GrandPrix = GRAND_PRIXES[0]): Medal {
  if (isSecretGp(gp)) return null // weekly trophies go by place on the week's board, not by time
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
