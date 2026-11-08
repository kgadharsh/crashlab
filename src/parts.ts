// The skill tree: nodes a player unlocks by racing, earning stars and entering the Weekly Grand Prix, then fits to a
// car by spending points. Every car has the same POINT_BUDGET (setup.ts), so unlocking opens new choices but never
// makes a car stronger, and every node costs something on the road too (setup.ts has the numbers, sim.ts what they do).
// Unlocks live in this browser only. The server cannot check them, which is fine because no node is a strict upgrade,
// and it does check that a car spends no more than the budget.
import type { Medal } from './race'
import { NODES, type NodeId } from './setup'

export type PartId = NodeId
export type Progress = { stars: number; gpMedals: Medal[]; racedWet: boolean; racedWeekly: boolean; licence: number } // licence: practice tracks driven round by hand
export type Branch = 'Eyes' | 'Engine' | 'Tyres' | 'Brain' | 'Practice'
export type Part = { id: PartId; branch: Branch; name: string; does: string; cost: string; unlock: string; open: (p: Progress) => boolean; max: number; points: number }

const P = (id: PartId) => NODES.find((n) => n.id === id)!
const node = (id: PartId, rest: Omit<Part, 'id' | 'max' | 'points'>): Part => ({ id, max: P(id).max, points: P(id).cost, ...rest })

export const PARTS: Part[] = [
  node('range', {
    branch: 'Eyes',
    name: 'Long rays',
    does: 'Rays see 320 instead of 200, so bends and blocks show up much sooner. Near walls read exactly as before.',
    cost: 'The car is 3% slower, and the brain has longer readings to learn to use.',
    unlock: 'Open from the start',
    open: () => true,
  }),
  node('focus', {
    branch: 'Eyes',
    name: 'Focused rays',
    does: 'Rays bunch towards the front: fine detail straight ahead, for fast straights.',
    cost: 'Less to the sides, so hairpins and blocks on the inside show up late.',
    unlock: 'Open from the start',
    open: () => true,
  }),
  node('lights', {
    branch: 'Eyes',
    name: 'Headlights',
    does: 'At night, rays still see their full range. Without them they see 110 and nothing beyond.',
    cost: 'The car is 2% slower.',
    unlock: 'Race a Weekly Grand Prix (this week or a past one)',
    open: (p) => p.racedWeekly,
  }),
  node('lens', {
    branch: 'Eyes',
    name: 'Extra eyes',
    does: 'Two more rays, up to 11 in all, so the car sees more of the road at once.',
    cost: 'More rays means a bigger brain to train in the same practice budget.',
    unlock: '★ 6',
    open: (p) => p.stars >= 6,
  }),
  node('launch', {
    branch: 'Engine',
    name: 'Launch control',
    does: 'Half as much again acceleration, so the car is quick out of every bend.',
    cost: 'Top speed is 4% lower.',
    unlock: '★ 10',
    open: (p) => p.stars >= 10,
  }),
  node('quick', {
    branch: 'Engine',
    name: 'Quick steering',
    does: 'The car turns 30% faster.',
    cost: 'Twitchy: the tyres let go 7% sooner in bends, and top speed is 3% lower.',
    unlock: '★ 20',
    open: (p) => p.stars >= 20,
  }),
  node('feather', {
    branch: 'Engine',
    name: 'Featherweight chassis',
    does: 'Half the weight: 20% quicker off the line and the car turns 15% faster.',
    cost: 'It is light, so the tyres let go 7% sooner in bends.',
    unlock: 'Drive 5 practice tracks yourself (Practice → Drive it yourself)',
    open: (p) => p.licence >= 5,
  }),
  node('wing', {
    branch: 'Engine',
    name: 'Downforce wing',
    does: 'The tyres hold on to a 12% higher speed in bends.',
    cost: 'Drag: top speed is 7% lower.',
    unlock: 'Win any Grand Prix medal',
    open: (p) => p.gpMedals.some((m) => m !== null),
  }),
  node('tyres', {
    branch: 'Tyres',
    name: 'Wet tyres',
    does: 'Far more grip on a wet road.',
    cost: 'Top speed is 8% lower on a dry road.',
    unlock: 'Race the wet Grand Prix once',
    open: (p) => p.racedWet,
  }),
  node('steady', {
    branch: 'Tyres',
    name: 'Steady steering',
    does: 'The tyres hold on to an 8% higher speed in bends.',
    cost: 'The car turns 10% more slowly.',
    unlock: 'Drive 2 practice tracks yourself (Practice → Drive it yourself)',
    open: (p) => p.licence >= 2,
  }),
  node('studs', {
    branch: 'Tyres',
    name: 'Ice studs',
    does: 'Ice patches hold almost like a dry road. Without them the tyres let go at less than half the speed.',
    cost: 'The car is 3% slower everywhere.',
    unlock: '★ 40',
    open: (p) => p.stars >= 40,
  }),
  node('brain', {
    branch: 'Brain',
    name: 'Bigger brain',
    does: 'Nine neurons instead of five, so the car can learn trickier driving.',
    cost: 'Many more connections to learn in the same practice budget.',
    unlock: '★ 30',
    open: (p) => p.stars >= 30,
  }),
  node('grip', {
    branch: 'Brain',
    name: 'Grip sense',
    does: 'The car feels how close its tyres are to letting go, on any road.',
    cost: 'The sensor weighs the car down: top speed is 3% lower.',
    unlock: '★ 48',
    open: (p) => p.stars >= 48,
  }),
  node('slot', {
    branch: 'Practice',
    name: 'Extra practice track',
    does: 'Practise on up to 7 tracks instead of 6.',
    cost: 'Only the point: but more tracks also means fewer training rounds.',
    unlock: 'Win a gold medal in any Grand Prix',
    open: (p) => p.gpMedals.includes('gold'),
  }),
]

const SEEN_KEY = 'crashlab.partsSeen'

// Nodes that have unlocked since the player was last told, which are then marked as told.
// A player who had seen everything before the tree is not told again about the nodes that open from the start.
export function newlyUnlocked(p: Progress): Part[] {
  let seen: string[] = []
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]
  } catch {
    /* nothing remembered */
  }
  const fresh = PARTS.filter((part) => part.open(p) && !seen.includes(part.id) && part.unlock !== 'Open from the start')
  if (fresh.length) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((f) => f.id)]))
    } catch {
      /* storage blocked: the news may show again next visit */
    }
  }
  return fresh
}
