// Are the skill tree's wave-1 nodes real trade-offs? For each seed, trains the default build with one node at a time on
// the full budget, then races every car on four Grand Prix: dry, wet, at night and with ice patches (the last two are a
// fixed weekly Grand Prix with that condition). A node that wins everywhere is too strong; one that never helps is not
// worth a point. The night and ice cars practise in that condition, with and without the node that answers it.
// Usage: npx tsx scripts/nodeCheck.ts train <out.json> <seed> [variant[,variant...] or name@seed,...]   (one training per variant, with rests between them)
//        npx tsx scripts/nodeCheck.ts report <out.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { GRAND_PRIXES, raceCar, weeklyGp, type GrandPrix } from '../src/race'
import { DEFAULT_BUILD, type Build } from '../src/setup'

const REST_MS = 45_000
type Result = { finished: number; totalTime: number }
type Row = { seed: number; variant: string; generations: number; results: Result[] }

const base = weeklyGp(3000, 424242) // a fixed set of weekly tracks, raced at night and with ice
const RACES: GrandPrix[] = [GRAND_PRIXES[0], GRAND_PRIXES[1], { ...base, id: 'check-night', night: true, ice: undefined, wet: false }, { ...base, id: 'check-ice', ice: true, night: undefined, wet: false }]
const RACE_NAMES = ['dry', 'wet', 'night', 'ice']

const VARIANTS: Record<string, Build> = {
  none: DEFAULT_BUILD,
  range1: { ...DEFAULT_BUILD, parts: { range: true } },
  focus: { ...DEFAULT_BUILD, parts: { focus: true } },
  launch: { ...DEFAULT_BUILD, parts: { launch: true } },
  quick: { ...DEFAULT_BUILD, parts: { quick: true } },
  wing: { ...DEFAULT_BUILD, parts: { wing: true } },
  'wet-none': { ...DEFAULT_BUILD, weather: 'wet' },
  // 8 Nov 2026: combinations that stack grip or steering, two cheap untested nodes, and two new ones
  'stack-grip': { ...DEFAULT_BUILD, chassis: 'tourer', parts: { wing: true, steady: true } },
  'stack-turn': { ...DEFAULT_BUILD, chassis: 'drifter', parts: { quick: true, feather: true } }, // no longer allowed: quick and feather are exclusive
  brakes: { ...DEFAULT_BUILD, parts: { brakes: true } },
  steady: { ...DEFAULT_BUILD, parts: { steady: true } },
  rally: { ...DEFAULT_BUILD, parts: { rally: true } },
  'wet-rally': { ...DEFAULT_BUILD, weather: 'wet', parts: { rally: true } },
  bumper: { ...DEFAULT_BUILD, parts: { bumper: true } },
  'turn-quick': { ...DEFAULT_BUILD, chassis: 'drifter', parts: { quick: true } }, // the steering stack as it can be built now
  // the second round of ideas
  aids: { ...DEFAULT_BUILD, parts: { aids: true } },
  traction: { ...DEFAULT_BUILD, parts: { traction: true } },
  'ice-spotter': { ...DEFAULT_BUILD, cond: { ice: true }, parts: { spotter: true } },
  'wet-inters': { ...DEFAULT_BUILD, weather: 'wet', parts: { inters: true } }, // re-added 8 Nov 2026 at wet grip 1.2, dry top 0.97
  range3: { ...DEFAULT_BUILD, parts: { range: 3 } },
  'night-none': { ...DEFAULT_BUILD, cond: { night: true } },
  'night-lights': { ...DEFAULT_BUILD, cond: { night: true }, parts: { lights: true } },
  'ice-none': { ...DEFAULT_BUILD, cond: { ice: true } },
  'ice-studs': { ...DEFAULT_BUILD, cond: { ice: true }, parts: { studs: true } },
}

const cell = (r: Result) => r.finished + '/8' + (r.finished === 8 ? ' ' + r.totalTime.toFixed(0) + 's' : '')

const [mode, out, seedArg, only] = process.argv.slice(2)
if (mode === 'train') {
  const seed = Number(seedArg)
  // "name@seed,name@seed" runs those jobs with their own seeds; "name,name" runs those names with the seed given
  const jobs: [string, number][] = only
    ? only.split(',').map((j) => (j.includes('@') ? ([j.split('@')[0], Number(j.split('@')[1])] as [string, number]) : ([j, seed] as [string, number])))
    : Object.keys(VARIANTS).map((v) => [v, seed] as [string, number])
  for (const [n, [variant, seed]] of jobs.entries()) {
    if (n > 0) await new Promise((r) => setTimeout(r, REST_MS))
    const build = VARIANTS[variant]
    const training = createTraining(build, seed)
    let step = training.step()
    while (!step.finished) step = training.step()
    const genome = training.winner(step.report.population)
    const results = RACES.map((gp) => {
      const r = raceCar({ name: 'check', build, genome }, gp)
      return { finished: r.finished, totalTime: r.totalTime }
    })
    const row: Row = { seed, variant, generations: training.generations, results }
    const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
    saved.push(row)
    writeFileSync(out, JSON.stringify(saved, null, 1))
    console.log(seed, variant.padEnd(12), String(row.generations).padStart(4), 'gens |', results.map((r, i) => RACE_NAMES[i] + ' ' + cell(r).padEnd(9)).join(' | '))
  }
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  for (const variant of Object.keys(VARIANTS)) {
    const mine = rows.filter((r) => r.variant === variant)
    if (!mine.length) continue
    const avg = (f: (r: Row) => number) => (mine.reduce((s, r) => s + f(r), 0) / mine.length).toFixed(1)
    console.log(
      variant.padEnd(12), mine.length + ' seeds |',
      RACE_NAMES.map((name, i) => name + ' ' + avg((r) => r.results[i].finished) + '/8 (all 8: ' + mine.filter((r) => r.results[i].finished === 8).length + ', ' + avg((r) => r.results[i].totalTime) + 's)').join(' | '),
    )
  }
}
