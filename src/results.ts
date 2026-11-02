// A small record of one person's session for the friend test. It stays on their device:
// nothing is sent anywhere, and they choose whether to copy and share it.
type Step = { seconds: number; crashes: number; changes: number }

const steps = new Map<string, Step>()
let current = ''
let since = performance.now()
let readScore = ''

function step(name: string): Step {
  if (!steps.has(name)) steps.set(name, { seconds: 0, crashes: 0, changes: 0 })
  return steps.get(name)!
}

function closeStep() {
  if (current) step(current).seconds += (performance.now() - since) / 1000
  since = performance.now()
}

export function enterStep(name: string) {
  if (name === current) return
  closeStep()
  current = name
  step(name)
}

export const noteCrash = () => step(current).crashes++
export const noteChange = () => step(current).changes++
export const noteReadScore = (score: number, total: number) => {
  readScore = score + ' of ' + total
}

export function resultsText(device: string): string {
  closeStep()
  const lines = ['CrashLab results', 'Device: ' + device]
  for (const [name, s] of steps) {
    const minutes = Math.floor(s.seconds / 60)
    const parts = [minutes + 'm ' + Math.round(s.seconds % 60) + 's']
    if (s.crashes) parts.push(s.crashes + (s.crashes === 1 ? ' crash' : ' crashes'))
    if (s.changes) parts.push(s.changes + (s.changes === 1 ? ' slider change' : ' slider changes'))
    lines.push(name + ': ' + parts.join(', '))
  }
  if (readScore) lines.push('Read the brain score: ' + readScore)
  return lines.join('\n')
}
