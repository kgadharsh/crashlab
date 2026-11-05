// A helper thread for training: scores the cars it is sent (see scorePool.ts).
// Messages in:  { type: 'init', build }                  once, to learn which car setup is being trained
//               { type: 'score', id, genomes, tracks }   score each genome on all the tracks
// Messages out: { id, stats }                            one score per genome, in the same order
import { scoreOne, type Drive } from './evolve'
import { driverFor } from './training'

const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent) => void) | null
}

let drive: Drive | null = null

worker.onmessage = (event) => {
  const m = event.data
  if (m.type === 'init') {
    drive = driverFor(m.build)
  } else if (m.type === 'score' && drive) {
    const stats = (m.genomes as number[][]).map((genome) => {
      const { genome: _sent, ...rest } = scoreOne(genome, drive!, m.tracks)
      return rest
    })
    worker.postMessage({ id: m.id, stats })
  }
}
