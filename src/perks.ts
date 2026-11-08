// Coming back: a day streak with perks that open at 2, 3, 5 and 7 days in a row. A perk is kept for good once it has been
// earned, so a missed day costs the streak but never a perk. Perks change how the game feels and what you can do in it, and
// none touches how a car races, so nothing here can be ranked and nothing here is checked by the server.
import { drawCar } from './draw'

const STREAK = 'crashlab.streak'
const PAINT = 'crashlab.paint'

export type Perk = { id: 'paint' | 'shelf' | 'glow' | 'nitro'; name: string; days: number; does: string }
export const PERKS: Perk[] = [
  { id: 'paint', name: 'Paint shop', days: 2, does: 'Six colours for your car, on every screen.' },
  { id: 'shelf', name: 'Bigger shelf', days: 3, does: 'Two more places on the car shelf, to keep more trainings.' },
  { id: 'glow', name: 'Neon glow', days: 5, does: 'Your car glows in its own colour on the track.' },
  { id: 'nitro', name: 'Hand-drive nitro', days: 7, does: 'A boost on Space when you drive a track yourself: four seconds a lap, so use it on the straights.' },
]

type Streak = { last: string; days: number; best: number }
const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in the player's own time zone
const dayNumber = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86_400_000)

function read(): Streak {
  try {
    const v = JSON.parse(localStorage.getItem(STREAK) ?? 'null') as Streak | null
    if (v && typeof v.last === 'string' && Number.isInteger(v.days) && Number.isInteger(v.best)) return v
  } catch {
    /* nothing remembered */
  }
  return { last: '', days: 0, best: 0 }
}

// Count today's visit. Returns the streak and the perks it has just opened.
export function visit(): { days: number; best: number; fresh: Perk[] } {
  const s = read()
  const now = today()
  if (s.last === now) return { days: s.days, best: s.best, fresh: [] }
  const before = s.best
  const days = s.last && dayNumber(now) - dayNumber(s.last) === 1 ? s.days + 1 : 1
  const next = { last: now, days, best: Math.max(s.best, days) }
  try {
    localStorage.setItem(STREAK, JSON.stringify(next))
  } catch {
    /* storage blocked: the streak only lasts this visit */
  }
  return { days, best: next.best, fresh: PERKS.filter((p) => p.days > before && p.days <= next.best) }
}

export const streak = () => {
  const s = read()
  // a streak that was not continued yesterday or today has already lapsed
  const live = s.last && dayNumber(today()) - dayNumber(s.last) <= 1 ? s.days : 0
  return { days: live, best: s.best, today: s.last === today() }
}
export const hasPerk = (id: Perk['id']) => (PERKS.find((p) => p.id === id)?.days ?? Infinity) <= read().best
export const nextPerk = () => PERKS.find((p) => p.days > read().best) ?? null
export const shelfSize = (base: number) => base + (hasPerk('shelf') ? 2 : 0)

// ---------- PAINT AND GLOW ----------
export const PAINTS = [
  { name: 'Amber', colour: '#ffb31a' },
  { name: 'Cyan', colour: '#3fd0ff' },
  { name: 'Green', colour: '#3ddc84' },
  { name: 'Violet', colour: '#b48cff' },
  { name: 'Pink', colour: '#ff7a9c' },
  { name: 'White', colour: '#f4f6f8' },
]
export function loadPaint(): number {
  try {
    const n = Number(localStorage.getItem(PAINT))
    return Number.isInteger(n) && n >= 0 && n < PAINTS.length ? n : 0
  } catch {
    return 0
  }
}
export function savePaint(n: number) {
  try {
    localStorage.setItem(PAINT, String(n))
  } catch {
    /* storage blocked: the colour only lasts this visit */
  }
}
// The player's own car: its paint (amber until the paint shop is earned) and its glow
export const paintColour = () => (hasPerk('paint') ? PAINTS[loadPaint()].colour : PAINTS[0].colour)
export function drawMine(g: CanvasRenderingContext2D, c: { x: number; y: number; angle: number }, length: number, width: number, look: number) {
  const colour = paintColour()
  if (hasPerk('glow')) {
    g.save()
    g.shadowColor = colour
    g.shadowBlur = 22
    drawCar(g, c, length, width, colour, look)
    g.restore()
  }
  drawCar(g, c, length, width, colour, look)
}
