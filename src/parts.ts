// Parts: kit a player unlocks by racing and earning stars. Each one changes what the car can do, and each costs
// something, so a car without parts can still win (setup.ts has the numbers, sim.ts what they do).
// Unlocks live in this browser only. The server cannot check them, which is fine because no part is a strict upgrade.
import type { Medal } from './race'
import { PART_IDS } from './setup'

export type PartId = (typeof PART_IDS)[number]
export type Progress = { stars: number; gpMedals: Medal[]; racedWet: boolean }
export type Part = { id: PartId; name: string; does: string; cost: string; unlock: string; open: (p: Progress) => boolean }

export const PARTS: Part[] = [
  {
    id: 'eyes',
    name: 'Long-range eyes',
    does: 'Rays see 60% further, so bends and blocks show up much sooner.',
    cost: 'A near wall reads as a smaller number, so close driving is harder to learn, and the car is 3% slower.',
    unlock: 'Win any Grand Prix medal',
    open: (p) => p.gpMedals.some((m) => m !== null),
  },
  {
    id: 'tyres',
    name: 'Wet tyres',
    does: 'Far more grip on a wet road, which is what Grand Prix 2 is raced on.',
    cost: 'Top speed is 8% lower on a dry road.',
    unlock: 'Race the wet Grand Prix once',
    open: (p) => p.racedWet,
  },
  {
    id: 'brain',
    name: 'Bigger brain',
    does: 'Nine neurons instead of five, so the car can learn trickier driving.',
    cost: 'Many more connections to learn in the same practice budget.',
    unlock: '★ 30',
    open: (p) => p.stars >= 30,
  },
  {
    id: 'grip',
    name: 'Grip sense',
    does: 'The car feels how close its tyres are to letting go, on any road.',
    cost: 'The sensor weighs the car down: top speed is 3% lower.',
    unlock: '★ 48',
    open: (p) => p.stars >= 48,
  },
]

const SEEN_KEY = 'crashlab.partsSeen'

// Parts that have unlocked since the player was last told, which are then marked as told
export function newlyUnlocked(p: Progress): Part[] {
  let seen: string[] = []
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]
  } catch {
    /* nothing remembered */
  }
  const fresh = PARTS.filter((part) => part.open(p) && !seen.includes(part.id))
  if (fresh.length) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((f) => f.id)]))
    } catch {
      /* storage blocked: the news may show again next visit */
    }
  }
  return fresh
}
