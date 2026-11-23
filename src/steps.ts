// Anonymous counts of how far new players get: five steps, each sent once per browser as its name and nothing else (no
// id, nothing about the car or the device). The server adds one to that day's total for the step and keeps only totals
// (server/src/index.ts, /count). It answers "is the game slow to get into" without a playtest. The privacy page says so.
import { API } from './leaderboard'

export type Step = 'open' | 'play' | 'train' | 'race' | 'back'
const KEY = 'crashlab.steps' // { first: the day of the first visit, sent: the steps already counted }
type Seen = { first: number; sent: Step[] }
const today = () => Math.floor(Date.now() / 86_400_000)

function read(): Seen | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Seen | null
    return s && typeof s.first === 'number' && Array.isArray(s.sent) ? s : null
  } catch {
    return null
  }
}
function write(s: Seen) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: nothing is counted, because a step could not be kept to once */
  }
}

export function step(name: Step) {
  const s = read()
  if (!API || !s || s.sent.includes(name)) return
  s.sent.push(name) // marked before sending: a step that fails to send is lost rather than counted twice
  write(s)
  if (!read()?.sent.includes(name)) return // storage is blocked
  fetch(API + '/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: name }), keepalive: true }).catch(() => {})
}

// Call once when the page loads. A browser that already holds a game from before the counts existed is not a new
// player, so none of its steps are counted.
export function countVisit(playedBefore: boolean) {
  let s = read()
  if (!s) {
    write({ first: today(), sent: playedBefore ? ['open', 'play', 'train', 'race', 'back'] : [] })
    s = read()
    if (!s) return
    if (!playedBefore) step('open')
    return
  }
  if (today() > s.first) step('back')
}
