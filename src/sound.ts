// The game's sounds, all made on the spot with the browser's audio (no files): an engine note that follows the car's
// speed, the start lights, a crash and a finished lap. One switch turns them all off, and the choice is kept.
const KEY = 'crashlab.sound'
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
})()
let ac: AudioContext | null = null
let engineOsc: OscillatorNode | null = null
let engineGain: GainNode | null = null
let engineAt = 0 // when the engine note was last asked for: it fades by itself when the race stops asking

export const soundOn = () => on
export function setSound(v: boolean) {
  on = v
  try {
    localStorage.setItem(KEY, v ? 'on' : 'off')
  } catch {
    /* storage blocked: the choice only lasts this visit */
  }
  if (!v && engineGain && ac) engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.02)
}

// A browser only lets a page make sound after the player has pressed something, so the audio starts at the first press
function audio(): AudioContext | null {
  if (!on) return null
  try {
    if (!ac) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ac = new Ctor()
    }
    if (ac.state === 'suspended') void ac.resume()
    return ac.state === 'running' ? ac : null
  } catch {
    return null
  }
}
window.addEventListener('pointerdown', () => void audio(), { passive: true })
window.addEventListener('keydown', () => void audio())

function tone(freq: number, secs: number, type: OscillatorType, volume: number, delay = 0, endFreq = freq) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + delay
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + secs)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(volume, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + secs)
  osc.connect(gain).connect(a.destination)
  osc.start(t)
  osc.stop(t + secs + 0.02)
}

export const lightOn = () => tone(440, 0.12, 'square', 0.05)
export const lightsOut = () => tone(880, 0.4, 'square', 0.06)
export const lapDone = () => {
  tone(660, 0.12, 'triangle', 0.09)
  tone(990, 0.25, 'triangle', 0.09, 0.11)
}
export function crash() {
  const a = audio()
  if (!a) return
  // a short burst of noise that falls away, with a low thump under it
  const len = Math.floor(a.sampleRate * 0.3)
  const buf = a.createBuffer(1, len, a.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
  const src = a.createBufferSource()
  src.buffer = buf
  const gain = a.createGain()
  gain.gain.value = 0.18
  src.connect(gain).connect(a.destination)
  src.start()
  tone(120, 0.25, 'sine', 0.2, 0, 45)
}

// The engine: one held note whose pitch follows the car's speed (0 to about 8 in the game's units). Called every step
// of a race that is being shown; null, or simply not calling it, lets the note die away.
export function engine(speed: number | null) {
  const a = audio()
  if (!a) return
  if (!engineOsc) {
    engineOsc = a.createOscillator()
    engineOsc.type = 'sawtooth'
    const filter = a.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 700
    engineGain = a.createGain()
    engineGain.gain.value = 0
    engineOsc.connect(filter).connect(engineGain).connect(a.destination)
    engineOsc.start()
    setInterval(() => {
      if (ac && engineGain && performance.now() - engineAt > 180) engineGain.gain.setTargetAtTime(0, ac.currentTime, 0.05)
    }, 100)
  }
  if (speed === null) {
    engineAt = 0
    engineGain!.gain.setTargetAtTime(0, a.currentTime, 0.04)
    return
  }
  engineAt = performance.now()
  engineOsc.frequency.setTargetAtTime(55 + Math.max(0, speed) * 26, a.currentTime, 0.05)
  engineGain!.gain.setTargetAtTime(0.035, a.currentTime, 0.05)
}
