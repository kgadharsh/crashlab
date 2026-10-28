import { makeTrack, type Track } from './track'
import { lapSteps, DEFAULT_TRACK, type Brain } from './sim'

// The hidden test: 20 tracks from the same generator and difficulty as the practice
// tracks, with fixed seeds so every brain faces exactly the same ones.
// Score = how many it laps (out of 20); average lap time breaks ties.
export const HIDDEN_COUNT = 20
const HIDDEN_FIRST_SEED = 7000
const HIDDEN_DIFFICULTY = 1

// Making a track takes a noticeable moment, so they are built one at a time in the background
// (the page stays responsive). Start this when the page loads; the test waits for it if needed.
const tracks: Track[] = []
let building: Promise<void> | null = null
export function prepareHiddenTracks(): Promise<void> {
  if (!building) {
    building = (async () => {
      while (tracks.length < HIDDEN_COUNT) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        tracks.push(makeTrack(HIDDEN_FIRST_SEED + tracks.length, HIDDEN_DIFFICULTY))
      }
    })()
  }
  return building
}

export type HiddenResult = {
  finished: boolean[] // one entry per hidden track
  count: number // how many were lapped
  avgLap: number | null // average lap time in seconds over the ones lapped
  practiceLap: number | null // lap time on the practice track, or null if it cannot lap it
}

export async function testOnHiddenTracks(brain: Brain): Promise<HiddenResult> {
  await prepareHiddenTracks()
  const laps = tracks.map((t) => lapSteps(brain, t))
  const done = laps.filter((l): l is number => l !== null)
  const practice = lapSteps(brain, DEFAULT_TRACK)
  return {
    finished: laps.map((l) => l !== null),
    count: done.length,
    avgLap: done.length ? done.reduce((a, b) => a + b, 0) / done.length / 60 : null,
    practiceLap: practice === null ? null : practice / 60,
  }
}

// One plain-words reading of the result
export function hiddenVerdict(r: HiddenResult): string {
  const failed = HIDDEN_COUNT - r.count
  if (r.practiceLap === null) return 'This brain cannot even lap the practice track yet.'
  if (r.count >= 18) return 'It learned to drive, not just one track: it laps nearly every track it has never seen.'
  if (r.count >= 12) return 'Mostly good, but ' + failed + ' unseen tracks beat it. Some shapes were not covered by the practice track.'
  return (
    'It laps the practice track but fails ' + failed + ' of ' + HIDDEN_COUNT +
    ' unseen ones. It partly memorised the practice track instead of learning to drive. This is called overfitting.'
  )
}