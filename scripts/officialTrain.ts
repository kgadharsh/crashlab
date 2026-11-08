// The official trainer: takes setups waiting on the board server, trains each one exactly the same way (the full budget, one
// run, the same seed for everyone, no Keep training), and sends the brain back. The server races it and ranks it, so a board
// place depends on the setup alone: not on free time to retrain, and not on a lucky training.
// Run by the scheduled GitHub job .github/workflows/official.yml, or by hand:
//   JOBS_TOKEN=... npx tsx scripts/officialTrain.ts            (CRASHLAB_API to use another server, MAX_JOBS to cap a run)
import { createTraining } from '../src/training'
import { buildProblem, type Build } from '../src/setup'
import { PRACTICE_COUNT } from '../src/track'

export const OFFICIAL_SEED = 20261108 // the same for every setup, so the same setup always gives the same car
const API = process.env.CRASHLAB_API ?? 'https://crashlab-api.kgadharsh.workers.dev'
const TOKEN = process.env.JOBS_TOKEN
const MAX_JOBS = Number(process.env.MAX_JOBS ?? 8) // one run stays well under the job's time limit
const REST_MS = Number(process.env.REST_MS ?? 0) // a pause between trainings, for running on a laptop that needs to cool

if (!TOKEN) {
  console.log('No JOBS_TOKEN: nothing to do.')
  process.exit(0)
}
const auth = { Authorization: 'Bearer ' + TOKEN }

const res = await fetch(API + '/jobs/next?limit=' + MAX_JOBS, { headers: auth })
if (!res.ok) throw new Error('The server would not hand out jobs: ' + res.status + ' ' + (await res.text()))
const { jobs } = (await res.json()) as { jobs: { id: number; gp: string; name: string; build: Build }[] }
console.log(jobs.length ? jobs.length + ' setups to train' : 'No setups waiting.')

for (const [n, job] of jobs.entries()) {
  if (n > 0 && REST_MS) await new Promise((r) => setTimeout(r, REST_MS))
  const problem = buildProblem(job.build, PRACTICE_COUNT)
  const started = Date.now()
  let body: { genome?: number[]; generations?: number } = {}
  if (!problem) {
    const training = createTraining(job.build, OFFICIAL_SEED)
    let step = training.step()
    while (!step.finished) step = training.step()
    body = { genome: training.winner(step.report.population), generations: training.generations }
  } // a setup that is not allowed is sent back without a brain, and the server marks it failed
  // a connection kept open through a long training may have been dropped by the server, so sending back is retried
  let done: Response | null = null
  for (let attempt = 1; attempt <= 4 && !done; attempt++) {
    try {
      done = await fetch(API + '/jobs/' + job.id, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) })
    } catch (e) {
      console.log('job', job.id, 'send failed (' + String(e) + '), attempt', attempt)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  if (!done) {
    console.log('job', job.id, 'could not be sent back; the server hands it out again after an hour')
    continue
  }
  const out = await done.text()
  console.log('job', job.id, job.gp, JSON.stringify(job.name), Math.round((Date.now() - started) / 1000) + ' s', done.status, out.slice(0, 160))
}
