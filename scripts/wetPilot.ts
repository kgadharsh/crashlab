// Pilot: how much does a wet road hurt a car trained on dry roads? Trains one default car, then
// races it on the Grand Prix tracks with different amounts of grip (1 is dry, lower is wetter).
// Usage: npx tsx scripts/wetPilot.ts <seed>
import { createTraining } from '../src/training'
import { genomeToBrain } from '../src/genome'
import { RACE_COUNT, raceOne, raceTrack, summarise } from '../src/race'
import { wetTrack } from '../src/track'
import { DEFAULT_BUILD as build, shapeOf, specOf } from '../src/setup'

const seed = Number(process.argv[2] ?? 21)
const training = createTraining(build, seed)
let step = training.step()
while (!step.finished) step = training.step()
const brain = genomeToBrain(training.winner(step.report.population), shapeOf(build.sensors))
const spec = specOf(build)
console.log('seed ' + seed + ': trained on dry roads for ' + training.generations + ' generations')
for (const grip of [1, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5]) {
  const results = Array.from({ length: RACE_COUNT }, (_, i) => raceOne(brain, grip === 1 ? raceTrack(i) : wetTrack(raceTrack(i), grip), spec))
  const s = summarise(results)
  console.log('grip x' + grip + ' | ' + s.finished + '/' + RACE_COUNT + (s.finished === RACE_COUNT ? ' in ' + s.totalTime.toFixed(1) + ' s' : '') + ' | failures: ' + results.map((r, i) => (r.time === null ? i + ':' + r.cause : '')).filter(Boolean).join(', '))
}
