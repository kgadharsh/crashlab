// Does network size change how well a car drives tracks it never saw?
// Trains with the app's real setup (grip on, the 5 training tracks, 80 generations, no early
// stop so every size gets the same effort), then tests on unseen tracks.
//   npx tsx scripts/sizeTest.ts <hidden neurons> <first seed> <last seed>
// Hidden 0 means no hidden layer at all. Prints one JSON line per seed.
import { think, INPUTS, OUTPUTS, type Brain } from '../src/brain'
import { createEvolution, DEFAULT_SETTINGS } from '../src/evolve'
import { makeRng } from '../src/random'
import { DEFAULT_TRACK, USE_GRIP, lapSteps } from '../src/sim'
import { makeTrack } from '../src/track'

const HIDDEN = Number(process.argv[2] ?? 5)
const FIRST = Number(process.argv[3] ?? 1)
const LAST = Number(process.argv[4] ?? 10)
const GENERATIONS = 80

const TRAIN_TRACKS = [DEFAULT_TRACK, ...Array.from({ length: 4 }, (_, i) => makeTrack(100 + i, 1))]
const TEST_D1 = Array.from({ length: 40 }, (_, i) => makeTrack(30000 + i, 1))
const TEST_D15 = Array.from({ length: 40 }, (_, i) => makeTrack(31000 + i, 1.5, 55))

function hiddenBrain(n: number, g: number[]): Brain {
  let k = 0
  const w1 = Array.from({ length: n }, () => Array.from({ length: INPUTS }, () => g[k++]))
  const b1 = Array.from({ length: n }, () => g[k++])
  const w2 = Array.from({ length: OUTPUTS }, () => Array.from({ length: n }, () => g[k++]))
  const b2 = Array.from({ length: OUTPUTS }, () => g[k++])
  return { w1, b1, w2, b2 }
}

// think() always has a hidden layer, so "no hidden layer" is built as a pass-through: one
// hidden neuron per input, each tanh(0.01 x), which is x/100 to within about 1 part in 10000.
// The evolved weights are multiplied by 100 on the way out, so the car really is
// output = tanh(weights x inputs + bias).
const PASS = 0.01
function linearBrain(g: number[]): Brain {
  const w1 = Array.from({ length: INPUTS }, (_, h) => Array.from({ length: INPUTS }, (_, i) => (i === h ? PASS : 0)))
  const w2 = Array.from({ length: OUTPUTS }, (_, o) => g.slice(o * INPUTS, (o + 1) * INPUTS).map((w) => w / PASS))
  return { w1, b1: new Array(INPUTS).fill(0), w2, b2: g.slice(OUTPUTS * INPUTS) }
}

const makeBrain = (g: number[]) => (HIDDEN === 0 ? linearBrain(g) : hiddenBrain(HIDDEN, g))
const genomeLength =
  HIDDEN === 0 ? OUTPUTS * INPUTS + OUTPUTS : HIDDEN * INPUTS + HIDDEN + OUTPUTS * HIDDEN + OUTPUTS

function test(brain: Brain, tracks: typeof TEST_D1) {
  const laps = tracks.map((t) => lapSteps(brain, t, USE_GRIP)).filter((l): l is number => l !== null)
  return { lapped: laps.length, avgLap: laps.length ? laps.reduce((a, b) => a + b, 0) / laps.length / 60 : null }
}

if (process.argv[5] === 'check') {
  const rng = makeRng(1)
  const g = Array.from({ length: 14 }, () => rng() * 8 - 4)
  let worst = 0
  for (let n = 0; n < 2000; n++) {
    const x = Array.from({ length: INPUTS }, () => rng())
    const exact = [0, 1].map((o) => Math.tanh(x.reduce((s, v, i) => s + v * g[o * INPUTS + i], g[12 + o])))
    const got = think(linearBrain(g), x).outputs
    worst = Math.max(worst, Math.abs(exact[0] - got[0]), Math.abs(exact[1] - got[1]))
  }
  console.log('pass-through worst output error: ' + worst)
  process.exit(0)
}

for (let seed = FIRST; seed <= LAST; seed++) {
  const t0 = Date.now()
  const settings = { ...DEFAULT_SETTINGS, genomeLength, grip: USE_GRIP, goodEnough: 1e9 }
  const evolution = createEvolution(makeBrain, makeRng(seed), GENERATIONS, settings, TRAIN_TRACKS)
  let done = false
  let best = evolution.step().report.best
  while (!done) {
    const { report, finished } = evolution.step()
    best = report.best
    done = finished
  }
  const brain = makeBrain(best.genome)
  const practice = lapSteps(brain, DEFAULT_TRACK, USE_GRIP)
  console.log(JSON.stringify({
    hidden: HIDDEN, weights: genomeLength, seed, fitness: +best.fitness.toFixed(2),
    practice: practice === null ? null : +(practice / 60).toFixed(2),
    d1: test(brain, TEST_D1), d15: test(brain, TEST_D15), secs: Math.round((Date.now() - t0) / 1000),
  }))
}
