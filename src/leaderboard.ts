// The online board on the Race tab: shows the top cars for a Grand Prix and lets a player enter
// their car. The server re-runs the car itself, so the result shown here is the server's, not ours.
// With no server address (the live site until the server is deployed) the whole panel stays hidden.
import { carToJson, type CarFile } from './carFile'
import { GRAND_PRIXES } from './race'

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')
const NAME_KEY = 'crashlab.devname'

type Row = { rank: number; id: number; display: string; finished: number; totalTime: number; medal: string | null }

// Until sign-in exists the local server accepts a name in a header. Only a development build sends it.
function headers(): Record<string, string> {
  if (!import.meta.env.DEV) return {}
  try {
    return { 'X-Dev-Player': localStorage.getItem(NAME_KEY) || 'player' }
  } catch {
    return { 'X-Dev-Player': 'player' }
  }
}

export function createLeaderboard(getCar: () => CarFile | null) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
  const panel = $('boardOnline')
  if (!API) return { render() {} }
  panel.hidden = false
  let gpIndex = 0

  const say = (text: string, bad = false) => {
    $('onlineMsg').textContent = text
    $('onlineMsg').classList.toggle('bad', bad)
  }

  async function refresh() {
    const gp = GRAND_PRIXES[gpIndex]
    $('onlineDry').className = gpIndex === 0 ? 'btn small primary' : 'btn small'
    $('onlineWet').className = gpIndex === 1 ? 'btn small primary' : 'btn small'
    try {
      const res = await fetch(API + '/board?gp=' + gp.id)
      const data = (await res.json()) as { entries?: Row[]; error?: string }
      if (!res.ok || !data.entries) throw new Error(data.error ?? 'bad reply')
      $('onlineRows').replaceChildren(
        ...data.entries.map((e) => {
          const li = document.createElement('li')
          const medal = e.medal ? ' · ' + e.medal : ''
          li.textContent = e.rank + '. ' + e.display + ' — ' + e.finished + ' of 8, ' + e.totalTime.toFixed(1) + ' s' + medal
          return li
        }),
      )
      $('onlineEmpty').hidden = data.entries.length > 0
    } catch {
      $('onlineRows').replaceChildren()
      $('onlineEmpty').hidden = true
      say('The board is not reachable right now.', true)
    }
  }

  $('onlineDry').addEventListener('click', () => ((gpIndex = 0), refresh()))
  $('onlineWet').addEventListener('click', () => ((gpIndex = 1), refresh()))
  $('onlineEnter').addEventListener('click', async () => {
    const car = getCar()
    if (!car) return say('Train a car first.', true)
    say('Racing your car on the server…')
    try {
      const res = await fetch(API + '/entries', { method: 'POST', headers: headers(), body: JSON.stringify({ gp: GRAND_PRIXES[gpIndex].id, car: carToJson(car) }) })
      const data = (await res.json()) as { error?: string; finished?: number; totalTime?: number; medal?: string | null; rank?: number; left?: number }
      if (!res.ok) return say(data.error ?? 'The board could not take that car.', true)
      say('The server scored ' + car.name + ': ' + data.finished + ' of 8 in ' + data.totalTime!.toFixed(1) + ' s' + (data.medal ? ' (' + data.medal + ')' : '') + '. You are number ' + data.rank + ' on the board. ' + data.left + ' entries left today.')
      refresh()
    } catch {
      say('The board is not reachable right now.', true)
    }
  })
  refresh()
  return { render() {} }
}
