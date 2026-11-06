// Are the parts real trade-offs? For each seed, trains the default build with one part at a time on the full
// budget (and, for wet tyres and grip sense, also practising on a wet road), then races every car on both
// Grand Prix. A part that wins everywhere is too strong; one that never helps is not worth unlocking.
// Usage: npx tsx scripts/partsCheck.ts train <out.json> <seed> [variant]   (one training per variant, with rests between them)
//        npx tsx scripts/partsCheck.ts report <out.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { GRAND_PRIXES, raceCar } from '../src/race'
import { DEFAULT_BUILD, type Build } from '../src/setup'

const REST_MS = 45_000
type Result = { finished: number; totalTime: number }
type Row = { seed: number; variant: string; generations: number; dry: Result; wet: Result }

const VARIANTS: Record<string, Build> = {
  none: DEFAULT_BUILD,
  eyes: { ...DEFAULT_BUILD, parts: { eyes: true } },
  brain: { ...DEFAULT_BUILD, parts: { brain: true } },
  grip: { ...DEFAULT_BUILD, parts: { grip: true } },
  'wet-none': { ...DEFAULT_BUILD, weather: 'wet' },
  'wet-tyres': { ...DEFAULT_BUILD, weather: 'wet', parts: { tyres: true } },
  'wet-grip': { ...DEFAULT_BUILD, weather: 'wet', parts: { grip: true } },
}

const result = (build: Build, genome: number[], gp: number): Result => {
  const r = raceCar({ name: 'check', build, genome }, GRAND_PRIXES[gp])
  return { finished: r.finished, totalTime: r.totalTime }
}
const cell = (r: Result) => r.finished + '/8' + (r.finished === 8 ? ' ' + r.totalTime.toFixed(0) + 's' : '')

const [mode, out, seedArg, only] = process.argv.slice(2)
if (mode === 'train') {
  const seed = Number(seedArg)
  const names = Object.keys(VARIANTS).filter((v) => !only || v === only)
  for (const [n, variant] of names.entries()) {
    if (n > 0) await new Promise((r) => setTimeout(r, REST_MS))
    const build = VARIANTS[variant]
    const training = createTraining(build, seed)
    let step = training.step()
    while (!step.finished) step = training.step()
    const genome = training.winner(step.report.population)
    const row: Row = { seed, variant, generations: training.generations, dry: result(build, genome, 0), wet: result(build, genome, 1) }
    const saved: Row[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
    saved.push(row)
    writeFileSync(out, JSON.stringify(saved, null, 1))
    console.log(seed, variant.padEnd(10), String(row.generations).padStart(4), 'gens | GP1', cell(row.dry).padEnd(10), '| GP2 wet', cell(row.wet))
  }
} else if (mode === 'report') {
  const rows: Row[] = JSON.parse(readFileSync(out, 'utf8'))
  for (const variant of Object.keys(VARIANTS)) {
    const mine = rows.filter((r) => r.variant === variant)
    if (!mine.length) continue
    const avg = (f: (r: Row) => number) => (mine.reduce((s, r) => s + f(r), 0) / mine.length).toFixed(1)
    console.log(
      variant.padEnd(10), mine.length + ' seeds |', avg((r) => r.generations), 'gens | GP1 finished', avg((r) => r.dry.finished), 'all-8 in', mine.filter((r) => r.dry.finished === 8).length,
      '| GP2 wet finished', avg((r) => r.wet.finished), 'all-8 in', mine.filter((r) => r.wet.finished === 8).length,
      '|', mine.map((r) => cell(r.dry) + ' / ' + cell(r.wet)).join(', '),
    )
  }
}
