// Do a player's build choices matter more than training luck?
// Trains every build with several seeds on the real budget, then races each car on
// 20 tracks no build practised on. If cars from the same build differ as much as cars
// from different builds, luck decides the game.
//
// Runs are slow (about 2 minutes each), so they go in small batches with rests:
//   npx tsx scripts/luckVsBuild.ts run <first> <last> <results.jsonl>   train runs first..last (0-based)
//   npx tsx scripts/luckVsBuild.ts summary <results.jsonl>              print the analysis
import { appendFileSync, readFileSync } from 'node:fs'
import { createTraining } from '../src/training'
import { genomeToBrain } from '../src/genome'
import { runLap } from '../src/sim'
import { makeTrack } from '../src/track'
import { DEFAULT_BUILD, shapeOf, specOf, type Build } from '../src/setup'

const base = DEFAULT_BUILD
export const BUILDS: Record<string, Build> = {
  default: base,
  wideVision: { ...base, sensors: { count: 9, spread: 180 } }, // the 4 Nov 2026 runs also used ray range 280, before range was removed
  sixTracks: { ...base, practice: [0, 1, 2, 3, 4, 6] },
  fastCautious: { ...base, balance: 1, reward: { pace: 0, safety: 0.8, smooth: 0 } },
}
const SEEDS = [1, 2, 3]
const RUNS = Object.keys(BUILDS).flatMap((name) => SEEDS.map((seed) => ({ name, seed })))

// Unseen race tracks, from gentle to wild like the practice set, with seeds no practice track uses
const RACE = Array.from({ length: 20 }, (_, i) => makeTrack(9000 + i, 0.35 + (0.65 * (i % 4)) / 3))
const REST_MS = 45_000 // rest between runs so the laptop stays cool

type Result = { name: string; seed: number; generations: number; seconds: number; finished: number; totalTime: number; laps: (number | null)[] }

function race(build: Build, genome: number[]) {
  const brain = genomeToBrain(genome, shapeOf(build.sensors))
  const spec = specOf(build)
  return RACE.map((t) => runLap(brain, t, spec).time)
}

async function runBatch(first: number, last: number, out: string) {
  for (let i = first; i <= last && i < RUNS.length; i++) {
    if (i > first) await new Promise((r) => setTimeout(r, REST_MS))
    const { name, seed } = RUNS[i]
    const build = BUILDS[name]
    const t0 = Date.now()
    const training = createTraining(build, seed)
    let step = training.step()
    while (!step.finished) step = training.step()
    const genome = training.winner(step.report.population)
    const laps = race(build, genome)
    const done = laps.filter((l): l is number => l !== null)
    const result: Result = {
      name,
      seed,
      generations: training.generations,
      seconds: Math.round((Date.now() - t0) / 1000),
      finished: done.length,
      totalTime: done.reduce((s, l) => s + l, 0) / 60,
      laps: laps.map((l) => (l === null ? null : Math.round(l / 6) / 10)),
    }
    appendFileSync(out, JSON.stringify(result) + '\n')
    console.log('run ' + i + ': ' + name + ' seed ' + seed + ' | ' + result.generations + ' generations, ' + result.seconds + ' s | finished ' + result.finished + '/20')
  }
}

function summary(file: string) {
  const results: Result[] = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)))
  console.log('build          seeds  finished (of 20) per seed   mean   spread   generations')
  const means: number[] = []
  const withinSpreads: number[] = []
  for (const name of Object.keys(BUILDS)) {
    const rs = results.filter((r) => r.name === name).sort((a, b) => a.seed - b.seed)
    if (!rs.length) continue
    const f = rs.map((r) => r.finished)
    means.push(mean(f))
    withinSpreads.push(sd(f))
    console.log(
      name.padEnd(14), String(rs.length).padEnd(6), f.join(', ').padEnd(28),
      mean(f).toFixed(1).padStart(5), sd(f).toFixed(1).padStart(8), '   ' + rs.map((r) => r.generations).join(', '),
    )
  }
  console.log('\nspread between builds (sd of build means):', sd(means).toFixed(2))
  console.log('typical spread within a build (mean sd across seeds):', mean(withinSpreads).toFixed(2))
  // Which races every car failed, and which every car finished: tracks that cannot tell cars apart
  const all = results.map((r) => r.laps)
  const never = RACE.map((_, i) => i).filter((i) => all.every((l) => l[i] === null))
  const always = RACE.map((_, i) => i).filter((i) => all.every((l) => l[i] !== null))
  console.log('race tracks no car finished:', never.join(', ') || 'none', '| tracks every car finished:', always.join(', ') || 'none')
}

const [mode, ...args] = process.argv.slice(2)
if (mode === 'run') await runBatch(Number(args[0]), Number(args[1]), args[2])
else if (mode === 'summary') summary(args[0])
else console.log('runs:', RUNS.map((r, i) => i + '=' + r.name + '/' + r.seed).join(' '))
