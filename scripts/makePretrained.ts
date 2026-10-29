import { writeFileSync } from 'node:fs'
import { createEvolution, DEFAULT_SETTINGS } from '../src/evolve'
import { genomeToBrain, GENOME_LENGTH } from '../src/genome'
import { makeRng } from '../src/random'
import { USE_GRIP, DEFAULT_TRACK, lapSteps } from '../src/sim'
import { makeTrack } from '../src/track'
import { PRETRAINED_GENOME } from '../src/pretrained'

const SEEDS = Number(process.argv[2] ?? 8)
const GENERATIONS = 80

// Same five training tracks as trainWorker.ts
const TRAIN_TRACKS = [DEFAULT_TRACK, ...Array.from({ length: 4 }, (_, i) => makeTrack(100 + i, 1))]
// 40 tracks used to PICK the winner (not the same as the in-app hidden test)
const SELECT_TRACKS = Array.from({ length: 40 }, (_, i) => makeTrack(8000 + i, 1))
// The in-app hidden test (seeds 7000-7019), used only to report the final result honestly
const CHECK_TRACKS = Array.from({ length: 20 }, (_, i) => makeTrack(7000 + i, 1))

type Score = { laps: number; avgLap: number | null; practice: number | null }

function score(genome: number[], tracks: typeof SELECT_TRACKS): Score {
  const brain = genomeToBrain(genome)
  const laps = tracks.map((t) => lapSteps(brain, t, USE_GRIP)).filter((l): l is number => l !== null)
  const practice = lapSteps(brain, DEFAULT_TRACK, USE_GRIP)
  return {
    laps: laps.length,
    avgLap: laps.length ? laps.reduce((a, b) => a + b, 0) / laps.length / 60 : null,
    practice: practice === null ? null : practice / 60,
  }
}

// more tracks lapped wins; faster average lap breaks ties; must lap the practice track
function better(a: Score, b: Score): boolean {
  if (a.practice === null) return false
  if (b.practice === null) return true
  if (a.laps !== b.laps) return a.laps > b.laps
  return (a.avgLap ?? Infinity) < (b.avgLap ?? Infinity)
}

const fmt = (s: Score) =>
  s.laps + ' laps, avg ' + (s.avgLap?.toFixed(2) ?? '-') + ' s, practice ' + (s.practice?.toFixed(2) ?? 'FAIL') + ' s'

function trainOne(seed: number): number[] {
  const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH, grip: USE_GRIP }
  const evolution = createEvolution(genomeToBrain, makeRng(seed), GENERATIONS, settings, TRAIN_TRACKS)
  for (;;) {
    const { report, finished } = evolution.step()
    if ((report.generation + 1) % 10 === 0) {
      console.log('   gen ' + (report.generation + 1) + ': best ' + report.best.fitness.toFixed(1))
    }
    if (finished) return report.best.genome.map((v) => Math.round(v * 10000) / 10000) // same rounding as the file
  }
}

const oldScore = score(PRETRAINED_GENOME, SELECT_TRACKS)
console.log('Current pretrained brain: ' + fmt(oldScore))

let winner: { seed: number; genome: number[]; score: Score } | null = null
const t0 = Date.now()
for (let seed = 1; seed <= SEEDS; seed++) {
  const t = Date.now()
  console.log('Seed ' + seed + ' of ' + SEEDS + '...')
  const genome = trainOne(seed)
  const s = score(genome, SELECT_TRACKS)
  console.log('  -> ' + fmt(s) + '  (' + ((Date.now() - t) / 1000).toFixed(0) + ' s)')
  if (!winner || better(s, winner.score)) winner = { seed, genome, score: s }
}

if (!winner) throw new Error('no seeds were run')
console.log('\nBest new brain: seed ' + winner.seed + ', ' + fmt(winner.score))
console.log('Total time: ' + ((Date.now() - t0) / 60000).toFixed(1) + ' min')

if (!better(winner.score, oldScore)) {
  console.log('The current pretrained brain is as good or better. pretrained.ts NOT changed.')
} else {
  const check = score(winner.genome, CHECK_TRACKS)
  console.log('On the in-app hidden test (20 tracks): ' + fmt(check))
  const text =
    '// A ready-made brain, evolved ahead of time on 5 tracks for up to 80 generations\n' +
    '// (seed ' + winner.seed + ', best of ' + SEEDS + ' seeds: ' + winner.score.laps + ' of 40 unseen tracks lapped,\n' +
    '// practice lap ' + winner.score.practice!.toFixed(1) + ' s). Used as a fallback if training is slow or fails.\n' +
    '// Regenerate with: npx tsx scripts/makePretrained.ts\n' +
    'export const PRETRAINED_GENOME: number[] = ' + JSON.stringify(winner.genome) + '\n'
  writeFileSync(new URL('../src/pretrained.ts', import.meta.url), text)
  console.log('Wrote src/pretrained.ts')
}