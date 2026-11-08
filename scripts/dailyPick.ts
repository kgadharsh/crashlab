// Picks and tests tomorrow's Daily Challenge seed, so nobody has to do it by hand (the same idea as weeklyPick.ts).
// Draws random seeds until one makes a day a reference car can race: every track must be a valid road, and the best
// reference car must finish enough of the 8. The seed is written to the file given with --out, for the workflow to store
// in the board database. Neither the seed nor the day's theme or twist is printed, because this repository's logs are public
// and the day is secret until it is over.
// Usage: npx tsx scripts/dailyPick.ts --out <file> [--day <n>]     pick and test a seed for a day (default: tomorrow, UTC)
//        npx tsx scripts/dailyPick.ts --survey <n>                  test n random seeds and print the pass rate by theme and twist
import { randomInt } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { GRAND_PRIXES, RACE_COUNT, dailyGp, dayOf, gpTrack, raceCar, type GrandPrix } from '../src/race'
import { trackProblem } from '../src/track'
import type { CarFile } from '../src/carFile'

const MIN_FINISH = 6 // the best reference car must finish this many of the 8 tracks, or the day is thrown away (the weekly's bar)
const MIN_REFERENCE = 6 // a reference that cannot finish this many of Grand Prix 1 is out of date (the simulation changed)
const MAX_TRIES = 60

const refs: Record<string, CarFile> = JSON.parse(readFileSync(new URL('./weekly-refs.json', import.meta.url), 'utf8'))
const bestFinish = (gp: GrandPrix) => Math.max(...Object.values(refs).map((car) => raceCar(car, gp).finished))
const twist = (gp: GrandPrix) => (gp.wet ? 'wet' : gp.night ? 'night' : 'ice')
const theme = (gp: GrandPrix) => gp.name.split(' day')[0]

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

if (bestFinish(GRAND_PRIXES[0]) < MIN_REFERENCE) {
  console.error('No reference car can finish ' + MIN_REFERENCE + ' of Grand Prix 1: the simulation has changed. Run scripts/weeklyRefs.ts to retrain them.')
  process.exit(2)
}

const survey = arg('--survey')
if (survey) {
  const byTwist: Record<string, { n: number; pass: number; finished: number }> = {}
  const byTheme: Record<string, { n: number; pass: number }> = {}
  for (let i = 0; i < Number(survey); i++) {
    const gp = dailyGp(30000 + i, randomSeed())
    const t = test(gp)
    const a = (byTwist[twist(gp)] ??= { n: 0, pass: 0, finished: 0 })
    const b = (byTheme[theme(gp)] ??= { n: 0, pass: 0 })
    a.n++
    b.n++
    a.finished += t.finished
    if (!t.problem) {
      a.pass++
      b.pass++
    }
  }
  for (const [k, r] of Object.entries(byTwist)) console.log(k.padEnd(18), r.pass + '/' + r.n + ' pass | best reference averaged ' + (r.finished / r.n).toFixed(1) + '/' + RACE_COUNT)
  for (const [k, r] of Object.entries(byTheme)) console.log(k.padEnd(18), r.pass + '/' + r.n + ' pass')
  process.exit(0)
}

const out = arg('--out')
if (!out) {
  console.error('Usage: dailyPick.ts --out <file> [--day <n>]   or   dailyPick.ts --survey <n>')
  process.exit(1)
}
const day = arg('--day') ? Number(arg('--day')) : dayOf(Date.now()) + 1
for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
  const seed = randomSeed()
  const gp = dailyGp(day, seed)
  const t = test(gp)
  if (t.problem) {
    console.log('try ' + attempt + ': thrown away (' + t.problem + ')') // not the theme or twist: the log is public and they would give the day away
    continue
  }
  writeFileSync(out, JSON.stringify({ day, seed }))
  console.log('Day ' + day + ': best reference finished ' + t.finished + '/' + RACE_COUNT + ' after ' + attempt + ' ' + (attempt === 1 ? 'try' : 'tries') + '. Seed saved, not shown.')
  process.exit(0)
}
console.error('No day passed in ' + MAX_TRIES + ' tries: the tester or the track generator needs a look.')
process.exit(1)
