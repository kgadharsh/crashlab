// Car designs: how the player's car looks. They change nothing about how it drives.
// The first is free and the others are rewards for stars (see board.ts).
export type Look = { name: string; stars: number }
export const LOOKS: Look[] = [
  { name: 'Classic', stars: 0 },
  { name: 'Arrow', stars: 12 }, // a first trained car earns about 24 stars on the track board, so this one comes quickly
  { name: 'Wedge', stars: 30 },
  { name: 'Needle', stars: 48 },
  { name: 'Hyper', stars: 70 }, // of 92 in all: 12 tracks on each road at 3 stars, and 10 for each Grand Prix gold
]

const KEY = 'crashlab.look'

export function loadLook(): number {
  try {
    const n = Number(JSON.parse(localStorage.getItem(KEY) ?? '0'))
    return Number.isInteger(n) && n >= 0 && n < LOOKS.length ? n : 0
  } catch {
    return 0
  }
}

export function saveLook(n: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify(n))
  } catch {
    /* storage blocked: the choice only lasts this visit */
  }
}

export const isUnlocked = (look: number, stars: number) => (LOOKS[look]?.stars ?? Infinity) <= stars

// The next design still locked, if any
export function nextLook(stars: number): { look: number; name: string; need: number } | null {
  const i = LOOKS.findIndex((l) => l.stars > stars)
  return i < 0 ? null : { look: i, name: LOOKS[i].name, need: LOOKS[i].stars - stars }
}
