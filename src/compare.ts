// Compares evolved brains trained on ONE track vs SEVERAL tracks, with grip on.
// Put this file in src/ and run:  npx tsx src/compare.ts 10
// (the number is how many seeds to try; each seed trains both ways, so expect several minutes)
import { evolve, DEFAULT_SETTINGS } from './evolve'
import { genomeToBrain, GENOME_LENGTH } from './genome'
import { makeRng } from './random'
import { makeTrack } from './track'
import { DEFAULT_TRACK, USE_GRIP, lapSteps } from './sim'

const SEEDS = Number(process.argv[2] ?? 10)
const GENERATIONS = 40

// 40 unseen tracks for testing (seeds far from the Mission 2 set 9000-9009)
const TEST_TRACKS = Array.from({ length: 40 }, (_, i) => makeTrack(20000 + i, 1))
// training tracks for the multi-track run: the practice track plus 4 generated ones
const TRAIN_TRACKS = [DEFAULT_TRACK, ...Array.from({ length: 4 }, (_, i) => makeTrack(100 + i, 1))]

// "goodEnough" is set very high so early stopping does not cut either run short
const settings = { ...DEFAULT_SETTINGS, genomeLength: GENOME_LENGTH, grip: USE_GRIP, goodEnough: 1e9 }

function lapped(genome: number[]): number {
  const brain = genomeToBrain(genome)
  return TEST_TRACKS.filter((t) => lapSteps(brain, t, USE_GRIP) !== null).length
}

const single: number[] = []
const multi: number[] = []
for (let seed = 1; seed <= SEEDS; seed++) {
  const a = evolve(genomeToBrain, makeRng(seed), GENERATIONS, settings, undefined, [DEFAULT_TRACK])
  const b = evolve(genomeToBrain, makeRng(seed), GENERATIONS, settings, undefined, TRAIN_TRACKS)
  single.push(lapped(a.genome))
  multi.push(lapped(b.genome))
  console.log('seed ' + seed + ': one track ' + single[seed - 1] + '/40, several tracks ' + multi[seed - 1] + '/40')
}
const mean = (xs: number[]) => (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1)
console.log('average: one track ' + mean(single) + '/40, several tracks ' + mean(multi) + '/40')