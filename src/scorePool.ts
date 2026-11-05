// Scores a population on several threads. Each car is scored on its own, so sharing the cars out
// between threads gives exactly the scores one thread would: only the time it takes changes.
// The thread that asks scores a share itself while the helper workers (scoreWorker.ts) score the rest.
import { byFitness, scoreOne, scorePopulation, type Drive, type Genome, type Individual, type Scorer } from './evolve'
import type { Build } from './setup'

type Stats = Omit<Individual, 'genome'> // a score without its genome: the asker already has the genome
type Pending = { resolve: (stats: Stats[]) => void; reject: (why: unknown) => void }

const GIVE_UP_MS = 30_000 // a helper that has not answered by then is not coming back

// helpers: how many extra threads to use. Returns null when helper threads cannot be made here.
export function createPoolScorer(build: Build, drive: Drive, helpers: number): { score: Scorer; close: () => void } | null {
  if (helpers < 1 || typeof Worker === 'undefined') return null
  let workers: Worker[]
  try {
    workers = Array.from({ length: helpers }, () => new Worker(new URL('./scoreWorker.ts', import.meta.url), { type: 'module' }))
  } catch {
    return null
  }
  const pending = new Map<number, Pending>()
  let nextId = 0
  let broken = false
  const fail = (why: unknown) => {
    broken = true
    pending.forEach((p) => p.reject(why))
    pending.clear()
  }
  for (const w of workers) {
    w.onmessage = (event: MessageEvent<{ id: number; stats: Stats[] }>) => {
      const p = pending.get(event.data.id)
      pending.delete(event.data.id)
      p?.resolve(event.data.stats)
    }
    w.onerror = () => fail(new Error('A scoring thread failed'))
    w.onmessageerror = () => fail(new Error('A scoring thread sent something unreadable'))
    w.postMessage({ type: 'init', build })
  }
  const close = () => workers.forEach((w) => w.terminate())

  const parts = helpers + 1 // this thread takes share 0 and the helpers the others
  const ask = (w: Worker, genomes: Genome[], tracks: unknown) =>
    new Promise<Stats[]>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      w.postMessage({ type: 'score', id, genomes, tracks })
    })

  const score: Scorer = async (genomes, tracks) => {
    if (!broken) {
      try {
        // car i goes to share i % parts, so the slow cars (the survivors at the front) are spread out
        const shares = Array.from({ length: parts }, (_, k) => genomes.filter((_, i) => i % parts === k))
        const remote = Promise.all(shares.slice(1).map((g, k) => ask(workers[k], g, tracks)))
        const mine = shares[0].map((g) => scoreOne(g, drive, tracks))
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('A scoring thread did not answer')), GIVE_UP_MS)
        })
        const others = await Promise.race([remote, late]).finally(() => clearTimeout(timer))
        const scored = genomes.map((genome, i): Individual => {
          const k = i % parts
          const j = Math.floor(i / parts)
          return k === 0 ? mine[j] : { genome, ...others[k - 1][j] }
        })
        return scored.sort(byFitness)
      } catch {
        fail(new Error('Scoring on several threads stopped')) // from here on, this thread does it all
        close()
      }
    }
    return scorePopulation(genomes, drive, tracks)
  }
  return { score, close }
}
