// Headless check of the engine: a short training run with a given build, then a race lap
// on a few unseen tracks. Small on purpose, so it runs cool. Usage: npx tsx scripts/check.ts
import { createEvolution, scorePopulation, DEFAULT_SETTINGS, type Drive } from '../src/evolve'
import { genomeToBrain } from '../src/genome'
import { makeRng } from '../src/random'
import { runBrain, runLap } from '../src/sim'
import { makeTrack, moveBlocks, practiceTrack } from '../src/track'
import { DEFAULT_BUILD, specOf, shapeOf, genomeLength, type Build } from '../src/setup'

const GENERATIONS = Number(process.argv[2] ?? 25)
const builds: Record<string, Build> = {
  default: DEFAULT_BUILD,
  wide9: { ...DEFAULT_BUILD, sensors: { count: 9, spread: 180 }, balance: 0.8, reward: { pace: 0.6, safety: 0.8, smooth: 0.3 } },
}
const still = Array.from({ length: 5 }, (_, i) => makeTrack(9100 + i, 1))

const REST_MS = 45_000 // rest between runs so the laptop stays cool
let first = true
for (const [name, build] of Object.entries(builds)) {
  if (!first) await new Promise((r) => setTimeout(r, REST_MS))
  first = false
  const t0 = Date.now()
  const spec = specOf(build)
  const shape = shapeOf(build.sensors)
  const rng = makeRng(1)
  const trackRng = makeRng(2)
  const drive: Drive = (g, track) => runBrain(genomeToBrain(g, shape), track, spec, build.reward)
  const evo = createEvolution(rng, { ...DEFAULT_SETTINGS, genomeLength: genomeLength(shape) }, drive, () =>
    build.practice.map((id) => moveBlocks(practiceTrack(id), trackRng)),
  )
  let spent = 0
  let last = evo.step()
  spent += last.steps
  for (let g = 1; g < GENERATIONS; g++) {
    last = evo.step()
    spent += last.steps
  }
  const best = scorePopulation(last.population.slice(0, 10), drive, build.practice.map(practiceTrack))[0]
  const brain = genomeToBrain(best.genome, shape)
  const finished = (set: typeof still) => set.map((t) => runLap(brain, t, spec)).filter((l) => l.time !== null).length
  console.log(
    name.padEnd(8),
    'weights', genomeLength(shape),
    '| best fitness', last.best.fitness.toFixed(1),
    '| steps used', (spent / 1e6).toFixed(1) + 'M',
    '| still tracks', finished(still) + '/' + still.length,
    '|', ((Date.now() - t0) / 1000).toFixed(0) + ' s',
  )
}
