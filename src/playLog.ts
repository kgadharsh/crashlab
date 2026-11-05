// A small log of what happened in this browser, so a playtester can copy it into a form with one button.
// It never leaves the browser by itself: the tester presses "Copy playtest notes" and pastes it.
import type { Build } from './setup'

type Entry =
  | { t: number; k: 'train'; secs: number; generations: number; keep: boolean; wet: boolean; rays: number; practice: number }
  | { t: number; k: 'race'; gp: string; finished: number; time: number; medal: string | null; of: number }
  | { t: number; k: 'share' }

const KEY = 'crashlab.playlog'
const MAX = 80

function read(): Entry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? (list as Entry[]) : []
  } catch {
    return []
  }
}

type NewEntry = Entry extends infer E ? (E extends { t: number } ? Omit<E, 't'> : never) : never

export function logEvent(entry: NewEntry) {
  try {
    const list = read()
    list.push({ ...entry, t: Date.now() } as Entry)
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    /* storage blocked: the notes just stay shorter */
  }
}

const mins = (ms: number) => (ms / 60000).toFixed(1) + ' min'

// The text the tester pastes into the form. Plain lines, so it is readable as it is.
export function playtestNotes(build: Build | null, carName: string | null, now = Date.now()): string {
  const log = read()
  const lines: string[] = ['CrashLab playtest notes']
  const touch = matchMedia('(pointer: coarse)').matches
  lines.push('Device: ' + (touch ? 'touch screen' : 'mouse') + ', screen ' + screen.width + 'x' + screen.height + ', ' + navigator.userAgent)
  if (!log.length) {
    lines.push('Nothing recorded yet: train a car and race it first.')
    return lines.join('\n')
  }
  const f = log[0]
  const first = f.t - (f.k === 'train' ? f.secs * 1000 : 0) // a training is logged when it ends, so it began earlier
  lines.push('Played for about ' + mins(now - first) + ' (first action to now)')
  const trains = log.filter((e): e is Extract<Entry, { k: 'train' }> => e.k === 'train')
  const races = log.filter((e): e is Extract<Entry, { k: 'race' }> => e.k === 'race')
  lines.push('Trainings: ' + trains.length + ', races: ' + races.length + ', challenge links copied: ' + log.filter((e) => e.k === 'share').length)
  if (races.length) lines.push('Minutes from first action to first race: ' + mins(races[0].t - first))
  if (races.length > 1) lines.push('Raced again after ' + mins(races[1].t - races[0].t) + ' (ask them if anyone prompted it)')
  trains.forEach((e, i) => lines.push('Training ' + (i + 1) + ': ' + e.secs + ' s, ' + e.generations + ' generations, ' + (e.keep ? 'kept training' : 'from scratch') + ', ' + e.rays + ' rays, ' + e.practice + ' practice tracks, ' + (e.wet ? 'wet' : 'dry') + ' road, at +' + mins(e.t - first)))
  races.forEach((e, i) => lines.push('Race ' + (i + 1) + ': ' + e.gp + ', ' + e.finished + '/' + e.of + (e.finished === e.of ? ' in ' + e.time.toFixed(1) + ' s' : '') + ', medal ' + (e.medal ?? 'none') + ', at +' + mins(e.t - first)))
  if (build) lines.push('Car "' + (carName ?? '?') + '": ' + JSON.stringify(build))
  return lines.join('\n')
}
