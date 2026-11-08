// The skill tree: nodes a player unlocks by racing, earning stars and entering the Weekly Challenge, then fits to a
// car by spending points. Every car has the same POINT_BUDGET (setup.ts), so unlocking opens new choices but never
// makes a car stronger, and every node costs something on the road too (setup.ts has the numbers, sim.ts what they do).
// Unlocks live in this browser only. The server cannot check them, which is fine because no node is a strict upgrade,
// and it does check that a car spends no more than the budget.
import type { Medal } from './race'
import { NODES, type NodeId } from './setup'

export type PartId = NodeId
export type Progress = { stars: number; gpMedals: Medal[]; racedWet: boolean; racedWeekly: boolean; licence: number } // licence: practice tracks driven round by hand
export type Branch = 'Eyes' | 'Engine' | 'Tyres' | 'Brain' | 'Practice' | 'Body'
export type Part = { id: PartId; branch: Branch; parent?: PartId; // the node it hangs from in the picture only: nothing has to be fitted first
   name: string; does: string; cost: string; unlock: string; open: (p: Progress) => boolean; max: number; points: number }

const P = (id: PartId) => NODES.find((n) => n.id === id)!
const node = (id: PartId, rest: Omit<Part, 'id' | 'max' | 'points'>): Part => ({ id, max: P(id).max, points: P(id).cost, ...rest })

// Intermediate tyres stay valid in setup.ts so cars that fitted them still load and race, but they are no longer offered:
// they lost badly to no tyre node twice (docs/experiments.md, 7 and 8 Nov 2026).
export const PARTS: Part[] = [
  // Eyes
  node('range', { branch: 'Eyes', name: 'Long rays', does: "The car's sight lines (rays) reach 320 instead of the usual 200, so bends and blocks show up much sooner. Walls right next to the car look the same as before.", cost: 'Top speed 3% lower, and the brain has to learn to use the longer view.', unlock: 'Available from the start', open: () => true }),
  node('focus', { branch: 'Eyes', parent: 'range', name: 'Focused rays', does: 'The sight lines bunch towards the front: more detail straight ahead, which suits fast straights.', cost: 'Less detail to the sides, so tight bends and blocks on the inside show up late.', unlock: 'Available from the start', open: () => true }),
  node('lens', { branch: 'Eyes', parent: 'range', name: 'Extra eyes', does: 'Two more sight lines, up to 11 in all, so the car sees more of the road at once.', cost: 'More sight lines mean a bigger brain to train in the same practice time.', unlock: 'Earn 5 stars', open: (p) => p.stars >= 5 }),
  node('wide', { branch: 'Eyes', parent: 'lens', name: 'Wide-angle lens', does: 'The sight lines can fan out to 260° instead of 200°, so the car sees round a bend before it is in it.', cost: 'Spread over a wider fan, each line sees less detail straight ahead.', unlock: 'Earn 11 stars', open: (p) => p.stars >= 11 }),
  node('lights', { branch: 'Eyes', parent: 'range', name: 'Headlights', does: 'At night the sight lines still reach their full distance. Without headlights they reach only 110 and see nothing beyond.', cost: 'Top speed 2% lower.', unlock: "Enter this week's Weekly Challenge (needs a Google sign-in)", open: (p) => p.racedWeekly }),
  // Engine
  node('launch', { branch: 'Engine', name: 'Launch control', does: 'Accelerates 50% harder, so the car is quick out of every bend.', cost: 'Top speed 4% lower.', unlock: 'Earn 8 stars', open: (p) => p.stars >= 8 }),
  node('quick', { branch: 'Engine', parent: 'launch', name: 'Quick steering', does: 'The car turns 30% faster.', cost: 'Twitchy: it starts to skid in bends at a 7% lower speed, so it has to slow down more. Top speed is also 3% lower.', unlock: 'Earn 15 stars', open: (p) => p.stars >= 15 }),
  node('feather', { branch: 'Engine', parent: 'quick', name: 'Featherweight chassis', does: 'Half the weight: it accelerates 20% faster off the line and turns 15% faster.', cost: 'Being light, it starts to skid in bends at a 7% lower speed.', unlock: 'Drive 5 practice tracks yourself (Practice → Drive it yourself)', open: (p) => p.licence >= 5 }),
  node('wing', { branch: 'Engine', parent: 'quick', name: 'Downforce wing', does: 'Presses the car onto the road, so the tyres hold on at a 12% higher speed in bends.', cost: 'Wind drag: top speed 7% lower.', unlock: 'Win any Grand Prix medal', open: (p) => p.gpMedals.some((m) => m !== null) }),
  node('brakes', { branch: 'Engine', parent: 'launch', name: 'Carbon brakes', does: 'Braking is 70% stronger, so the car can brake later and still make the bend.', cost: 'Heavier brake discs: top speed 2% lower.', unlock: 'Earn 6 stars', open: (p) => p.stars >= 6 }),
  node('traction', { branch: 'Engine', parent: 'brakes', name: 'Traction control', does: 'When the car steers harder than its tyres can grip, the engine eases off so the tyres keep gripping.', cost: 'The car is slower out of long bends, and the brain has less control over the engine.', unlock: 'Earn 11 stars', open: (p) => p.stars >= 11 }),
  node('turbo', { branch: 'Engine', parent: 'brakes', name: 'Turbo', does: 'Top speed 4% higher for each level.', cost: 'Slower to pick up speed: acceleration 15% lower for each level.', unlock: 'Earn 41 stars', open: (p) => p.stars >= 41 }),
  // Tyres
  node('steady', { branch: 'Tyres', name: 'Steady steering', does: 'The tyres hold on at an 8% higher speed in bends.', cost: 'The car turns 10% more slowly.', unlock: 'Drive 2 practice tracks yourself (Practice → Drive it yourself)', open: (p) => p.licence >= 2 }),
  node('tyres', { branch: 'Tyres', parent: 'steady', name: 'Wet tyres', does: 'Much more grip on a wet road.', cost: 'Top speed 8% lower on a dry road.', unlock: 'Race the wet Grand Prix once', open: (p) => p.racedWet }),
  node('spotter', { branch: 'Tyres', parent: 'studs', name: 'Ice spotter', does: 'The brain is warned when an ice patch is coming up, so it can slow down in time.', cost: 'It only helps if the brain learns to use the warning. Ice studs are the safe choice; this one is faster if it works.', unlock: 'Earn 20 stars', open: (p) => p.stars >= 20 }),
  node('studs', { branch: 'Tyres', parent: 'steady', name: 'Ice studs', does: 'Ice patches grip almost like a dry road. Without them the car starts to skid at less than half the speed.', cost: 'Top speed 3% lower everywhere.', unlock: 'Earn 30 stars', open: (p) => p.stars >= 30 }),
  node('rally', { branch: 'Tyres', parent: 'steady', name: 'Rally tyres', does: 'If the car enters a bend too fast it still turns, only less: it drifts wide instead of skidding straight on.', cost: 'The car starts to skid at a 12.5% lower speed.', unlock: 'Earn 9 stars', open: (p) => p.stars >= 9 }),
  // Brain
  node('brain', { branch: 'Brain', name: 'Bigger brain', does: 'Nine brain cells instead of five, so the car can learn trickier driving.', cost: 'Many more connections to learn in the same practice time.', unlock: 'Earn 23 stars', open: (p) => p.stars >= 23 }),
  node('lean', { branch: 'Brain', parent: 'brain', name: 'Lean brain', does: 'Three brain cells instead of five: far fewer connections, so each round of practice teaches it quickly.', cost: 'It cannot learn trickier driving. A bigger brain replaces it.', unlock: 'Earn 3 stars', open: (p) => p.stars >= 3 }),
  node('grip', { branch: 'Brain', parent: 'brain', name: 'Grip sense', does: 'The car can feel how close its tyres are to skidding, on any road.', cost: 'The sensor adds weight: top speed 3% lower.', unlock: 'Earn 36 stars', open: (p) => p.stars >= 36 }),
  node('huge', { branch: 'Brain', parent: 'brain', name: 'Huge brain', does: 'Thirteen brain cells: the most a car can learn with.', cost: 'A very large brain to train, and it replaces a bigger or lean brain.', unlock: 'Earn 45 stars', open: (p) => p.stars >= 45 }),
  // Body
  node('bumper', { branch: 'Body', name: 'Bumper', does: 'Once per track the car survives hitting a wall or a block: it stops dead and has to pull away again.', cost: 'Heavy: top speed 8% lower, and the stop costs time.', unlock: 'Earn 26 stars', open: (p) => p.stars >= 26 }),
  node('aids', { branch: 'Body', parent: 'bumper', name: 'Driver aids', does: 'The car brakes hard by itself when a wall is right ahead and it is going too fast to turn away.', cost: 'It also brakes for gentle bends the brain would have taken at full speed, so laps are slower.', unlock: 'Earn 17 stars', open: (p) => p.stars >= 17 }),
  // Practice
  node('slot', { branch: 'Practice', name: 'Extra practice track', does: 'Practise on up to 7 tracks instead of 6.', cost: 'It costs only the point. But more tracks to practise on means each round takes longer, so you get fewer rounds.', unlock: 'Win a gold medal in any Grand Prix', open: (p) => p.gpMedals.includes('gold') }),
  node('slot2', { branch: 'Practice', parent: 'slot', name: 'Second extra track', does: 'Practise on up to 8 tracks.', cost: 'Even fewer rounds: each one takes longer again.', unlock: 'Win gold in both Grand Prix', open: (p) => p.gpMedals.filter((m) => m === 'gold').length >= 2 }),
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
