import './app.css'
import type { Point } from './sensors'
import { starterBrain, think, type Brain } from './brain'
import type { History } from './train'
import { genomeToBrain, brainToGenome } from './genome'
import { brainToJson, brainFromJson } from './brainFile'
import { PRETRAINED_GENOME } from './pretrained'
import { prepareHiddenTracks, testOnHiddenTracks, hiddenVerdict, HIDDEN_COUNT, type BrainOrigin } from './hidden'
import { drawNetwork, hitTest, hiddenName, sameEdge, INPUT_LABELS, OUTPUT_LABELS, type Edge, type Selection } from './netview'
import { blindBrain, cloneBrain } from './editor'
import { findMoment, runNeuronLab, NEURON } from './neuronMission'
import { pickRounds, runReadGame } from './readBrain'
import { enterStep, noteChange, noteCrash, noteReadScore, resultsText } from './results'
import { traceNeuron, type HeatPoint } from './roadMap'
import {
  type Car,
  type Input,
  createCar,
  step,
  getInputs,
  checkpointPos,
  CHECKPOINTS,
  RAY_ANGLES,
  DEFAULT_TRACK,
  runBrain,
  lapSteps,
  predictPath,
  USE_GRIP,
  STALL_STEPS,
} from './sim'
import { makeTrack, BLOCK_HALF } from './track'
import { C } from './theme'

// The page has three columns (see index.html and app.css)
const rail = document.getElementById('rail')!
const stage = document.getElementById('stage')!
const instrument = document.getElementById('instrument')!

// The four missions, shown in the top bar
const STEP_NAMES = ['Drive', 'Neuron', 'Weights', 'Evolve']
const stepList = document.getElementById('steps')!
stepList.innerHTML = STEP_NAMES.map((name, i) => '<li><b>' + (i + 1) + '</b><span>' + name + '</span></li>').join('')

// ---------- MISSION BAR ----------
const missionBar = document.createElement('div')
missionBar.className = 'panel mission'
rail.appendChild(missionBar)
type MissionStage = 'm1' | 'm1done' | 'neuron' | 'neurondone' | 'read' | 'readdone' | 'detect' | 'detectdone' | 'm2' | 'm2done' | 'm3' | 'm3done'
let missionStage: MissionStage = 'm1'
let lastMissionHtml = ''
function setMissionHtml(html: string) {
  if (html === lastMissionHtml) return
  lastMissionHtml = html
  missionBar.innerHTML = html
}

const canvas = document.createElement('canvas')
canvas.width = 800
canvas.height = 500
canvas.className = 'track'
stage.appendChild(canvas)
const ctx = canvas.getContext('2d')!

const netCanvas = document.createElement('canvas')
netCanvas.width = 420
netCanvas.height = 500
instrument.appendChild(netCanvas)
const netCtx = netCanvas.getContext('2d')!
const editor = document.createElement('div')
editor.className = 'panel editor'
editor.style.display = 'none'
instrument.appendChild(editor)

// ---------- CLICKING THE NETWORK ----------
let selection: Selection = null
let dragStart: { y: number; edge: Edge; value: number } | null = null
let dragged = false
let shownBrain: Brain | null = null // the brain drawn in the panel right now
function panelPoint(e: MouseEvent) {
  const box = netCanvas.getBoundingClientRect()
  return { x: ((e.clientX - box.left) / box.width) * netCanvas.width, y: ((e.clientY - box.top) / box.height) * netCanvas.height }
}
netCanvas.addEventListener('click', (e) => {
  if (!shownBrain || swarm) return
  if (dragged) {
    dragged = false
    return
  }
  const { x, y } = panelPoint(e)
  select(hitTest(shownBrain, x, y, editableEdges()))
})
netCanvas.addEventListener('pointermove', (e) => {
  if (!shownBrain) return
  const { x, y } = panelPoint(e)
  netCanvas.style.cursor = hitTest(shownBrain, x, y, editableEdges()) ? 'pointer' : 'default'
  if (!dragStart) return
  dragged = true
  setEdge(dragStart.edge, Math.max(-4, Math.min(4, dragStart.value + (dragStart.y - y) * 0.03)))
  renderEditor()
})
// With a mouse, dragging up or down on a connection changes its weight
netCanvas.addEventListener('pointerdown', (e) => {
  if (!shownBrain || swarm || e.pointerType !== 'mouse') return
  const { x, y } = panelPoint(e)
  const hit = hitTest(shownBrain, x, y, editableEdges())
  if (hit?.kind === 'edge' && canEditEdge(hit)) {
    select(hit)
    dragStart = { y, edge: hit, value: edgeWeight(hit) }
  }
})
window.addEventListener('pointerup', () => {
  dragStart = null
})

// Clicking a ray on the track selects its input in the network
canvas.addEventListener('click', (e) => {
  if (swarm || missionStage === 'neuron' || missionStage === 'read') return
  const box = canvas.getBoundingClientRect()
  const x = ((e.clientX - box.left) / box.width) * canvas.width
  const y = ((e.clientY - box.top) / box.height) * canvas.height
  let bestRay = -1
  let bestDist = 10
  car.rays.forEach((d, i) => {
    const a = car.angle + RAY_ANGLES[i]
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const along = Math.max(0, Math.min(d, (x - car.x) * dx + (y - car.y) * dy))
    const gap = Math.hypot(x - car.x - dx * along, y - car.y - dy * along)
    if (gap < bestDist) {
      bestDist = gap
      bestRay = i
    }
  })
  if (bestRay >= 0) select({ kind: 'node', layer: 'input', index: bestRay })
})

// ---------- PAUSE AND STEP ----------
let paused = false
let stepRequested = false
const pauseRow = document.createElement('div')
pauseRow.className = 'pause'
instrument.appendChild(pauseRow)
function pauseControl(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', () => {
    b.blur() // so the arrow keys keep controlling the car
    onClick()
  })
  pauseRow.appendChild(b)
  return b
}
function setPaused(p: boolean) {
  paused = p
  pauseButton.textContent = p ? 'Resume' : 'Pause'
  stepButton.disabled = !p
}
const pauseButton = pauseControl('Pause', () => setPaused(!paused))
const stepButton = pauseControl('Step', () => {
  stepRequested = true
})
stepButton.disabled = true

// ---------- GAME STATE (the simulation itself lives in sim.ts) ----------
const track = DEFAULT_TRACK // the road being driven and drawn
const KERB_BEND = 0.075 // bends sharper than this per point get striped kerbs
const { leftWall, rightWall } = track
let car: Car = createCar(undefined, USE_GRIP)
let crashes = 0
let frame = 0
let beforeEdits: ReturnType<typeof predictPath> | null = null // the same moment without the player's changes
let predicted: ReturnType<typeof predictPath> | null = null // where the brain would take the car
let lastCrash: { x: number; y: number; frames: number } | null = null // fades out after a crash
let best = 0

let brain: Brain = starterBrain()
let brainOn = false
let workingBrain: Brain = brain // the brain with the player's edits, before any blinding
let originalBrain: Brain = brain // what Undo goes back to
let edited = false
const blinded = [false, false, false, false, false, false]

function brainInput(): Input {
  const { outputs } = think(brain, getInputs(car))
  return { steer: outputs[0], throttle: outputs[1] }
}

// ---------- RECORDING AND REPLAY ----------
let recording: Input[] = []
let mode: 'live' | 'replay' = 'live'
let replayIndex = 0
let savedEnd = { x: 0, y: 0, angle: 0, speed: 0, crashes: 0, passed: 0, best: 0 }
let message = ''

let showCheckpoints = false // press C to show the invisible checkpoints the score is built on
let debug = false // press D for the developer readouts and keys (B, R, Enter, C)
const keys: Record<string, boolean> = {}
window.addEventListener('keydown', (e) => {
  keys[e.key] = true
  if (e.key.startsWith('Arrow')) e.preventDefault()
  if (e.key === ' ' && missionStage !== 'neuron' && missionStage !== 'read') {
    e.preventDefault()
    setPaused(!paused)
  }
  if (e.key === 'd' || e.key === 'D') debug = !debug
  if (!debug) return
  if (e.key === 'r' || e.key === 'R') startReplay()
  if (e.key === 'Enter') startFreshRecording()
  if (e.key === 'b' || e.key === 'B') brainOn = !brainOn
  if (e.key === 'c' || e.key === 'C') showCheckpoints = !showCheckpoints
})
window.addEventListener('keyup', (e) => {
  keys[e.key] = false
})

function readKeys(): Input {
  return {
    throttle: (keys['ArrowUp'] ? 1 : 0) - (keys['ArrowDown'] ? 1 : 0),
    steer: (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0),
  }
}

// ---------- TOUCH CONTROLS (shown only on touch screens) ----------
const touchScreen =
  window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0
const pad = document.createElement('div')
pad.className = touchScreen ? 'pad on' : 'pad'
function padButton(label: string, key: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  const press = (down: boolean) => {
    keys[key] = down
    b.classList.toggle('down', down)
  }
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    b.setPointerCapture(e.pointerId)
    press(true)
  })
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => press(false))
  b.addEventListener('contextmenu', (e) => e.preventDefault())
  return b
}
const steerSide = document.createElement('div')
steerSide.append(padButton('◀', 'ArrowLeft'), padButton('▶', 'ArrowRight'))
const pedalSide = document.createElement('div')
pedalSide.append(padButton('Brake', 'ArrowDown'), padButton('Gas', 'ArrowUp'))
pad.append(steerSide, pedalSide)
stage.appendChild(pad)

// One step of the game. In the game a crash sends you back to the start;
// (evolution will treat a crash as the end of that car instead).
let lapSeconds = 0
let lapAttempts = 0

function update(input: Input) {
  step(car, input)
  if (car.passed > best) best = car.passed
  if (mode === 'live' && !car.dead && car.passed >= CHECKPOINTS) {
    const lapDone = () => {
      lapSeconds = car.steps / 60
      lapAttempts = crashes + 1
    }
    if (missionStage === 'm1' && !brainOn) {
      lapDone()
      setStage('m1done')
    } else if (missionStage === 'm2' && brainOn) {
      lapDone()
      setStage('m2done')
    } else if (missionStage === 'm3' && brainOn && trained && brain === trained) {
      lapDone()
      m3Score = scoreBrain(trained)
      setStage('m3done')
    }
  }
  if (car.dead) {
    crashes++
    lastCrash = { x: car.x, y: car.y, frames: 120 }
    if (!brainOn) noteCrash()
    car = createCar(undefined, USE_GRIP)
  }
}

function startFreshRecording() {
  recording = []
  mode = 'live'
  car = createCar(undefined, USE_GRIP)
  crashes = 0
  best = 0
  message = 'New recording started.'
}

function startReplay() {
  if (recording.length === 0 || mode === 'replay') return
  savedEnd = {
    x: car.x,
    y: car.y,
    angle: car.angle,
    speed: car.speed,
    crashes,
    passed: car.passed,
    best,
  }
  car = createCar(undefined, USE_GRIP)
  crashes = 0
  best = 0
  replayIndex = 0
  mode = 'replay'
  message = 'Replaying...'
}

function tick() {
  if (mode === 'live') {
    const input = brainOn ? brainInput() : readKeys()
    recording.push(input)
    update(input)
  } else {
    update(recording[replayIndex])
    replayIndex++
    if (replayIndex >= recording.length) {
      const same =
        car.x === savedEnd.x &&
        car.y === savedEnd.y &&
        car.angle === savedEnd.angle &&
        car.speed === savedEnd.speed &&
        crashes === savedEnd.crashes &&
        car.passed === savedEnd.passed &&
        best === savedEnd.best
      message = same
        ? 'REPLAY MATCH: identical result. Physics is deterministic!'
        : 'MISMATCH: the replay ended somewhere different.'
      mode = 'live'
    }
  }
}

// ---------- DRAWING ----------
function tracePath(g: CanvasRenderingContext2D, loop: Point[]) {
  g.moveTo(loop[0].x, loop[0].y)
  for (let i = 1; i < loop.length; i++) g.lineTo(loop[i].x, loop[i].y)
  g.closePath()
}

// How sharply a loop of points turns at point i (radians)
function bendAt(loop: Point[], i: number): number {
  const a = loop[(i + loop.length - 1) % loop.length]
  const b = loop[i]
  const c = loop[(i + 1) % loop.length]
  const turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
}

// Striped kerbs on the tighter bends, a thin edge line everywhere else
function drawEdge(g: CanvasRenderingContext2D, loop: Point[]) {
  g.strokeStyle = C.wall
  g.lineWidth = 2
  g.beginPath()
  tracePath(g, loop)
  g.stroke()
  const tight = KERB_BEND
  g.lineWidth = 6
  g.lineCap = 'butt'
  loop.forEach((p, i) => {
    if (bendAt(loop, i) < tight) return
    const next = loop[(i + 1) % loop.length]
    const steps = Math.max(1, Math.round(Math.hypot(next.x - p.x, next.y - p.y) / 10))
    for (let k = 0; k < steps; k++) {
      g.strokeStyle = (i + k) % 2 === 0 ? '#d8dde3' : '#4a5360'
      g.beginPath()
      g.moveTo(p.x + ((next.x - p.x) * k) / steps, p.y + ((next.y - p.y) * k) / steps)
      g.lineTo(p.x + ((next.x - p.x) * (k + 1)) / steps, p.y + ((next.y - p.y) * (k + 1)) / steps)
      g.stroke()
    }
  })
}

// Small arrows along the road show which way the lap goes
function drawDirectionArrows(g: CanvasRenderingContext2D) {
  const c = track.centerline
  g.strokeStyle = 'rgba(255,255,255,0.16)'
  g.lineWidth = 3
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (let i = 5; i < c.length; i += 10) {
    const before = c[(i + c.length - 1) % c.length]
    const after = c[(i + 1) % c.length]
    const a = Math.atan2(after.y - before.y, after.x - before.x)
    const tipX = c[i].x + Math.cos(a) * 7
    const tipY = c[i].y + Math.sin(a) * 7
    g.beginPath()
    g.moveTo(tipX - Math.cos(a - 0.7) * 12, tipY - Math.sin(a - 0.7) * 12)
    g.lineTo(tipX, tipY)
    g.lineTo(tipX - Math.cos(a + 0.7) * 12, tipY - Math.sin(a + 0.7) * 12)
    g.stroke()
  }
  g.lineCap = 'butt'
  g.lineJoin = 'miter'
}

// A chequered start line across the road
function drawStartLine(g: CanvasRenderingContext2D) {
  const a = leftWall[0]
  const b = rightWall[0]
  const across = Math.hypot(b.x - a.x, b.y - a.y)
  const SQUARE = 6
  g.save()
  g.translate(a.x, a.y)
  g.rotate(Math.atan2(b.y - a.y, b.x - a.x))
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i * SQUARE < across; i++) {
      g.fillStyle = (i + row) % 2 === 0 ? '#d8dde3' : '#14181e'
      g.fillRect(i * SQUARE, row * SQUARE - SQUARE, Math.min(SQUARE, across - i * SQUARE), SQUARE)
    }
  }
  g.restore()
  g.fillStyle = C.muted
  g.font = '500 12px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'bottom'
  g.fillText('START', (a.x + b.x) / 2, a.y - 10)
}

// The track never changes, so it is painted once and copied to the screen every frame
function paintTrack(): HTMLCanvasElement {
  const layer = document.createElement('canvas')
  layer.width = canvas.width
  layer.height = canvas.height
  const g = layer.getContext('2d')!
  g.fillStyle = C.ground
  g.fillRect(0, 0, layer.width, layer.height)
  g.fillStyle = 'rgba(255,255,255,0.05)'
  for (let x = 20; x < layer.width; x += 40) for (let y = 20; y < layer.height; y += 40) g.fillRect(x, y, 2, 2)

  g.beginPath()
  tracePath(g, leftWall)
  tracePath(g, rightWall)
  g.fillStyle = C.road
  g.fill('evenodd')

  g.strokeStyle = 'rgba(255,255,255,0.07)'
  g.lineWidth = 2
  g.setLineDash([16, 20])
  g.beginPath()
  tracePath(g, track.centerline)
  g.stroke()
  g.setLineDash([])

  drawEdge(g, leftWall)
  drawEdge(g, rightWall)
  drawDirectionArrows(g)
  drawStartLine(g)
  g.fillStyle = C.accent
  for (const k of track.blocks) g.fillRect(k.x - BLOCK_HALF, k.y - BLOCK_HALF, BLOCK_HALF * 2, BLOCK_HALF * 2)
  return layer
}
const trackLayer = paintTrack()

// While a hidden neuron is selected, the road shows where it fires on a lap
let heat: { brain: Brain; neuron: number; points: HeatPoint[] } | null = null
function drawHeat() {
  const frozen = missionStage === 'neuron' || missionStage === 'read'
  if (swarm || frozen || selection?.kind !== 'node' || selection.layer !== 'hidden') return
  const neuron = selection.index
  if (!heat || heat.brain !== brain || heat.neuron !== neuron) heat = { brain, neuron, points: traceNeuron(brain, neuron) }
  for (const p of heat.points) {
    ctx.fillStyle = p.value >= 0 ? C.positive : C.negative
    ctx.globalAlpha = Math.abs(p.value) * 0.9
    ctx.beginPath()
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawPrediction(path: { points: Point[]; crashed: boolean }, faint = false) {
  ctx.strokeStyle = faint ? 'rgba(230,233,238,0.45)' : path.crashed ? C.negative : C.accent
  ctx.lineWidth = faint ? 2 : 3
  ctx.lineCap = 'round'
  ctx.setLineDash(faint ? [] : [2, 8])
  ctx.beginPath()
  path.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineCap = 'butt'
  const end = path.points[path.points.length - 1]
  if (path.crashed && !faint) drawCrash(end.x, end.y)
}

function drawCrash(x: number, y: number) {
  ctx.lineCap = 'round'
  ctx.strokeStyle = C.ground
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(x - 5, y - 5)
  ctx.lineTo(x + 5, y + 5)
  ctx.moveTo(x + 5, y - 5)
  ctx.lineTo(x - 5, y + 5)
  ctx.stroke()
  ctx.strokeStyle = C.negative
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.lineCap = 'butt'
}

function draw() {
  ctx.drawImage(trackLayer, 0, 0)

  if (showCheckpoints) {
  for (let k = 0; k < CHECKPOINTS; k++) {
    const p = checkpointPos(track, k)
    const isNext = k === (car.passed + 1) % CHECKPOINTS
    ctx.fillStyle = isNext ? 'cyan' : 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, isNext ? 7 : 3, 0, Math.PI * 2)
    ctx.fill()
  }
  }

  if (swarm) drawSwarm()
  else {
  for (let i = 0; i < RAY_ANGLES.length; i++) {
    const a = car.angle + RAY_ANGLES[i]
    const d = car.rays[i]
    const hitX = car.x + Math.cos(a) * d
    const hitY = car.y + Math.sin(a) * d
    const chosen = selection?.kind === 'node' && selection.layer === 'input' && selection.index === i
    ctx.strokeStyle = blinded[i] ? C.negative : chosen ? C.text : C.accent
    ctx.lineWidth = chosen ? 3 : 1.5
    if (blinded[i]) ctx.setLineDash([4, 6])
    ctx.beginPath()
    ctx.moveTo(car.x, car.y)
    ctx.lineTo(hitX, hitY)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.accent
    ctx.beginPath()
    ctx.arc(hitX, hitY, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  drawHeat()
  const stageM2 = missionStage === 'm2' || missionStage === 'm2done'
  if ((selection || stageM2) && brainOn && canEdit()) {
    if (frame++ % 8 === 0) {
      predicted = predictPath(car, brain)
      beforeEdits = edited || blinded.some(Boolean) ? predictPath(car, originalBrain) : null
    }
  } else if (canEdit()) predicted = beforeEdits = null
  if (beforeEdits) drawPrediction(beforeEdits, true)
  if (predicted) drawPrediction(predicted)
  drawCarShape(car, 34, 18, mode === 'replay' ? C.positive : C.text)
  if (lastCrash && lastCrash.frames > 0) {
    ctx.globalAlpha = Math.min(1, lastCrash.frames / 30)
    drawCrash(lastCrash.x, lastCrash.y)
    ctx.globalAlpha = 1
    lastCrash.frames--
  }
  }

  if (paused) {
    ctx.fillStyle = C.overlay
    ctx.fillRect(345, 225, 110, 34)
    ctx.fillStyle = C.text
    ctx.font = '500 16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('PAUSED', 400, 243)
  }

  ctx.fillStyle = C.text
  ctx.font = '16px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (swarm) {
    ctx.fillStyle = C.overlay
    ctx.fillRect(6, 6, 250, 50)
    ctx.fillStyle = C.text
    ctx.font = '500 16px sans-serif'
    ctx.fillText('Generation ' + (swarm.gen + 1), 14, 26)
    ctx.font = '14px sans-serif'
    ctx.fillText('best car: ' + (Math.max(...swarm.cars.map((c) => c.passed)) / CHECKPOINTS).toFixed(1) + ' laps so far', 14, 46)
    drawSwarmLegend()
    // the caption sits at the bottom, on a pale strip so it can be read
    ctx.fillStyle = C.overlay
    ctx.fillRect(0, 462, 800, 38)
    ctx.fillStyle = C.text
    ctx.font = '15px sans-serif'
    ctx.fillText(swarmCaption(swarm), 10, 478)
    ctx.font = '12px sans-serif'
    ctx.fillStyle = C.muted
    ctx.fillText(message, 10, 494)
  } else {
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (debug) {
  ctx.fillText('mode: ' + mode + '   driver: ' + (brainOn ? 'BRAIN' : 'you'), 10, 24)
  ctx.fillText('crashes: ' + crashes, 10, 46)
  ctx.fillText('recorded steps: ' + recording.length, 10, 68)
  ctx.fillText('rays: ' + car.rays.map((d) => Math.round(d)).join(', '), 10, 90)
  ctx.fillText(
    'checkpoints: ' +
      car.passed +
      '   lap: ' +
      (Math.floor(car.passed / CHECKPOINTS) + 1) +
      '   in lap: ' +
      (car.passed % CHECKPOINTS) +
      '/' +
      CHECKPOINTS +
      '   best: ' +
      best,
    10,
    112,
  )
  }
  ctx.fillStyle = C.muted
  ctx.fillText(message, 10, 490)
  }

  // Mission text, and (when you drive) what you are doing expressed as numbers
  setMissionHtml(missionHtml())
  if (!brainOn && mode === 'live' && !swarm && (missionStage === 'm1' || missionStage === 'm1done')) {
    const now = readKeys()
    const steer = now.steer < 0 ? 'left' : now.steer > 0 ? 'right' : 'straight'
    const gas = now.throttle > 0 ? 'gas' : now.throttle < 0 ? 'brake' : 'coast'
    ctx.fillStyle = C.accent
    ctx.fillText(
      'You see: ' + car.rays.map((d) => Math.round(d)).join(' ') + ' | speed ' + car.speed.toFixed(1) +
        '    You do: steer ' + steer + ', ' + gas,
      10,
      468,
    )
  }

  // The brain panel
  if (swarm) {
    const lead = swarm.cars[0]
    const inputs = getInputs(lead)
    shownBrain = swarm.brains[0]
    drawNetwork(netCtx, swarm.brains[0], inputs, think(swarm.brains[0], inputs), 'Best car of generation ' + (swarm.gen + 1), selection)
    return
  }
  const inputs = getInputs(car)
  shownBrain = brain
  drawNetwork(
    netCtx,
    brain,
    inputs,
    think(brain, inputs),
    brainOn && mode === 'live' ? 'The brain (driving)' : 'The brain (not driving: only what it would do)',
    selection,
    missionStage === 'm2' ? editableEdges() : [],
    blinded,
  )
  if (hideAnswer) {
    netCtx.fillStyle = C.ground
    netCtx.fillRect(165, 60, 255, 355)
    netCtx.fillStyle = C.muted
    netCtx.font = '14px sans-serif'
    netCtx.textAlign = 'center'
    netCtx.fillText('Hidden until you answer', 292, 240)
  }
}


// ---------- BUTTONS: TRAIN, THEN WATCH ----------
const buttons = document.createElement('div')
buttons.className = 'toolbar'
rail.appendChild(buttons)
// Less common actions stay folded away
const more = document.createElement('details')
more.className = 'more'
more.innerHTML = '<summary>More options</summary>'
const moreList = document.createElement('div')
more.appendChild(moreList)

function makeButton(label: string, onClick: () => void, parent: HTMLElement = buttons): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', () => {
    b.blur() // so Enter and arrow keys keep controlling the car
    onClick()
  })
  parent.appendChild(b)
  return b
}

// Hand a brain to the car and let it drive from the start
function watch(b: Brain, text: string) {
  setPaused(false)
  brain = b
  workingBrain = b
  originalBrain = b
  edited = false
  blinded.fill(false)
  if (missionStage !== 'm2' && missionStage !== 'm2done') renderEditor() // Mission 3 restarts on every edit, mid-drag
  startFreshRecording()
  brainOn = true
  message = text
}

let trained: Brain | null = null
let trainedSource: 'evolved' | 'pretrained' | 'file' = 'evolved'
let seed = 1
const SAVE_KEY = 'crashlab.brain'
const GENERATIONS = 80
let worker: Worker | null = null
let watchAll = true // watch every generation (slower) instead of only the newest one

type Finish = { genome: number[]; checkpoints: number; generations: number }
type Run = { seed: number; history: History; shown: number; watching: boolean; finish: Finish | null }
let run: Run | null = null

function showGraph() {
  if (run) drawGraph(run.history.slice(0, run.shown), GENERATIONS)
}

function stopTraining(text: string) {
  worker?.terminate()
  worker = null
  run = null
  swarm = null
  waiting = null
  trainButton.textContent = 'Train a new brain'
  skipButton.style.display = 'none'
  message = text
}

// Everything has been shown: hand the winning brain to the car
function finishTraining(f: Finish) {
  const r = run!
  trained = genomeToBrain(f.genome)
  trainedSource = 'evolved'
  rememberBrain(f.genome)
  if (f.generations < GENERATIONS) drawGraph(r.history, f.generations) // stopped early: fit the graph
  stopTraining('')
  watch(trained, 'Training finished. Watch it drive!')
  seed++
}

// Training runs in a background worker, so the page keeps working and the graph fills in live
const trainButton = makeButton('Train a new brain', () => {
  if (worker) {
    stopTraining('Training stopped.')
    return
  }
  setPaused(false) // a paused page would make training look dead
  run = { seed, history: [], shown: 0, watching: watchAll, finish: null }
  showGraph()
  trainButton.textContent = 'Stop training'
  skipButton.style.display = watchAll ? '' : 'none'
  message = 'Training...'

  worker = new Worker(new URL('./trainWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data
    if (!run) return
    if (m.type === 'progress') {
      run.history.push({ best: m.best, mean: m.mean })
      if (run.watching) waiting = { gen: m.generation, genomes: m.population }
      if (!run.watching) {
        run.shown = run.history.length
        showGraph()
      }
      if (!run.watching) message = 'Training: generation ' + (m.generation + 1) + ' of up to ' + GENERATIONS
    } else if (m.type === 'done') {
      run.finish = { genome: m.genome, checkpoints: m.checkpoints, generations: m.generations }
      if (!run.watching) finishTraining(run.finish)
    }
  }
  worker.onerror = () => stopTraining('Training failed. Try "Load a pre-trained brain" instead.')
  worker.postMessage({ type: 'start', seed: run.seed, generations: GENERATIONS, watch: watchAll })
})
trainButton.className = 'primary'

const skipButton = makeButton('Skip to the end', () => {
  if (!worker || !run || !run.watching) return
  run.watching = false
  skipButton.style.display = 'none'
  swarm = null // stop showing the old generation
  waiting = null
  message = 'Skipping ahead: training the remaining generations...'
  worker.postMessage({ type: 'free' })
  if (run.finish) finishTraining(run.finish)
})
skipButton.style.display = 'none'

const watchButton = makeButton('Watch every generation: ON', () => {
  watchAll = !watchAll
  watchButton.textContent = 'Watch every generation: ' + (watchAll ? 'ON' : 'OFF')
}, moreList)

makeButton('Watch the trained brain', () => {
  if (trained) watch(trained, 'Watching the trained brain.')
  else message = 'Nothing trained yet. Press "Train a new brain" first.'
})

makeButton('Back to the starter brain', () => watch(starterBrain(), 'The hand-written starter brain.'), moreList)

// ---------- SAVING AND LOADING A BRAIN ----------
// The brain is also kept in the browser, so a refresh does not lose it (the browser can still clear it).
function rememberBrain(genome: number[]) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(genome))
  } catch {
    /* storage can be blocked or full; saving to a file still works */
  }
}
function useBrain(genome: number[], source: 'pretrained' | 'file', text: string) {
  trained = genomeToBrain(genome)
  trainedSource = source
  rememberBrain(genome)
  watch(trained, text)
}

makeButton('Load a pre-trained brain', () => {
  if (worker) stopTraining('')
  useBrain(PRETRAINED_GENOME, 'pretrained', 'Watching a pre-trained brain.')
}, moreList)

makeButton('Save brain to file', () => {
  if (!trained) {
    message = 'Nothing to save yet. Train a brain first.'
    return
  }
  const url = URL.createObjectURL(new Blob([brainToJson(brainToGenome(trained))], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'my-brain.json'
  a.click()
  URL.revokeObjectURL(url)
  message = 'Saved my-brain.json. Use "Load brain from file" to bring it back.'
}, moreList)

const fileInput = document.createElement('input')
fileInput.type = 'file'
fileInput.accept = '.json,application/json'
fileInput.style.display = 'none'
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = '' // so the same file can be picked again
  if (!file) return
  const result = brainFromJson(await file.text())
  if ('error' in result) message = result.error
  else {
    if (worker) stopTraining('')
    useBrain(result.genome, 'file', 'Watching the brain from ' + file.name + '.')
  }
})
buttons.appendChild(fileInput)
makeButton('Load brain from file', () => fileInput.click(), moreList)

// ---------- THE HIDDEN-TRACK TEST ----------
// The brain on screen is sent round 20 tracks it has never driven on (the same 20 for everyone).
const hiddenPanel = document.createElement('div')
hiddenPanel.className = 'panel'
hiddenPanel.style.display = 'none'
buttons.after(hiddenPanel)
let hiddenBusy = false
makeButton('Test on ' + HIDDEN_COUNT + ' hidden tracks', async () => {
  if (hiddenBusy) return
  hiddenBusy = true
  hiddenPanel.style.display = 'block'
  hiddenPanel.textContent = 'Testing the brain on ' + HIDDEN_COUNT + ' tracks it has never seen...'
  const tested = brain
  const origin: BrainOrigin = edited || blinded.some(Boolean) ? 'edited' : tested !== trained ? 'handwritten' : trainedSource === 'file' ? 'unknown' : 'learned'
  const r = await testOnHiddenTracks(tested)
  const dots = r.finished
    .map((ok, i) => '<span title="track ' + (i + 1) + (ok ? ': lapped' : ': failed') + '" class="dot' + (ok ? '' : ' fail') + '"></span>')
    .join('')
  hiddenPanel.innerHTML =
    '<b>Hidden-track test: ' + r.count + ' of ' + HIDDEN_COUNT + ' tracks lapped</b>' +
    (r.avgLap !== null ? ' (average lap ' + r.avgLap.toFixed(1) + ' s)' : '') +
    '. Practice track: ' + (r.practiceLap !== null ? 'lapped in ' + r.practiceLap.toFixed(1) + ' s' : 'not lapped') + '.<br>' +
    dots + '<br>' + hiddenVerdict(r, origin) + ' <span class="note">Green = lapped, red = crashed or stuck.</span>'
  hiddenBusy = false
})
buttons.appendChild(more)
void prepareHiddenTracks() // build the 20 tracks quietly in the background

// bring back the brain from the last visit, if there is one
try {
  const saved = localStorage.getItem(SAVE_KEY)
  const parsed = saved ? brainFromJson(JSON.stringify({ format: 'crashlab-brain', inputs: 6, hidden: 5, outputs: 2, genome: JSON.parse(saved) })) : null
  if (parsed && 'genome' in parsed) trained = genomeToBrain(parsed.genome)
} catch {
  /* nothing saved, or storage is blocked */
}

// ---------- THE LEARNING GRAPH ----------
const graphCanvas = document.createElement('canvas')
graphCanvas.width = 800
graphCanvas.height = 170
stage.appendChild(graphCanvas)
const gctx = graphCanvas.getContext('2d')!

const BEST_COLOR = C.accent
const MEAN_COLOR = C.positive

// One dot-and-line series on the graph
function plotSeries(values: number[], color: string, x: (i: number) => number, y: (v: number) => number) {
  gctx.strokeStyle = color
  gctx.lineWidth = 2.5
  gctx.beginPath()
  values.forEach((v, i) => (i === 0 ? gctx.moveTo(x(i), y(v)) : gctx.lineTo(x(i), y(v))))
  gctx.stroke()
}

function drawGraph(history: History | null, totalGenerations = 40) {
  const W = graphCanvas.width
  const H = graphCanvas.height
  const left = 52
  const right = W - 20
  const top = 30
  const bottom = H - 34
  const maxY = 70 // a bit above the ~60 checkpoints a trained car reaches in 20 seconds with grip
  const generations = Math.max(totalGenerations, 2)
  const x = (i: number) => left + (i / (generations - 1)) * (right - left)
  const y = (v: number) => bottom - (v / maxY) * (bottom - top)

  gctx.fillStyle = C.ground
  gctx.fillRect(0, 0, W, H)

  // grid and y labels
  gctx.font = '12px sans-serif'
  gctx.textBaseline = 'middle'
  gctx.textAlign = 'right'
  for (let v = 0; v <= 60; v += 20) {
    gctx.strokeStyle = C.road
    gctx.lineWidth = 1
    gctx.beginPath()
    gctx.moveTo(left, y(v))
    gctx.lineTo(right, y(v))
    gctx.stroke()
    gctx.fillStyle = C.muted
    gctx.fillText(String(v), left - 8, y(v))
  }
  // x labels
  gctx.textAlign = 'center'
  gctx.textBaseline = 'top'
  for (let g = 0; g < generations; g += 10) {
    gctx.fillStyle = C.muted
    gctx.fillText(String(g + 1), x(g), bottom + 8)
  }
  gctx.fillText('generation', (left + right) / 2, bottom + 20)

  // title
  gctx.textAlign = 'left'
  gctx.textBaseline = 'alphabetic'
  gctx.fillStyle = C.text
  gctx.font = '500 14px sans-serif'
  gctx.fillText(
    history ? 'Learning curve: progress in 20 seconds (20 = one lap)' : 'Learning curve',
    left,
    20,
  )

  if (!history) {
    gctx.fillStyle = C.muted
    gctx.font = '14px sans-serif'
    gctx.textAlign = 'center'
    gctx.fillText('Press "Train a new brain" and the curve appears here.', (left + right) / 2, (top + bottom) / 2)
    return
  }

  if (history.length === 0) return

  // a soft fill under the best car's line
  gctx.fillStyle = 'rgba(242,184,75,0.1)'
  gctx.beginPath()
  gctx.moveTo(x(0), bottom)
  history.forEach((h, i) => gctx.lineTo(x(i), y(h.best)))
  gctx.lineTo(x(history.length - 1), bottom)
  gctx.closePath()
  gctx.fill()

  plotSeries(history.map((h) => h.mean), MEAN_COLOR, x, y)
  plotSeries(history.map((h) => h.best), BEST_COLOR, x, y)

  // direct labels at the right end of each line
  const last = history[history.length - 1]
  gctx.font = '12px sans-serif'
  gctx.textAlign = 'right'
  gctx.textBaseline = 'bottom'
  gctx.fillStyle = BEST_COLOR
  gctx.fillText('best car: ' + Math.round(last.best), right, y(last.best) - 6)
  gctx.textBaseline = 'top'
  gctx.fillStyle = MEAN_COLOR
  gctx.fillText('average car: ' + Math.round(last.mean), right, y(last.mean) + 6)
}
drawGraph(null)

// ---------- THE SWARM: all 100 cars of a generation, driving at once ----------
type Swarm = {
  gen: number
  cars: Car[]
  brains: Brain[]
  done: boolean[]
  holdFrames: number
  trails: { x: number; y: number }[][] // recent positions of each car
}
let swarm: Swarm | null = null
let waiting: { gen: number; genomes: number[][] } | null = null // newest generation not shown yet
const VIEW_STEPS = 600 // each generation is shown for 10 seconds of driving (about 2 laps)

function makeSwarm(gen: number, genomes: number[][]): Swarm {
  const brains = genomes.map(genomeToBrain)
  const cars = brains.map(() => createCar(undefined, USE_GRIP))
  return {
    gen,
    cars,
    brains,
    done: brains.map(() => false),
    holdFrames: 0,
    trails: cars.map((c) => [{ x: c.x, y: c.y }]),
  }
}

function stepSwarm() {
  if (!worker || !run) return
  const finished = swarm !== null && swarm.done.every(Boolean)
  if (swarm && finished) {
    swarm.holdFrames++ // linger a moment so the end of the generation can be seen
    if (swarm.holdFrames < 20) return
  }
  if (!swarm || finished) {
    if (waiting) {
      swarm = makeSwarm(waiting.gen, waiting.genomes)
      waiting = null
      if (run.watching) {
        run.shown = swarm.gen + 1 // the graph follows what you are watching
        showGraph()
        message = 'Training: generation ' + (swarm.gen + 1) + ' of up to ' + GENERATIONS + '. Each generation is shown for 10 s of driving.'
        if (!run.finish) worker.postMessage({ type: 'next' }) // compute the next one while this plays
      }
    } else if (run.watching && run.finish) {
      finishTraining(run.finish) // the last generation has been watched
      return
    }
  }
  if (!swarm) return
  // the fewer cars are left, the faster time runs (so the work per frame stays about the same)
  const alive = swarm.done.filter((d) => !d).length
  const stepsPerFrame = Math.min(12, Math.max(6, Math.round(600 / Math.max(alive, 1))))
  for (let k = 0; k < stepsPerFrame; k++) {
    swarm.cars.forEach((c, i) => {
      if (swarm!.done[i]) return
      const { outputs } = think(swarm!.brains[i], getInputs(c))
      step(c, { steer: outputs[0], throttle: outputs[1] })
      const trail = swarm!.trails[i]
      trail.push({ x: c.x, y: c.y })
      if (trail.length > 40) trail.shift()
      if (c.dead || c.steps >= VIEW_STEPS || c.sinceProgress >= STALL_STEPS) swarm!.done[i] = true
    })
  }
}

// Which bend of the track a position is on, in plain words
function regionOf(x: number, y: number): string {
  return (y < 250 ? 'top' : 'bottom') + '-' + (x < 400 ? 'left' : 'right')
}

// One sentence about how this generation is going, written from what the cars are doing
function swarmCaption(sw: Swarm): string {
  const crashed = sw.cars.filter((c) => c.dead)
  const lasting = sw.cars.length - crashed.length
  const counts: Record<string, number> = {}
  crashed.forEach((c) => {
    const r = regionOf(c.x, c.y)
    counts[r] = (counts[r] ?? 0) + 1
  })
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const hotspot = crashed.length >= 8 && top && top[1] >= crashed.length * 0.4 ? ' Most crashes: ' + top[0] + ' bend.' : ''
  if (sw.done.every(Boolean)) {
    // a car that neither crashed nor reached 10 seconds was stuck, going nowhere
    const lasted = sw.cars.filter((c) => !c.dead && c.steps >= VIEW_STEPS).length
    const stuck = lasting - lasted
    const parts = [lasted + ' of ' + sw.cars.length + ' lasted the full 10 seconds']
    if (stuck > 0) parts.push(stuck + ' got stuck')
    return parts.join(', ') + '.' + hotspot
  }
  return crashed.length + ' crashed so far, ' + lasting + ' still driving.' + hotspot
}

// A top-down race car: tyres, a tapered body, wings front and back, a dark cockpit
function drawCarShape(c: Car, length: number, width: number, body: string) {
  const L = length / 2
  const W = width / 2
  const tyre = Math.max(2, width * 0.2)
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(c.angle)
  ctx.fillStyle = '#05070a'
  for (const x of [L * 0.3, -L * 0.8]) {
    ctx.fillRect(x, -W, L * 0.42, tyre)
    ctx.fillRect(x, W - tyre, L * 0.42, tyre)
  }
  ctx.fillStyle = body
  ctx.fillRect(L * 0.72, -W * 0.8, L * 0.16, W * 1.6) // front wing
  ctx.fillRect(-L, -W * 0.85, L * 0.2, W * 1.7) // rear wing
  ctx.beginPath()
  ctx.moveTo(L, 0)
  ctx.lineTo(L * 0.2, -W * 0.34)
  ctx.lineTo(-L * 0.1, -W * 0.72)
  ctx.lineTo(-L * 0.85, -W * 0.5)
  ctx.lineTo(-L * 0.85, W * 0.5)
  ctx.lineTo(-L * 0.1, W * 0.72)
  ctx.lineTo(L * 0.2, W * 0.34)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = C.ground
  ctx.beginPath()
  ctx.ellipse(-L * 0.12, 0, L * 0.24, W * 0.3, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawSwarm() {
  if (!swarm) return
  // fading trails show where each car has been
  swarm.trails.forEach((trail, i) => {
    if (trail.length < 2) return
    const best = i === 0
    ctx.strokeStyle = best ? 'rgba(242,184,75,0.75)' : 'rgba(90,162,255,0.22)'
    ctx.lineWidth = best ? 3 : 2
    ctx.beginPath()
    ctx.moveTo(trail[0].x, trail[0].y)
    for (let k = 1; k < trail.length; k++) ctx.lineTo(trail[k].x, trail[k].y)
    ctx.stroke()
  })
  // a cross marks every crash and stays for the whole generation
  swarm.cars.forEach((c) => {
    if (c.dead) drawCrash(c.x, c.y)
  })
  // cars still driving; the best car of the generation is drawn last, in red, on top
  for (let i = swarm.cars.length - 1; i >= 0; i--) {
    const c = swarm.cars[i]
    if (c.dead) continue
    drawCarShape(c, i === 0 ? 34 : 26, i === 0 ? 18 : 14, i === 0 ? C.accent : 'rgba(90,162,255,0.8)')
  }
}

// A key to the picture, in the corner of the track
function drawSwarmLegend() {
  const x = 556
  const y = 16 // top-right corner: the track never reaches it
  ctx.fillStyle = C.overlay
  ctx.fillRect(x - 8, y - 8, 246, 80)
  ctx.font = '13px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = C.text
  drawCarShape({ x: x + 14, y: y + 8, angle: 0 } as Car, 22, 12, C.accent)
  ctx.fillStyle = C.text
  ctx.fillText('best car of this generation', x + 36, y + 8)
  drawCarShape({ x: x + 14, y: y + 30, angle: 0 } as Car, 18, 10, 'rgba(90,162,255,0.8)')
  ctx.fillStyle = C.text
  ctx.fillText('the other 99 cars', x + 36, y + 30)
  ctx.lineCap = 'round'
  ctx.strokeStyle = C.negative
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x + 8, y + 46)
  ctx.lineTo(x + 20, y + 58)
  ctx.moveTo(x + 20, y + 46)
  ctx.lineTo(x + 8, y + 58)
  ctx.stroke()
  ctx.lineCap = 'butt'
  ctx.fillStyle = C.text
  ctx.fillText('a car crashed here', x + 36, y + 52)
  ctx.textBaseline = 'alphabetic'
}

// ---------- MISSIONS ----------
const MISSION_TRACKS = Array.from({ length: 10 }, (_, i) => makeTrack(9000 + i, 1))

type Score = { lap: number | null; reached: number; unseen: number }
// How a brain does: a lap on the practice track, and laps on 10 tracks it has never seen
function scoreBrain(b: Brain): Score {
  const lap = lapSteps(b, DEFAULT_TRACK, USE_GRIP)
  return {
    lap: lap === null ? null : lap / 60,
    reached: runBrain(b, undefined, undefined, USE_GRIP).checkpoints,
    unseen: MISSION_TRACKS.filter((t) => lapSteps(b, t, USE_GRIP) !== null).length,
  }
}
function describe(sc: Score): string {
  return (
    (sc.lap !== null ? 'a lap in <b>' + sc.lap.toFixed(1) + ' s</b>' : 'no lap yet (' + Math.round((100 * sc.reached) / CHECKPOINTS) + '% of the way round)') +
    ' on the practice track, and a lap on <b>' + sc.unseen + ' of 10</b> unseen tracks'
  )
}

let m3Score: Score | null = null
let m2Score: Score | null = null
let readScore = 0
let readTotal = 0
let hideAnswer = false // the game covers the network's decision until the player guesses

// Mission 2's brain: the parts that look at the road are pre-wired; you set three connections
const m2 = { steer: 0, wall: 0, speed: 0 }
function missionBrain(): Brain {
  const K = 3
  return {
    w1: [
      [-K, -K, 0, K, K, 0], // neuron 0: is the right side more open than the left?
      [0, 0, -3, 0, 0, 0], // neuron 1: is a wall close ahead?
      [0, 0, 0, 0, 0, 3], // neuron 2: how fast am I going?
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    ],
    b1: [0, 1.5, 0, 0, 0],
    w2: [
      [m2.steer, 0, 0, 0, 0], // steering follows neuron 0, as strongly as you choose
      [0, -m2.wall, -m2.speed, 0, 0], // gas: ease off for a wall ahead, and for high speed
    ],
    b2: [0, 1.2], // a steady urge to accelerate
  }
}

const m2Panel = document.createElement('div')
m2Panel.className = 'panel'
rail.appendChild(m2Panel)
const m2Result = document.createElement('div')
m2Result.style.marginTop = '6px'

const m2Sliders = document.createElement('div')
m2Panel.appendChild(m2Sliders)
m2Panel.appendChild(m2Result)

// Re-test the brain whenever a slider moves (several moves in one frame count once)
let m2Scheduled = false
function scheduleM2() {
  if (m2Scheduled) return
  m2Scheduled = true
  setTimeout(() => {
    m2Scheduled = false
    applyM2()
  }, 0)
}
function applyM2() {
  const b = missionBrain()
  watch(b, 'Your three weights are driving.')
  m2Score = scoreBrain(b)
  m2Result.innerHTML = 'With these weights the car makes ' + describe(m2Score) + '.'
}

// The neuron mission freezes the car mid-lap and steps through one real neuron
const neuronPanel = document.createElement('div')
neuronPanel.className = 'panel neuron'
rail.appendChild(neuronPanel)

const STAGE_STEP: Record<MissionStage, number> = { m1: 0, m1done: 0, neuron: 1, neurondone: 1, detect: 1, detectdone: 1, read: 1, readdone: 1, m2: 2, m2done: 2, m3: 3, m3done: 3 }

// ---------- EDITING THE NETWORK ----------
const THREE_EDGES: Edge[] = [
  { layer: 'second', from: 0, to: 0 },
  { layer: 'second', from: 1, to: 1 },
  { layer: 'second', from: 2, to: 1 },
]
const canEdit = () => missionStage === 'm2' || missionStage === 'm2done' || missionStage === 'm3' || missionStage === 'm3done'
function editableEdges(): Edge[] {
  return missionStage === 'm2' || missionStage === 'm2done' ? THREE_EDGES : []
}
const canEditEdge = (e: Edge) =>
  missionStage === 'm3' || missionStage === 'm3done' || (canEdit() && THREE_EDGES.some((t) => sameEdge(t, e)))

const edgeWeight = (e: Edge) => (e.layer === 'first' ? workingBrain.w1 : workingBrain.w2)[e.to][e.from]
const edgeName = (e: Edge) =>
  e.layer === 'first' ? INPUT_LABELS[e.from] + ' to ' + hiddenName(e.to) : hiddenName(e.from) + ' to ' + OUTPUT_LABELS[e.to]

function changeBrain(fn: (b: Brain) => void) {
  if (!edited) {
    workingBrain = cloneBrain(workingBrain)
    edited = true
  }
  fn(workingBrain)
  heat = null
  brain = blinded.some(Boolean) ? blindBrain(workingBrain, blinded) : workingBrain
}

function setEdge(e: Edge, value: number) {
  if (!canEditEdge(e)) return
  if (missionStage === 'm2' || missionStage === 'm2done') {
    // Mission 3's brain is rebuilt from these three numbers, which restarts the car
    if (e.to === 0) m2.steer = value
    else if (e.from === 1) m2.wall = -value
    else m2.speed = -value
    scheduleM2()
    return
  }
  changeBrain((b) => ((e.layer === 'first' ? b.w1 : b.w2)[e.to][e.from] = value))
}

function select(s: Selection) {
  selection = s
  renderEditor()
  if (missionStage === 'detect') showDetector()
}

// The road detector step: three neurons, three things they notice
const NOTICES = [
  'It fires blue when the right side is more open, and red when the left is.',
  'It fires blue when a wall is close ahead, and red while the road ahead is clear.',
  'It fires harder the faster the car goes.',
]
const seenNeurons = new Set<number>()
function showDetector() {
  const current = selection?.kind === 'node' && selection.layer === 'hidden' ? selection.index : -1
  if (current >= 0 && current < NOTICES.length) seenNeurons.add(current)
  neuronPanel.innerHTML =
    '<p class="goal">Pick a neuron and see where it fires on the road.</p>' +
    '<div class="actions">' + NOTICES.map((_, i) => '<button class="btn' + (i === current ? ' primary' : '') + '" data-neuron="' + i + '">Neuron ' + (i + 1) + '</button>').join('') + '</div>' +
    '<p class="note">' + (current >= 0 ? NOTICES[current] ?? 'This neuron is unused, so it does nothing.' : 'Blue fires, red pushes against, faint does nothing.') + '</p>'
  neuronPanel.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => select({ kind: 'node', layer: 'hidden', index: Number(b.dataset.neuron) })),
  )
  if (seenNeurons.size === NOTICES.length) setStage('detectdone')
}

function weightRow(label: string, value: number, onInput: (v: number) => void): HTMLElement {
  const row = document.createElement('label')
  row.className = 'slider'
  const text = document.createElement('span')
  text.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '-4'
  input.max = '4'
  input.step = '0.1'
  input.value = String(value)
  const shown = document.createElement('b')
  shown.textContent = value.toFixed(1)
  input.addEventListener('input', () => {
    shown.textContent = Number(input.value).toFixed(1)
    onInput(Number(input.value))
  })
  input.addEventListener('keydown', (e) => e.stopPropagation()) // arrow keys move the slider, not the car
  row.append(text, input, shown)
  return row
}

// Mission 3's sliders are always on show. Moving one lights up its connection in the network.
function renderM2Sliders() {
  const rows: [string, Edge, number][] = [
    ['Right is open → steer', THREE_EDGES[0], m2.steer],
    ['Wall ahead → throttle', THREE_EDGES[1], -m2.wall],
    ['Going fast → throttle', THREE_EDGES[2], -m2.speed],
  ]
  m2Sliders.innerHTML = ''
  for (const [label, edge, value] of rows) {
    m2Sliders.appendChild(
      weightRow(label, value, (v) => {
        selection = { kind: 'edge', ...edge }
        noteChange()
        setEdge(edge, v)
      }),
    )
  }
}

// The panel under the network: what the selected thing is, and what can be done to it
function renderEditor() {
  editor.innerHTML = ''
  if (missionStage === 'm2' || missionStage === 'm2done') {
    editor.style.display = 'none'
    renderM2Sliders()
    return
  }
  const show = canEdit() && !swarm && selection !== null
  editor.style.display = show ? 'block' : 'none'
  if (!show || !selection) return
  const sel = selection
  if (sel.kind === 'edge') {
    if (!canEditEdge(sel)) {
      editor.innerHTML = '<p class="note">This connection is locked here. Use the dashed ones.</p>'
      return
    }
    editor.appendChild(weightRow(edgeName(sel), edgeWeight(sel), (v) => setEdge(sel, v)))
    const cut = document.createElement('button')
    cut.className = 'btn'
    cut.textContent = 'Cut this connection'
    cut.addEventListener('click', () => {
      setEdge(sel, 0)
      renderEditor()
    })
    editor.appendChild(cut)
  } else if (sel.layer === 'input') {
    const off = blinded[sel.index]
    const toggle = document.createElement('button')
    toggle.className = 'btn'
    toggle.textContent = (off ? 'Give back ' : 'Blind ') + INPUT_LABELS[sel.index]
    toggle.addEventListener('click', () => {
      blinded[sel.index] = !off
      changeBrain(() => {})
      renderEditor()
    })
    editor.appendChild(toggle)
  } else if (sel.layer === 'hidden' || sel.layer === 'output') {
    const hiddenLayer = sel.layer === 'hidden'
    const count = hiddenLayer ? INPUT_LABELS.length : workingBrain.w1.length
    for (let i = 0; i < count; i++) {
      const e: Edge = { layer: hiddenLayer ? 'first' : 'second', from: i, to: sel.index }
      editor.appendChild(weightRow(edgeName(e), edgeWeight(e), (v) => setEdge(e, v)))
    }
    const biases = hiddenLayer ? 'b1' : 'b2'
    editor.appendChild(
      weightRow('Bias (always added)', workingBrain[biases][sel.index], (v) => changeBrain((b) => (b[biases][sel.index] = v))),
    )
  }
  if (missionStage === 'm3' || missionStage === 'm3done') {
    const reset = document.createElement('button')
    reset.className = 'btn'
    reset.textContent = 'Undo all my changes'
    reset.addEventListener('click', () => {
      // the car stays where it is, so the same moment can be tried again
      workingBrain = originalBrain
      brain = originalBrain
      edited = false
      blinded.fill(false)
      heat = null
      renderEditor()
    })
    editor.appendChild(reset)
  }
}

const STAGE_NAME: Record<MissionStage, string> = {
  m1: 'Drive', m1done: 'Drive', neuron: 'Neuron', neurondone: 'Neuron', detect: 'What neurons notice', detectdone: 'What neurons notice',
  read: 'Read the brain', readdone: 'Read the brain', m2: 'Weights', m2done: 'Weights', m3: 'Evolve', m3done: 'Evolve',
}

function applyStageVisibility() {
  enterStep(STAGE_NAME[missionStage])
  const sandbox = missionStage === 'm3' || missionStage === 'm3done'
  buttons.style.display = sandbox ? '' : 'none'
  if (!sandbox) hiddenPanel.style.display = 'none'
  graphCanvas.style.display = sandbox ? 'block' : 'none'
  m2Panel.style.display = missionStage === 'm2' || missionStage === 'm2done' ? 'block' : 'none'
  const frozen = missionStage === 'neuron' || missionStage === 'read'
  neuronPanel.style.display = frozen || missionStage === 'detect' || missionStage === 'detectdone' ? 'block' : 'none'
  pauseRow.style.display = frozen ? 'none' : 'flex'
  renderEditor()
  pad.style.display = frozen ? 'none' : ''
  document.body.classList.toggle('sandbox', sandbox)
  const current = STAGE_STEP[missionStage]
  ;[...stepList.children].forEach((li, i) => {
    li.className = i === current ? 'now' : i < current ? 'done' : ''
  })
}

function setStage(s: MissionStage) {
  missionStage = s
  applyStageVisibility()
}

const missions = {
  retry1() {
    setStage('m1')
    brainOn = false
    startFreshRecording()
    message = 'Mission 1: drive one lap.'
  },
  startNeuron() {
    setStage('neuron')
    const moment = findMoment()
    watch(moment.brain, 'Frozen mid-lap.')
    car = moment.car
    setPaused(true)
    selection = { kind: 'node', layer: 'hidden', index: NEURON }
    const showPath = () => {
      predicted = predictPath(car, brain)
    }
    runNeuronLab(neuronPanel, moment, showPath, () => {
      predicted = null
      setPaused(false)
      message = 'The car uses that same sum at every moment of the lap.'
      setStage('neurondone')
    })
  },
  startRead() {
    selection = null
    setStage('read')
    runReadGame(
      neuronPanel,
      pickRounds(),
      (round) => {
        watch(round.brain, 'Frozen mid-lap.')
        car = round.car
        predicted = null
        hideAnswer = true
        setPaused(true)
      },
      (round) => {
        hideAnswer = false
        predicted = predictPath(round.car, round.brain)
      },
      (score, total) => {
        readScore = score
        readTotal = total
        noteReadScore(score, total)
        predicted = null
        setPaused(false)
        message = ''
        setStage('readdone')
      },
    )
  },
  startDetect() {
    seenNeurons.clear()
    selection = null
    setStage('detect')
    watch(starterBrain(), '')
    showDetector()
  },
  start2() {
    selection = null
    setStage('m2')
    applyM2()
  },
  start3() {
    setStage('m3')
    watch(starterBrain(), 'Press "Train a new brain".')
    brainOn = false
  },
}
;(window as unknown as { missions: typeof missions }).missions = missions

const card = (title: string, body: string, actions = '') =>
  '<h2>' + title + '</h2><p>' + body + '</p>' + (actions ? '<div class="actions">' + actions + '</div>' : '')
const missionButton = (call: string, label: string, primary = true) =>
  '<button class="btn' + (primary ? ' primary' : '') + '" onclick="missions.' + call + '()">' + label + '</button>'
const progress = () => 'Lap progress: <b>' + Math.round((100 * car.passed) / CHECKPOINTS) + '%</b>'

function missionHtml(): string {
  switch (missionStage) {
    case 'm1':
      return card(
        'Drive one lap',
        (touchScreen ? 'Use the buttons under the track.' : 'Arrow keys: up = gas, down = brake, left and right = steer.') +
          '<br>' + progress() + (crashes > 0 ? ' · crashes: ' + crashes : ''),
      )
    case 'm1done':
      return card(
        'Lap complete: ' + lapSeconds.toFixed(1) + ' s' + (lapAttempts > 1 ? ', attempt ' + lapAttempts : ''),
        'You saw <b>6 numbers</b> (5 rays and speed) and answered with <b>2</b> (steer and gas). A neural network does the same job.',
        missionButton('startNeuron', 'Look inside the network') + missionButton('retry1', 'Drive again', false),
      )
    case 'neuron':
      return card('Inside one neuron', 'The car is frozen. The outlined neuron asks: is the right side more open than the left?')
    case 'neurondone':
      return card(
        'That is all a neuron does',
        'Multiply, add, squash. This car has 7 neurons, and large networks have billions.',
        missionButton('startDetect', 'Next: what neurons notice'),
      )
    case 'read':
      return card('Read the brain', 'Look at the rays and predict what the network will do.')
    case 'readdone':
      return card(
        readScore + ' of ' + readTotal + ' correct',
        (readScore >= readTotal - 1 ? 'You can read this brain without seeing a single number.' : 'Rays and speed decide everything. Try watching them as the car drives.'),
        missionButton('start2', 'Next: set the weights') + missionButton('startRead', 'Play again', false),
      )
    case 'detect':
      return card('What neurons notice', 'Each neuron watches for one thing. The road shows where it fires on a lap.')
    case 'detectdone':
      return card(
        'Neurons are detectors',
        'Nobody needs to explain these to the car. Each one is only weights, and the weights decide what it notices.',
        missionButton('startRead', 'Next: read the brain'),
      )
    case 'm2':
      return card('Set three weights', 'Move the sliders until the car laps by itself. The line shows where it will go. Negative throttle brakes.<br>' + progress())
    case 'm2done':
      return card(
        'It drives itself',
        'Your car makes ' + (m2Score ? describe(m2Score) : '') + '. That took trial and error with just 3 of 47 weights. Real networks have billions, so how do they find theirs?',
        missionButton('start3', 'Next: let evolution try'),
      )
    case 'm3':
      return card(
        'Let evolution find all 47 weights',
        '100 random brains drive and most crash. The best pass on their weights with small changes, and the curve shows them improving.',
      )
    case 'm3done':
      return card(
        trainedSource === 'evolved' ? 'Evolution found all 47 weights' : 'This brain drives',
        (trainedSource === 'evolved' ? 'No help needed: it makes ' : (trainedSource === 'pretrained' ? 'Evolved ahead of time: it makes ' : 'Loaded from a file: it makes ')) +
          (m3Score ? describe(m3Score) : '') + '.' + (m2Score ? '<br>Your 3 weights made ' + describe(m2Score) + '.' : ''),
      )
  }
}

applyStageVisibility()

// ---------- THE PAUSED INSPECTOR ----------
// While paused, a selected neuron shows its real sum: the same number as its circle in the network
const inspector = document.createElement('div')
inspector.className = 'panel neuron'
inspector.style.display = 'none'
rail.appendChild(inspector)
let inspectorText = ''

function inspectorHtml(): string {
  const frozen = missionStage === 'neuron' || missionStage === 'read'
  if (!paused || frozen || !shownBrain || selection?.kind !== 'node' || selection.layer === 'input') return ''
  const lead = swarm ? swarm.cars[0] : car
  const inputs = getInputs(lead)
  const thought = think(shownBrain, inputs)
  const hiddenLayer = selection.layer === 'hidden'
  const i = selection.index
  const weights = (hiddenLayer ? shownBrain.w1 : shownBrain.w2)[i]
  const values = hiddenLayer ? inputs : thought.hidden
  const names = hiddenLayer ? INPUT_LABELS : thought.hidden.map((_, h) => hiddenName(h))
  const bias = (hiddenLayer ? shownBrain.b1 : shownBrain.b2)[i]
  const result = (hiddenLayer ? thought.hidden : thought.outputs)[i]
  const rows = weights
    .map((w, k) => ({ name: names[k], value: values[k], weight: w, pull: w * values[k] }))
    .sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull))
  const total = rows.reduce((sum, r) => sum + r.pull, bias)
  return (
    '<p class="goal">How ' + (hiddenLayer ? hiddenName(i) : OUTPUT_LABELS[i]) + ' got ' + result.toFixed(2) + '</p><table><tbody>' +
    rows.map((r) => '<tr' + (r.weight === 0 ? ' class="ignored"' : '') + '><td>' + r.name + '</td><td>' + r.value.toFixed(2) + ' × ' + r.weight.toFixed(1) + '</td><td>' + r.pull.toFixed(2) + '</td></tr>').join('') +
    '<tr><td colspan="2">Bias</td><td>' + bias.toFixed(2) + '</td></tr>' +
    '<tr class="sum"><td colspan="2">Add them up</td><td>' + total.toFixed(2) + '</td></tr>' +
    '<tr class="sum"><td colspan="2">Squash to -1…1</td><td>' + Math.tanh(total).toFixed(2) + '</td></tr>' +
    '</tbody></table><p class="note">' + (edited || blinded.some(Boolean) ? 'Dotted line: with your changes. Faint line: the brain before them.' : 'Change a weight to see a second path, or press Step to see the same weights meet new inputs.') + ' Rounded to 2 decimals.</p>'
  )
}

function showInspector() {
  const html = inspectorHtml()
  inspector.style.display = html ? 'block' : 'none'
  if (html === inspectorText) return
  inspectorText = html
  inspector.innerHTML = html
}

// ---------- COPY MY RESULTS (for the friend test) ----------
const resultsButton = document.createElement('button')
resultsButton.className = 'btn results'
resultsButton.textContent = 'Copy my results'
const resultsBox = document.createElement('textarea')
resultsBox.className = 'results'
resultsBox.readOnly = true
resultsBox.rows = 8
resultsBox.style.display = 'none'
resultsBox.addEventListener('keydown', (e) => e.stopPropagation())
resultsButton.addEventListener('click', async () => {
  const text = resultsText(touchScreen ? 'phone or tablet' : 'computer')
  resultsBox.value = text
  try {
    await navigator.clipboard.writeText(text)
    resultsBox.style.display = 'none'
    resultsButton.textContent = 'Copied'
  } catch {
    resultsBox.style.display = 'block' // no clipboard access: let them copy it by hand
    resultsBox.select()
    resultsButton.textContent = 'Copy the text below'
  }
  resultsButton.blur()
  setTimeout(() => (resultsButton.textContent = 'Copy my results'), 2500)
})
rail.append(resultsButton, resultsBox)

// ---------- THE LOOP ----------
const STEP = 1000 / 60
let lastTime = performance.now()
let owed = 0

function loop(now: number) {
  owed += now - lastTime
  lastTime = now
  if (owed > 250) owed = 250

  if (paused) {
    owed = 0
    if (stepRequested) {
      tick()
      stepSwarm()
    }
  } else {
    while (owed >= STEP) {
      tick()
      owed -= STEP
    }
    stepSwarm()
  }
  stepRequested = false
  draw()
  showInspector()
  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)