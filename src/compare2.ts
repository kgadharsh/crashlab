// Tests why the five-track brain drives slowly. Put this file in src/ and run:
//   npx tsx src/compare2.ts 5
// For each seed it trains three ways (all on the same 5 tracks, grip on):
//   A = the app's real settings (early stop at 52)
//   B = no early stop, 40 generations
//   C = no early stop, 80 generations
// and reports laps on 40 unseen tracks, average lap time, and generations run.
import { evolve, DEFAULT_SETTINGS } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { makeTrack } from './track'
import { DEFAULT_TRACK, USE_GRIP, lapSteps } from './sim'

const SEEDS = Number(process.argv[2] ?? 5)

const TEST_TRACKS = Array.from({ length: 40 }, (_, i) => makeTrack(20000 + i, 1))
const TRAIN_TRACKS = [DEFAULT_TRACK, ...Array.from({ length: 4 }, (_, i) => makeTrack(100 + i, 1))]
const base = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH, grip: USE_GRIP }

const configs = [
  { name: 'A app settings, 40 gens', settings: base, generations: 40 },
  { name: 'B no early stop, 40 gens', settings: { ...base, goodEnough: 1e9 }, generations: 40 },
  { name: 'C no early stop, 80 gens', settings: { ...base, goodEnough: 1e9 }, generations: 80 },
]

type Row = { lapped: number; lap: number; gens: number; practice: number }
const results: Row[][] = configs.map(() => [])

for (let seed = 1; seed <= SEEDS; seed++) {
  configs.forEach((c, k) => {
    let gens = 0
    const winner = evolve(genomeToBrain, makeRng(seed), c.generations, c.settings, () => gens++, TRAIN_TRACKS)
    const brain = genomeToBrain(winner.genome)
    const laps = TEST_TRACKS.map((t) => lapSteps(brain, t, USE_GRIP)).filter((s): s is number => s !== null)
    const p = lapSteps(brain, DEFAULT_TRACK, USE_GRIP)
    const row = {
      lapped: laps.length,
      lap: laps.length ? laps.reduce((s, x) => s + x, 0) / laps.length / 60 : NaN,
      gens,
      practice: p === null ? NaN : p / 60,
    }
    results[k].push(row)
    console.log(
      'seed ' + seed + ' | ' + c.name + ': ' + row.lapped + '/40 lapped, avg lap ' + row.lap.toFixed(1) +
        ' s, practice lap ' + row.practice.toFixed(1) + ' s, ' + gens + ' generations run',
    )
  })
}

const avg = (xs: number[]) => xs.filter((x) => !Number.isNaN(x)).reduce((s, x) => s + x, 0) / xs.filter((x) => !Number.isNaN(x)).length
console.log('')
configs.forEach((c, k) => {
  const r = results[k]
  console.log(
    c.name + ': average ' + avg(r.map((x) => x.lapped)).toFixed(1) + '/40 lapped, avg lap ' +
      avg(r.map((x) => x.lap)).toFixed(1) + ' s, practice lap ' + avg(r.map((x) => x.practice)).toFixed(1) +
      ' s, ' + avg(r.map((x) => x.gens)).toFixed(0) + ' generations',
  )
})