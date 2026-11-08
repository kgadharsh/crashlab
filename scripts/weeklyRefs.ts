// Trains the three reference cars that the weekly Grand Prix tester drives (scripts/weeklyPick.ts):
// one for ordinary weeks, one prepared for night (headlights) and one prepared for ice (studs). All three practise
// on dry and wet roads, so they also cope with wet weeks. They are saved in scripts/weekly-refs.json.
// Retrain whenever the simulation changes (weeklyPick refuses to run if a reference no longer finishes Grand Prix 1).
// Usage: nice npx tsx scripts/weeklyRefs.ts   (about as long as three normal trainings, with rests between them)
import { writeFileSync } from 'node:fs'
import { createTraining } from '../src/training'
import { GRAND_PRIXES, raceCar } from '../src/race'
import { DEFAULT_BUILD, type Build } from '../src/setup'
import type { CarFile } from '../src/carFile'

const REST_MS = 45_000
const BUILDS: Record<string, Build> = {
  dry: { ...DEFAULT_BUILD, weather: 'both' },
  night: { ...DEFAULT_BUILD, weather: 'both', cond: { night: true }, parts: { lights: true } },
  ice: { ...DEFAULT_BUILD, weather: 'both', cond: { ice: true }, parts: { studs: true } },
}

const refs: Record<string, CarFile> = {}
for (const [n, [name, build]] of Object.entries(BUILDS).entries()) {
  if (n > 0) await new Promise((r) => setTimeout(r, REST_MS))
  const training = createTraining(build, 1)
  let step = training.step()
  while (!step.finished) step = training.step()
  const genome = training.winner(step.report.population)
  refs[name] = { name: 'reference-' + name, build, genome, generations: training.generations }
  const gp1 = raceCar(refs[name], GRAND_PRIXES[0])
  console.log(name.padEnd(6), training.generations, 'generations | Grand Prix 1:', gp1.finished + '/8')
}
writeFileSync(new URL('./weekly-refs.json', import.meta.url), JSON.stringify(refs))
console.log('saved scripts/weekly-refs.json')
