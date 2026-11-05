// Does the car stop improving before the training budget runs out?
// Trains the default build once per seed. At every 10% of the budget it picks a car the way the app
// would if training ended there (the best 20 judged on practice tracks plus mirrored and backwards
// versions), and races that car on 20 tracks nobody practised on. Also races the practice-best car.
// Picking a car uses the run's own track randomness, so each run drifts a little from an unchecked
// one; the effect is small and the same at every budget.
// Usage: npx tsx scripts/budgetCurve.ts train <out.json> <seed>   (one seed per call: rest between calls)
//        npx tsx scripts/budgetCurve.ts report <out.json>         (no training)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { genomeToBrain } from '../src/genome'
import { runLap } from '../src/sim'
import { makeTrack } from '../src/track'
import { DEFAULT_BUILD as build, TRAINING_BUDGET, shapeOf, specOf } from '../src/setup'

const RACE = Array.from({ length: 20 }, (_, i) => makeTrack(9000 + i, 0.35 + (0.65 * (i % 4)) / 3)) // same tracks as luckDiagnose
const shape = shapeOf(build.sensors)
const spec = specOf(build)
const finishes = (g: number[]) => RACE.filter((t) => runLap(genomeToBrain(g, shape), t, spec).time !== null).length

type Row = { pct: number; generation: number; picked: number; top: number }
type Saved = { seed: number; rows: Row[] }[]

const [mode, out, seedArg] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Saved = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const seed = Number(seedArg)
  const training = createTraining(build, seed)
  const rows: Row[] = []
  let pct = 10
  let step = training.step()
  for (;;) {
    if (step.spent * 100 >= pct * TRAINING_BUDGET) {
      const picked = finishes(training.winner(step.report.population))
      const top = finishes(step.report.population[0])
      rows.push({ pct, generation: training.generations, picked, top })
      console.log('seed ' + seed + ' | ' + pct + '% | generation ' + training.generations + ' | picked ' + picked + ' | practice-best ' + top)
      pct += 10
    }
    if (step.finished) break
    step = training.step()
  }
  saved.push({ seed, rows })
  writeFileSync(out, JSON.stringify(saved))
} else if (mode === 'report') {
  const saved: Saved = JSON.parse(readFileSync(out, 'utf8'))
  console.log('unseen tracks finished, of 20 (picked car | practice-best car), seeds ' + saved.map((s) => s.seed).join(', '))
  for (let i = 0; i < 10; i++) {
    const rows = saved.map((s) => s.rows[i])
    const mean = (f: (r: Row) => number) => (rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(1)
    console.log(
      (i + 1) * 10 + '%'.padEnd(2) + ' | gen ' + mean((r) => r.generation) + ' | picked ' + rows.map((r) => r.picked).join(' ') + ' → mean ' + mean((r) => r.picked) + ' | practice-best mean ' + mean((r) => r.top),
    )
  }
}
