// Does a smaller training budget cost race-day medals? budgetCurve.ts counted finished tracks, which
// hit its ceiling of 20; race day also scores time (gold needs all tracks in under GOLD_TIME).
// Trains the default build once per seed. At each checkpoint it picks a car the way the app would if
// training ended there, and races it on the Grand Prix tracks with the real race-day scoring.
// Picking a car uses the run's own track randomness, so each run drifts a little from an unchecked
// one; the effect is small and the same at every budget.
// Usage: npx tsx scripts/budgetMedals.ts train <out.json> <seed>   (one seed per call: rest between calls)
//        npx tsx scripts/budgetMedals.ts report <out.json>         (no training)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { RACE_COUNT, medalFor, raceCar, type Medal } from '../src/race'
import { DEFAULT_BUILD as build, TRAINING_BUDGET } from '../src/setup'

const CHECKPOINTS = [40, 50, 60, 80, 100] // percent of the budget spent

type Row = { pct: number; generation: number; finished: number; totalTime: number; medal: Medal }
type Saved = { seed: number; rows: Row[] }[]
const letter = (m: Medal) => (m === 'gold' ? 'G' : m === 'silver' ? 'S' : m === 'bronze' ? 'B' : '-')
const cell = (r: Row) => r.finished + '/' + RACE_COUNT + (r.finished === RACE_COUNT ? ' ' + r.totalTime.toFixed(0) + 's' : '') + ' ' + letter(r.medal)

const [mode, out, seedArg] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Saved = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const seed = Number(seedArg)
  const training = createTraining(build, seed)
  const rows: Row[] = []
  let next = 0
  let step = training.step()
  for (;;) {
    if (next < CHECKPOINTS.length && step.spent * 100 >= CHECKPOINTS[next] * TRAINING_BUDGET) {
      const genome = training.winner(step.report.population)
      const result = raceCar({ name: 'budget test', build, genome })
      const row = { pct: CHECKPOINTS[next], generation: training.generations, finished: result.finished, totalTime: result.totalTime, medal: medalFor(result) }
      rows.push(row)
      console.log('seed ' + seed + ' | ' + row.pct + '% | generation ' + row.generation + ' | ' + cell(row))
      next++
    }
    if (step.finished) break
    step = training.step()
  }
  saved.push({ seed, rows })
  writeFileSync(out, JSON.stringify(saved))
} else if (mode === 'report') {
  const saved: Saved = JSON.parse(readFileSync(out, 'utf8'))
  console.log('Grand Prix result of the picked car (tracks finished, total time if all finished, medal G/S/B), seeds ' + saved.map((s) => s.seed).join(', '))
  CHECKPOINTS.forEach((pct, i) => {
    const rows = saved.map((s) => s.rows[i])
    const count = (f: (r: Row) => boolean) => rows.filter(f).length
    console.log(
      String(pct).padStart(3) + '% | ' + rows.map(cell).join(' | ') +
        ' | all ' + RACE_COUNT + ': ' + count((r) => r.finished === RACE_COUNT) + '/' + rows.length +
        ' | gold: ' + count((r) => r.medal === 'gold') + '/' + rows.length,
    )
  })
}
