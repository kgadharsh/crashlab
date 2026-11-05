// Does carrying on from a trained car help? For each seed: train the default build normally (car A),
// then carry on from A with KEEP_TRAINING_SHARE of the budget two ways: on the same four practice
// tracks, and on six (adding two). Every car is raced on the Grand Prix with the real scoring.
// The report also shows what training a six-track car from scratch gave on the same seeds
// (the saved results of scripts/medalCalibration.ts), to compare adding tracks by carrying on with
// starting again.
// Usage: npx tsx scripts/keepTraining.ts train <out.json> <seed>   (one seed per call: rest between calls)
//        npx tsx scripts/keepTraining.ts report <out.json> [medalCalibration.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { RACE_COUNT, medalFor, raceCar } from '../src/race'
import { DEFAULT_BUILD as base, KEEP_TRAINING_SHARE, TRAINING_BUDGET, type Build } from '../src/setup'

const SIX: Build = { ...base, practice: [0, 1, 2, 3, 4, 6] }
type Result = { finished: number; totalTime: number }
type Row = { seed: number; A: Result; same: Result; six: Result; generations: { A: number; same: number; six: number } }

const grandPrix = (build: Build, genome: number[]): Result => {
  const r = raceCar({ name: 'experiment', build, genome })
  return { finished: r.finished, totalTime: r.totalTime }
}
function trainOnce(build: Build, seed: number, budget: number, start?: number[]) {
  const training = createTraining(build, seed, budget, start)
  let step = training.step()
  while (!step.finished) step = training.step()
  return { genome: training.winner(step.report.population), generations: training.generations }
}
const cell = (r: Result) => r.finished + '/' + RACE_COUNT + (r.finished === RACE_COUNT ? ' ' + r.totalTime.toFixed(1) + ' s ' + medalFor(r) : '')
// better = more tracks finished, or the same tracks in a lower total time
const beats = (a: Result, b: Result) => a.finished > b.finished || (a.finished === b.finished && a.totalTime < b.totalTime)

const [mode, out, extra] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const seed = Number(extra)
  const a = trainOnce(base, seed, TRAINING_BUDGET)
  const same = trainOnce(base, seed + 1000, TRAINING_BUDGET * KEEP_TRAINING_SHARE, a.genome)
  const six = trainOnce(SIX, seed + 1000, TRAINING_BUDGET * KEEP_TRAINING_SHARE, a.genome)
  const row: Row = { seed, A: grandPrix(base, a.genome), same: grandPrix(base, same.genome), six: grandPrix(SIX, six.genome), generations: { A: a.generations, same: same.generations, six: six.generations } }
  saved.push(row)
  writeFileSync(out, JSON.stringify(saved))
  console.log('seed ' + seed + ' | A ' + cell(row.A) + ' | carried on, same tracks ' + cell(row.same) + ' (' + row.generations.same + ' gens) | carried on, six tracks ' + cell(row.six) + ' (' + row.generations.six + ' gens)')
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  const fresh: { build: string; seed: number; finished: number; totalTime: number }[] = extra ? JSON.parse(readFileSync(extra, 'utf8')) : []
  for (const r of rows) {
    const f = fresh.find((x) => x.build === 'sixTracks' && x.seed === r.seed)
    console.log('seed ' + r.seed + ' | A ' + cell(r.A) + ' | on, same tracks ' + cell(r.same) + ' | on, six tracks ' + cell(r.six) + (f ? ' | six tracks from scratch ' + cell(f) : ''))
  }
  console.log(
    'Carrying on beat car A: same tracks ' + rows.filter((r) => beats(r.same, r.A)).length + ' of ' + rows.length + ', six tracks ' + rows.filter((r) => beats(r.six, r.A)).length + ' of ' + rows.length,
  )
}
