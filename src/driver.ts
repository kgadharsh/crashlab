// Driving a practice track by hand: the one part of the game where the player's own reflexes matter.
// It uses the same sim as the trained car, with the setup and skill tree from the Garage, so changing the car changes how it
// feels. Laps are kept in this browser, and every track driven round at least once counts towards the driver licence,
// which opens skill-tree nodes (see parts.ts). Nothing here is sent to the server, so nothing here can be ranked.
import { lapMedal } from './board'
import type { Medal } from './race'

const KEY = 'crashlab.hand'
export type HandLaps = Record<string, number> // "track:dry" or "track:wet" to the best time in seconds

export function loadHand(): HandLaps {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as HandLaps) : {}
  } catch {
    return {}
  }
}

const slot = (id: number, wet: boolean) => id + (wet ? ':wet' : ':dry')

// Keep a finished lap. Returns whether it is a new best on that track and road.
export function recordHand(id: number, wet: boolean, seconds: number): boolean {
  const laps = loadHand()
  const old = laps[slot(id, wet)]
  if (old !== undefined && old <= seconds) return false
  laps[slot(id, wet)] = seconds
  try {
    localStorage.setItem(KEY, JSON.stringify(laps))
  } catch {
    /* storage blocked: the lap only lasts this visit */
  }
  return true
}

export const handBest = (id: number, wet: boolean): number | null => loadHand()[slot(id, wet)] ?? null
export const handMedal = (id: number, wet: boolean): Medal => {
  const t = handBest(id, wet)
  return t === null ? null : lapMedal(id, t, wet)
}

// The driver licence: how many different practice tracks have been driven round by hand
export const licence = (): number => new Set(Object.keys(loadHand()).map((k) => k.split(':')[0])).size

// ---------- THE CONTROLS ----------
// Arrow keys or WASD, or the pad on screen. Steering eases towards the key like a wheel would, so a tap is a nudge
// and holding a key is a full lock: that is the skill in it.
const STEER_EASE = 0.12
export function createControls() {
  const down = new Set<string>()
  const pad = new Set<string>()
  let steer = 0
  const KEYS: Record<string, string> = { ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r', ArrowUp: 'u', w: 'u', W: 'u', ArrowDown: 'd', s: 'd', S: 'd', ' ': 'b' }
  let on = false
  const onDown = (e: KeyboardEvent) => {
    if (!on || (e.target as HTMLElement).closest?.('input, select, textarea')) return
    const k = KEYS[e.key]
    if (!k) return
    down.add(k)
    e.preventDefault() // arrow keys would scroll the page
  }
  const onUp = (e: KeyboardEvent) => {
    const k = KEYS[e.key]
    if (k) down.delete(k)
  }
  window.addEventListener('keydown', onDown)
  window.addEventListener('keyup', onUp)
  window.addEventListener('blur', () => down.clear())
  const has = (k: string) => down.has(k) || pad.has(k)
  return {
    // keys only count while a drive is on
    enable(v: boolean) {
      on = v
      if (!v) {
        down.clear()
        pad.clear()
        steer = 0
      }
    },
    press: (k: string, v: boolean) => (v ? pad.add(k) : pad.delete(k)),
    // one step of the page clock: the input the car gets
    read() {
      const target = (has('r') ? 1 : 0) - (has('l') ? 1 : 0)
      steer += (target - steer) * (target === 0 ? 0.35 : STEER_EASE)
      if (Math.abs(steer) < 0.01) steer = 0
      return { steer, throttle: (has('u') ? 1 : 0) - (has('d') ? 1 : 0), boost: has('b') }
    },
    get steer() {
      return steer
    },
  }
}
