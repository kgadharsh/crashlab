import type { Brain } from './brain'

export function cloneBrain(b: Brain): Brain {
  return { w1: b.w1.map((r) => [...r]), b1: [...b.b1], w2: b.w2.map((r) => [...r]), b2: [...b.b2] }
}

// A blinded input always reads 1 ("nothing there"). That is the same as removing its
// weights and adding them to the biases, so the simulator needs no special case.
export function blindBrain(b: Brain, blinded: boolean[]): Brain {
  const out = cloneBrain(b)
  blinded.forEach((off, i) => {
    if (!off) return
    out.w1.forEach((row, h) => {
      out.b1[h] += row[i]
      row[i] = 0
    })
  })
  return out
}
