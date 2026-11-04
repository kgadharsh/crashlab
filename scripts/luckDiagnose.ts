// Where does training luck come from, and does a better final pick fix it?
// Trains the default build, saves the last generation's 20 finalists, and compares ways of
// picking one of them by how many of 20 unseen race tracks the picked car finishes:
//   app:      the app's pick (practice tracks, 3 block layouts)
//   variants: practice tracks plus their mirrored and backwards versions
// Usage: npx tsx scripts/luckDiagnose.ts train <out.json> <seed> [<seed> ...]   (rests between seeds)
//        npx tsx scripts/luckDiagnose.ts judge <out.json>                       (no training)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createTraining } from '../src/training'
import { scorePopulation, type Drive } from '../src/evolve'
import { genomeToBrain } from '../src/genome'
import { makeRng } from '../src/random'
import { runBrain, runLap, type Track } from '../src/sim'
import { makeTrack, moveBlocks, practiceTrack, trackVariants } from '../src/track'
import { DEFAULT_BUILD as build, shapeOf, specOf } from '../src/setup'

const RACE = Array.from({ length: 20 }, (_, i) => makeTrack(9000 + i, 0.35 + (0.65 * (i % 4)) / 3))
const REST_MS = 45_000
const shape = shapeOf(build.sensors)
const spec = specOf(build)
const drive: Drive = (g, t) => runBrain(genomeToBrain(g, shape), t, spec, build.reward)
const layouts = (tracks: Track[], n: number, seed: number) => {
  const rng = makeRng(seed)
  return Array.from({ length: n }, () => tracks.map((t) => moveBlocks(t, rng))).flat()
}
const practice = build.practice.map(practiceTrack)
const withVariants = practice.flatMap((t) => [t, ...trackVariants(t)])
const raceFinishes = (g: number[]) => RACE.filter((t) => runLap(genomeToBrain(g, shape), t, spec).time !== null).length
type Saved = { seed: number; finalists: number[][]; appPick: number }[]

const [mode, out, ...rest] = process.argv.slice(2)
if (mode === 'train') {
  const saved: Saved = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []
  for (const [n, seed] of rest.map(Number).entries()) {
    if (n > 0) await new Promise((r) => setTimeout(r, REST_MS))
    const training = createTraining(build, seed)
    let step = training.step()
    while (!step.finished) step = training.step()
    const finalists = step.report.population.slice(0, 20)
    saved.push({ seed, finalists, appPick: finalists.indexOf(training.winner(step.report.population)) })
    writeFileSync(out, JSON.stringify(saved))
    console.log('seed ' + seed + ' trained: ' + training.generations + ' generations')
  }
} else if (mode === 'judge') {
  const saved: Saved = JSON.parse(readFileSync(out, 'utf8'))
  const totals = { app: 0, variants: 0, best: 0 }
  for (const { seed, finalists, appPick } of saved) {
    const race = finalists.map(raceFinishes)
    const pick = (tracks: Track[]) => finalists.indexOf(scorePopulation(finalists, drive, layouts(tracks, 2, seed + 99))[0].genome)
    const v = pick(withVariants)
    totals.app += race[appPick]
    totals.variants += race[v]
    totals.best += Math.max(...race)
    console.log('seed ' + seed + ' | finalists ' + race.join(' ') + ' | app pick ' + race[appPick] + ' | variants pick ' + race[v] + ' | best ' + Math.max(...race))
  }
  console.log('total over ' + saved.length + ' seeds | app ' + totals.app + ' | variants ' + totals.variants + ' | best possible ' + totals.best)
}
