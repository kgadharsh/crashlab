// Finds where extra training stops helping. Put this file in src/ and run:
//   npx tsx src/compare3.ts 3        (3 seeds, starting at seed 1)
//   npx tsx src/compare3.ts 3 4      (3 seeds, starting at seed 4)
// Each seed trains ONCE for 160 generations on 5 tracks (grip on). Because evolution is
// deterministic, the best brain at generation 40, 80, 120 and 160 is exactly what a run of
// that length would have produced, so one run gives all four answers (a quarter of the work).
// Between seeds it rests for 30 seconds so the laptop can cool down.
import { evolve, DEFAULT_SETTINGS } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { makeTrack } from './track'
import { DEFAULT_TRACK, USE_GRIP, lapSteps } from './sim'

const SEEDS = Number(process.argv[2] ?? 3)
const FIRST = Number(process.argv[3] ?? 1)
const SNAPSHOTS = [40, 80, 120, 160]
const REST_SECONDS = 90

const TEST_TRACKS = Array.from({ length: 40 }, (_, i) => makeTrack(20000 + i, 1))
const TRAIN_TRACKS = [DEFAULT_TRACK, ...Array.from({ length: 4 }, (_, i) => makeTrack(100 + i, 1))]
const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH, grip: USE_GRIP, goodEnough: 1e9 }

type Row = { lapped: number; lap: number; practice: number }
const results: Record<number, Row[]> = Object.fromEntries(SNAPSHOTS.map((g) => [g, []]))

function measure(genome: number[]): Row {
  const brain = genomeToBrain(genome)
  const laps = TEST_TRACKS.map((t) => lapSteps(brain, t, USE_GRIP)).filter((s): s is number => s !== null)
  const p = lapSteps(brain, DEFAULT_TRACK, USE_GRIP)
  return {
    lapped: laps.length,
    lap: laps.length ? laps.reduce((s, x) => s + x, 0) / laps.length / 60 : NaN,
    practice: p === null ? NaN : p / 60,
  }
}

function sleep(seconds: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)
}

for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
  evolve(genomeToBrain, makeRng(seed), 160, settings, (r) => {
    const g = r.generation + 1
    if (!SNAPSHOTS.includes(g)) return
    const row = measure(r.best.genome)
    results[g].push(row)
    console.log(
      'seed ' + seed + ' | ' + String(g).padStart(3) + ' generations: ' + row.lapped + '/40 lapped, avg lap ' +
        row.lap.toFixed(1) + ' s, practice lap ' + row.practice.toFixed(1) + ' s',
    )
  }, TRAIN_TRACKS)
  if (seed < FIRST + SEEDS - 1) {
    console.log('(resting ' + REST_SECONDS + ' s to cool down)')
    sleep(REST_SECONDS)
  }
}

const avg = (xs: number[]) => {
  const ok = xs.filter((x) => !Number.isNaN(x))
  return ok.reduce((s, x) => s + x, 0) / ok.length
}
console.log('')
for (const g of SNAPSHOTS) {
  const r = results[g]
  console.log(
    String(g).padStart(3) + ' generations: average ' + avg(r.map((x) => x.lapped)).toFixed(1) + '/40 lapped, avg lap ' +
      avg(r.map((x) => x.lap)).toFixed(1) + ' s, practice lap ' + avg(r.map((x) => x.practice)).toFixed(1) + ' s',
  )
}