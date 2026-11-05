// Is the Grand Prix gold time fair across builds? Trains a build once per seed exactly as the app does
// (full budget, then the final pick), races the car on the Grand Prix with the real race-day scoring,
// and saves every track's time. The report shows, for several candidate gold lines, how many cars
// would win gold.
// Usage: npx tsx scripts/medalCalibration.ts train <out.json> <build> <seed>   (one run per call: rest between calls)
//        npx tsx scripts/medalCalibration.ts report <out.json>                  (no training)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { GOLD_TIME, RACE_COUNT, raceCar } from '../src/race'
import { DEFAULT_BUILD as base, type Build } from '../src/setup'

const BUILDS: Record<string, Build> = {
  default: base,
  wideVision: { ...base, sensors: { count: 9, spread: 180 } },
  sixTracks: { ...base, practice: [0, 1, 2, 3, 4, 6] },
  fastCautious: { ...base, balance: 1, reward: { pace: 0, safety: 0.8, smooth: 0 } },
  careful: { ...base, reward: { pace: 0, safety: 0.8, smooth: 0.5 } },
}
type Row = { build: string; seed: number; generations: number; finished: number; totalTime: number; times: (number | null)[] }

const [mode, out, buildName, seedArg] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const build = BUILDS[buildName]
  const seed = Number(seedArg)
  const training = createTraining(build, seed)
  let step = training.step()
  while (!step.finished) step = training.step()
  const result = raceCar({ name: 'calibration', build, genome: training.winner(step.report.population) })
  const row: Row = { build: buildName, seed, generations: training.generations, finished: result.finished, totalTime: result.totalTime, times: result.tracks.map((t) => t.time) }
  saved.push(row)
  writeFileSync(out, JSON.stringify(saved))
  console.log(buildName + ' seed ' + seed + ' | ' + row.generations + ' generations | ' + row.finished + '/' + RACE_COUNT + (row.finished === RACE_COUNT ? ' in ' + row.totalTime.toFixed(0) + ' s' : ''))
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  const all8 = (r: Row) => r.finished === RACE_COUNT
  console.log('Cars: ' + rows.length + ' | finished all ' + RACE_COUNT + ': ' + rows.filter(all8).length + ' | gold line now ' + GOLD_TIME + ' s')
  for (const name of Object.keys(BUILDS)) {
    const mine = rows.filter((r) => r.build === name)
    if (!mine.length) continue
    console.log(
      name.padEnd(13) + mine.map((r) => (all8(r) ? r.totalTime.toFixed(0) + ' s' : r.finished + '/' + RACE_COUNT)).join(' | ') + '  → gold at ' + GOLD_TIME + ' s: ' + mine.filter((r) => all8(r) && r.totalTime <= GOLD_TIME).length + ' of ' + mine.length,
    )
  }
  const times = rows.filter(all8).map((r) => r.totalTime).sort((a, b) => a - b)
  console.log('Times of the cars that finished all ' + RACE_COUNT + ' (s): ' + times.map((t) => t.toFixed(0)).join(' '))
  console.log('Share of ALL cars that would win gold at each line:')
  for (const line of [130, 140, 150, 160, 170, 180, 200]) console.log('  ' + line + ' s: ' + Math.round((100 * times.filter((t) => t <= line).length) / rows.length) + '%')
}
