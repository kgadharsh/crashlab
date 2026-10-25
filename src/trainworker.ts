// Runs the training in the background so the page stays smooth.
// It receives { seed, generations } and sends back one message per generation,
// then a final message with the winning genome.
import { trainWithHistory } from './train'

type Job = { seed: number; generations: number }
const worker = self as unknown as {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<Job>) => void) | null
}

worker.onmessage = (event) => {
  const { seed, generations } = event.data
  const { winner } = trainWithHistory(seed, generations, undefined, true, (generation, point, best) => {
    worker.postMessage({
      type: 'progress',
      generation,
      best: point.best,
      mean: point.mean,
      checkpoints: best.checkpoints,
    })
  })
  worker.postMessage({ type: 'done', genome: winner.genome, checkpoints: winner.checkpoints })
}