// Is wet weather a real decision? For each seed, trains the default build three ways on the full
// budget: practising on dry roads, on wet roads, and on both (two tracks per generation, so fewer
// generations). Each car is then raced on the Grand Prix twice, on a dry road and on a wet one.
// Usage: npx tsx scripts/wetCheck.ts train <out.json> <seed> [dry|wet|both]   (three trainings per call, with rests between them; name one to train only that)
//        npx tsx scripts/wetCheck.ts report <out.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { genomeToBrain } from '../src/genome'
import { RACE_COUNT, raceOne, raceTrack, summarise } from '../src/race'
import { wetTrack } from '../src/track'
import { DEFAULT_BUILD as base, shapeOf, specOf, type Build, type Weather } from '../src/setup'

const REST_MS = 45_000
const WEATHERS: Weather[] = ['dry', 'wet', 'both']
type Result = { finished: number; totalTime: number }
type Row = { seed: number; weather: Weather; generations: number; dry: Result; wet: Result }

function grandPrix(build: Build, genome: number[], wet: boolean): Result {
  const brain = genomeToBrain(genome, shapeOf(build.sensors))
  const spec = specOf(build)
  const s = summarise(Array.from({ length: RACE_COUNT }, (_, i) => raceOne(brain, wet ? wetTrack(raceTrack(i)) : raceTrack(i), spec)))
  return { finished: s.finished, totalTime: s.totalTime }
}
const cell = (r: Result) => r.finished + '/' + RACE_COUNT + (r.finished === RACE_COUNT ? ' ' + r.totalTime.toFixed(0) + ' s' : '')

const [mode, out, seedArg, only] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  const seed = Number(seedArg)
  for (const [n, weather] of WEATHERS.filter((w) => !only || w === only).entries()) {
    if (n > 0) await new Promise((r) => setTimeout(r, REST_MS))
    const build: Build = { ...base, ...(weather === 'dry' ? {} : { weather }) }
    const training = createTraining(build, seed)
    let step = training.step()
    while (!step.finished) step = training.step()
    const genome = training.winner(step.report.population)
    const row: Row = { seed, weather, generations: training.generations, dry: grandPrix(build, genome, false), wet: grandPrix(build, genome, true) }
    saved.push(row)
    writeFileSync(out, JSON.stringify(saved))
    console.log('seed ' + seed + ' | practised ' + weather.padEnd(4) + ' | ' + row.generations + ' generations | dry GP ' + cell(row.dry) + ' | wet GP ' + cell(row.wet))
  }
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  console.log('Seeds: ' + [...new Set(rows.map((r) => r.seed))].join(', '))
  for (const w of WEATHERS) {
    const mine = rows.filter((r) => r.weather === w)
    const mean = (f: (r: Row) => number) => (mine.reduce((a, r) => a + f(r), 0) / Math.max(mine.length, 1)).toFixed(1)
    console.log(
      'practised ' + w.padEnd(4) + ' | gens ' + mean((r) => r.generations) + ' | dry GP: ' + mine.map((r) => cell(r.dry)).join(', ') + ' (mean finished ' + mean((r) => r.dry.finished) + ') | wet GP: ' + mine.map((r) => cell(r.wet)).join(', ') + ' (mean finished ' + mean((r) => r.wet.finished) + ')',
    )
  }
}
