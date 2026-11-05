// Are the track board's gold times fair across builds? Trains a build once per seed exactly as the app does
// (full budget, then the final pick), then drives one lap of every practice track on a dry road and on a wet
// one, and saves every lap time. The report works out gold times (0.5% under the median lap of the cars
// trained on dry roads, so gold means clearly beating a typical car), a silver margin (5% over the median) and
// a wet factor, and shows how many laps would win each medal.
// Usage: npx tsx scripts/boardCalibration.ts train <out.json> <build> <seed>   (one run per call: rest between calls)
//        npx tsx scripts/boardCalibration.ts report <out.json>                  (no training)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { genomeToBrain } from '../src/genome'
import { runLap } from '../src/sim'
import { DEFAULT_BUILD as base, shapeOf, specOf, type Build } from '../src/setup'
import { PRACTICE_COUNT, practiceOnRoad } from '../src/track'
import { PAR, SILVER_SLACK, WET_FACTOR, lapMedal } from '../src/board'

const BUILDS: Record<string, Build> = {
  default: base,
  wideVision: { ...base, sensors: { count: 9, spread: 180 } },
  sixTracks: { ...base, practice: [0, 1, 2, 3, 4, 6] },
  fastCautious: { ...base, balance: 1, reward: { pace: 0, safety: 0.8, smooth: 0 } },
  careful: { ...base, reward: { pace: 0, safety: 0.8, smooth: 0.5 } },
  wet: { ...base, weather: 'wet' },
}
type Row = { build: string; seed: number; generations: number; dry: (number | null)[]; wet: (number | null)[] }

const lapTimes = (build: Build, genome: number[], wet: boolean) => {
  const brain = genomeToBrain(genome, shapeOf(build.sensors))
  return Array.from({ length: PRACTICE_COUNT }, (_, id) => {
    const r = runLap(brain, practiceOnRoad(id, wet), specOf(build))
    return r.time === null ? null : r.time / 60
  })
}
const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo)
}
const finished = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null)

const [mode, out, buildName, seedArg] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const build = BUILDS[buildName]
  const seed = Number(seedArg)
  const training = createTraining(build, seed)
  let step = training.step()
  while (!step.finished) step = training.step()
  const genome = training.winner(step.report.population)
  const row: Row = { build: buildName, seed, generations: training.generations, dry: lapTimes(build, genome, false), wet: lapTimes(build, genome, true) }
  saved.push(row)
  writeFileSync(out, JSON.stringify(saved))
  console.log(buildName + ' seed ' + seed + ' | ' + row.generations + ' generations | dry laps finished ' + finished(row.dry).length + '/' + PRACTICE_COUNT + ' | wet ' + finished(row.wet).length + '/' + PRACTICE_COUNT)
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  const dryCars = rows.filter((r) => BUILDS[r.build].weather !== 'wet')
  const wetCars = rows.filter((r) => BUILDS[r.build].weather === 'wet')
  console.log('Cars: ' + rows.length + ' (' + dryCars.length + ' trained dry, ' + wetCars.length + ' trained wet): ' + rows.map((r) => r.build + r.seed).join(' '))
  console.log('\nDry laps of the dry-trained cars (s):  track | finished | fastest | median | slowest | gold now → proposed (median less 0.5%)')
  const proposed: number[] = []
  for (let id = 0; id < PRACTICE_COUNT; id++) {
    const times = finished(dryCars.map((r) => r.dry[id])).sort((a, b) => a - b)
    const gold = times.length >= 3 ? Math.round(quantile(times, 0.5) * 0.995 * 10) / 10 : PAR[id]
    proposed.push(gold)
    console.log(String(id).padStart(2) + ' | ' + times.length + '/' + dryCars.length + ' | ' + (times.length ? [times[0], quantile(times, 0.5), times[times.length - 1]].map((t) => t.toFixed(1)).join(' | ') : '–') + ' | ' + PAR[id].toFixed(1) + ' → ' + gold.toFixed(1))
  }
  const slack = Math.round((1.05 / 0.995) * 1000) / 1000 // silver is within 5% of the median lap
  console.log('\nSilver margin on the gold time: ' + slack + ' (now ' + SILVER_SLACK + ')')
  const wetRatios = wetCars.flatMap((r) => r.wet.map((w, id) => (w !== null && r.dry[id] !== null ? w / r.dry[id]! : null))).filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (wetRatios.length) console.log('Wet lap divided by the same car\'s dry lap, over ' + wetRatios.length + ' laps: median ' + quantile(wetRatios, 0.5).toFixed(2) + ', range ' + wetRatios[0].toFixed(2) + ' to ' + wetRatios[wetRatios.length - 1].toFixed(2) + ' (now ' + WET_FACTOR + ')')
  // medals if the proposal were used
  const count = { gold: 0, silver: 0, bronze: 0, none: 0 }
  for (const r of dryCars) r.dry.forEach((t, id) => {
    if (t === null) return void count.none++
    const m = t <= proposed[id] ? 'gold' : t <= proposed[id] * slack ? 'silver' : 'bronze'
    count[m]++
  })
  const total = count.gold + count.silver + count.bronze + count.none
  console.log('\nDry laps by medal with the proposal: gold ' + Math.round((100 * count.gold) / total) + '%, silver ' + Math.round((100 * count.silver) / total) + '%, bronze ' + Math.round((100 * count.bronze) / total) + '%, did not finish ' + Math.round((100 * count.none) / total) + '%')
  const now = { gold: 0, silver: 0, bronze: 0, none: 0 }
  for (const r of dryCars) r.dry.forEach((t, id) => void now[lapMedal(id, t, false) ?? 'none']++)
  console.log('With the current par times: gold ' + Math.round((100 * now.gold) / total) + '%, silver ' + Math.round((100 * now.silver) / total) + '%, bronze ' + Math.round((100 * now.bronze) / total) + '%, did not finish ' + Math.round((100 * now.none) / total) + '%')
  console.log('\nPAR = [' + proposed.map((p) => p.toFixed(1)).join(', ') + ']')
}
