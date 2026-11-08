// Is each chassis a side-grade? Trains the default build in each frame (and the Classic frame) on the full budget, then races
// every car on three sets of dry tracks. A frame that beats Classic on finishes and time in every seed is too strong; one that
// loses everywhere is not worth choosing. Seeds are few and training is lucky, so read the report as a first look only.
// Usage: npx tsx scripts/chassisCheck.ts train <out.json> <seed> [variant[,variant...]]   (rests of 45 s between trainings)
//        npx tsx scripts/chassisCheck.ts report <out.json>
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { GRAND_PRIXES, raceCar, weeklyGp, type GrandPrix } from '../src/race'
import { DEFAULT_BUILD, type Build } from '../src/setup'

const REST_MS = 45_000
type Result = { finished: number; totalTime: number }
type Row = { seed: number; variant: string; generations: number; results: Result[] }

// three sets of dry tracks, so each trained car is raced 24 times: Grand Prix 1 and two fixed weekly sets
const RACES: GrandPrix[] = [GRAND_PRIXES[0], { ...weeklyGp(3000, 424242), id: 'check-a', night: undefined, ice: undefined, wet: false }, { ...weeklyGp(3001, 777), id: 'check-b', night: undefined, ice: undefined, wet: false }]
const RACE_NAMES = ['gp1', 'weekA', 'weekB']

const VARIANTS: Record<string, Build> = {
  classic: DEFAULT_BUILD,
  sprinter: { ...DEFAULT_BUILD, chassis: 'sprinter' },
  tourer: { ...DEFAULT_BUILD, chassis: 'tourer' },
  dancer: { ...DEFAULT_BUILD, chassis: 'dancer' },
  scout: { ...DEFAULT_BUILD, chassis: 'scout' },
  drifter: { ...DEFAULT_BUILD, chassis: 'drifter' },
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
    // pooled over all three sets: tracks finished out of 24, and the average total time of the sets finished in full
    const all = mine.flatMap((r) => r.results)
    const full = all.filter((r) => r.finished === 8)
    console.log(''.padEnd(12), 'pooled:', (all.reduce((t, r) => t + r.finished, 0) / all.length).toFixed(2) + '/8 finished,', full.length + ' of ' + all.length + ' races clean, mean time of clean races ' + (full.length ? (full.reduce((t, r) => t + r.totalTime, 0) / full.length).toFixed(1) + 's' : 'n/a'))
  }
}
