// Picks and tests next week's Grand Prix seed, so nobody has to do it by hand.
// Draws random seeds until one makes a week a reference car can race (see weeklyRefs.ts), then writes the seed to
// the file given with --out, for the workflow to store in the board database. The seed is secret until the week is
// over, so it is never printed: the log only says how the week looks and how the reference car did.
// Usage: npx tsx scripts/weeklyPick.ts --out <file> [--week <n>]     pick and test a seed for a week (default: next week)
//        npx tsx scripts/weeklyPick.ts --survey <n>                   test n random seeds and print the pass rate (local calibration)
import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { GRAND_PRIXES, RACE_COUNT, gpTrack, raceCar, weekName, weekOf, weeklyGp, type GrandPrix } from '../src/race'
import { trackProblem } from '../src/track'
import type { CarFile } from '../src/carFile'

const MIN_FINISH = 6 // the best reference car must finish this many of the 8 tracks, or the week is thrown away
const MIN_REFERENCE = 6 // a reference that cannot finish this many of Grand Prix 1 is out of date (the simulation changed)
const MAX_TRIES = 40

const refs: Record<string, CarFile> = JSON.parse(readFileSync(new URL('./weekly-refs.json', import.meta.url), 'utf8'))
// A week counts as raceable if the best of the reference cars can finish enough of it (training luck varies, so no single car is the yardstick)
const bestFinish = (gp: GrandPrix) => Math.max(...Object.values(refs).map((car) => raceCar(car, gp).finished))
const describe = (gp: GrandPrix) => [gp.wet ? 'wet' : 'dry', gp.night ? 'night' : gp.ice ? 'ice' : 'normal'].join(' ')

// Why a week is not fit to race, or null if it is: broken tracks, or a reference car that cannot finish enough of them
function test(gp: GrandPrix): { problem: string | null; finished: number } {
  for (let i = 0; i < RACE_COUNT; i++) {
    const problem = trackProblem(gpTrack(gp, i))
    if (problem) return { problem: 'track ' + (i + 1) + ': ' + problem, finished: 0 }
  }
  const finished = bestFinish(gp)
  return { problem: finished < MIN_FINISH ? 'best reference finished only ' + finished + '/' + RACE_COUNT : null, finished }
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i < 0 ? undefined : process.argv[i + 1]
}
const randomSeed = () => randomInt(0, 2 ** 32)

// If even the best reference cannot finish the fixed Grand Prix, the references are stale, which would make every week look bad
if (bestFinish(GRAND_PRIXES[0]) < MIN_REFERENCE) {
  console.error('No reference car can finish ' + MIN_REFERENCE + ' of Grand Prix 1: the simulation has changed. Run scripts/weeklyRefs.ts to retrain them.')
  process.exit(2)
}

const survey = arg('--survey')
if (survey) {
  const tally: Record<string, { n: number; pass: number; finished: number }> = {}
  for (let i = 0; i < Number(survey); i++) {
    const gp = weeklyGp(3000 + i, randomSeed())
    const t = test(gp)
    const row = (tally[describe(gp)] ??= { n: 0, pass: 0, finished: 0 })
    row.n++
    row.finished += t.finished
    if (!t.problem) row.pass++
  }
  for (const [k, r] of Object.entries(tally)) console.log(k.padEnd(12), r.pass + '/' + r.n + ' pass | best reference averaged ' + (r.finished / r.n).toFixed(1) + '/' + RACE_COUNT)
  process.exit(0)
}

const out = arg('--out')
if (!out) {
  console.error('Usage: weeklyPick.ts --out <file> [--week <n>]   or   weeklyPick.ts --survey <n>')
  process.exit(1)
}
const week = arg('--week') ? Number(arg('--week')) : weekOf(Date.now()) + 1
for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
  const seed = randomSeed()
  const gp = weeklyGp(week, seed)
  const t = test(gp)
  if (t.problem) {
    console.log('try ' + attempt + ': thrown away (' + describe(gp) + ', ' + t.problem + ')')
    continue
  }
  writeFileSync(out, JSON.stringify({ week, seed }))
  console.log(weekName(week) + ' (week ' + week + '): ' + describe(gp) + ', best reference finished ' + t.finished + '/' + RACE_COUNT + ' after ' + attempt + ' ' + (attempt === 1 ? 'try' : 'tries') + '. Seed saved, not shown.')
  process.exit(0)
}
console.error('No week passed in ' + MAX_TRIES + ' tries: the tester or the track generator needs a look.')
process.exit(1)
