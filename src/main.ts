import './style.css'
import { DEFAULT_BUILD, LIMITS, POPULATION, TRAINING_BUDGET, buildProblem, genomeLength, shapeOf, specOf, type Build } from './setup'
import { CHECKPOINTS, MAX_STEPS, STALL_STEPS, createCar, drive, type Brain, type Car } from './sim'
import { PRACTICE_COUNT, practiceLevel, practiceTrack, trackStats, type Track } from './track'
import { genomeToBrain } from './genome'
import { carFromJson, carToJson, type CarFile } from './carFile'
import { COL, H, W, clear, drawCar, drawCrash, drawMinimap, drawRays, drawThumb, drawTrack, fit, follow, newCamera, withCamera } from './draw'

// ---------- SAVED STATE ----------
const KEYS = { draft: 'crashlab.draft', car: 'crashlab.car' }
function load<T>(key: string): T | null {
  try {
    const text = localStorage.getItem(key)
    return text ? (JSON.parse(text) as T) : null
  } catch {
    return null
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage can be blocked or full; saving to a file still works */
  }
}

type Draft = { name: string; build: Build }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const savedDraft = load<Draft>(KEYS.draft)
const draft: Draft =
  savedDraft && typeof savedDraft.name === 'string' && buildProblem(savedDraft.build, PRACTICE_COUNT) === null
    ? savedDraft
    : { name: 'Team Crash', build: clone(DEFAULT_BUILD) }
const savedCar = load<string>(KEYS.car)
const parsedCar = savedCar ? carFromJson(savedCar) : null
let car: CarFile | null = parsedCar && !('error' in parsedCar) ? parsedCar : null
let carBrain: Brain | null = car ? genomeToBrain(car.genome, shapeOf(car.build.sensors)) : null

const sameBuild = (a: Build, c: Build) => JSON.stringify(a) === JSON.stringify(c)
const carIsStale = () => !!car && !sameBuild(car.build, draft.build)

// ---------- TRACK NAMES AND TAGS ----------
const TRACK_NAMES = ['Home Circuit', 'Kestrel Loop', 'Saltmarsh', 'Ironbridge', 'Vale Ring', 'Copperhead', 'Northgate', 'Pinewood', 'Basalt Bend', 'Lantern Park', 'Foxglove', 'Granite Run']
const LEVELS = ['Gentle', 'Medium', 'Twisty', 'Wild']
const built = new Set<number>([0])
function trackTags(id: number): string {
  const level = practiceLevel(id)
  const tags = [level === null ? 'Home' : LEVELS[level]]
  if (built.has(id)) {
    const { length } = trackStats(practiceTrack(id))
    tags.push((length / 1000).toFixed(1) + ' km')
  }
  return tags.join(' · ')
}

// ---------- PAGE ----------
document.querySelector('#app')!.innerHTML = `
<header class="top">
  <div class="brand">CRASH<span>LAB</span></div>
  <nav class="tabs" role="tablist">
    <button class="tab" data-tab="garage" role="tab">Garage</button>
    <button class="tab" data-tab="practice" role="tab">Practice</button>
    <button class="tab" disabled title="Race day comes next">Race<small>soon</small></button>
  </nav>
  <div class="chip" id="chip"></div>
</header>
<main class="layout">
  <section class="view">
    <div class="screen">
      <canvas id="track" width="${W}" height="${H}"></canvas>
    </div>
    <div class="strip" id="strip"></div>
    <div class="graph" id="graphBox"><canvas id="graph" width="800" height="170"></canvas></div>
  </section>
  <aside class="side">
    <div id="garage" class="side">
      <div class="panel name">
        <input id="name" maxlength="24" aria-label="Car name" spellcheck="false" />
      </div>
      <div class="panel">
        <h2><span class="n">01</span>Sensors<span class="aside" id="weights"></span></h2>
        <label class="row"><span>Rays</span><input type="range" id="count" min="${LIMITS.count[0]}" max="${LIMITS.count[1]}" step="1" /><output id="countOut"></output></label>
        <label class="row"><span>Spread</span><input type="range" id="spread" min="${LIMITS.spread[0]}" max="${LIMITS.spread[1]}" step="5" /><output id="spreadOut"></output></label>
        <label class="row"><span>Range</span><input type="range" id="range" min="${LIMITS.range[0]}" max="${LIMITS.range[1]}" step="10" /><output id="rangeOut"></output></label>
        <p class="tip">More rays see more, but every ray adds weights for training to find.</p>
      </div>
      <div class="panel">
        <h2><span class="n">02</span>Car setup</h2>
        <label class="row trade"><span>Grip</span><input type="range" id="balance" min="0" max="100" step="5" aria-label="Grip or top speed" /><span>Speed</span></label>
        <div class="stats">
          <div class="stat">Top speed<div class="bar amber"><i id="speedBar"></i></div><b id="speedOut"></b></div>
          <div class="stat">Cornering<div class="bar"><i id="gripBar"></i></div><b id="gripOut"></b></div>
        </div>
        <p class="tip">A fast car has to brake earlier, because the tyres let go sooner.</p>
      </div>
      <div class="panel">
        <h2><span class="n">03</span>Driving style</h2>
        <label class="row"><span>Pace bonus</span><input type="range" id="pace" min="0" max="100" step="5" /><output id="paceOut"></output></label>
        <label class="row"><span>Crash penalty</span><input type="range" id="safety" min="0" max="100" step="5" /><output id="safetyOut"></output></label>
        <label class="row"><span>Smoothness</span><input type="range" id="smooth" min="0" max="100" step="5" /><output id="smoothOut"></output></label>
        <p class="tip">Training always rewards getting round the track. These change what else it cares about.</p>
      </div>
      <div class="panel">
        <h2><span class="n">04</span>Practice tracks<span class="aside" id="pickCount"></span></h2>
        <div class="tracks" id="tracks"></div>
        <p class="tip">Race day uses tracks you have never seen. More practice tracks prepare the car better, but each generation costs more of the budget.</p>
      </div>
      <button class="btn primary wide" id="toPractice">Go to practice →</button>
    </div>
    <div id="practice" class="side">
      <div class="panel">
        <h2>Training<span class="aside" id="trainState">ready</span></h2>
        <div class="budget"><div class="bar"><i id="budgetBar" style="width:0%"></i></div>
          <div class="legend"><span id="budgetUsed"></span><span id="budgetGen"></span></div></div>
        <div class="actions">
          <button class="btn primary" id="train">Start training</button>
          <button class="btn" id="skip" hidden>Skip to the end</button>
        </div>
        <label class="row" style="grid-template-columns:auto 1fr;margin-top:10px"><input type="checkbox" id="watchAll" checked /><span>Watch every generation</span></label>
        <label class="row" style="grid-template-columns:auto 1fr"><span>Watch on</span><select id="watchTrack" aria-label="Practice track to watch"></select></label>
        <p class="tip">Every generation is scored on all your practice tracks, with the blocks moved each time. The screen shows one of them.</p>
        <p class="msg" id="trainMsg"></p>
      </div>
      <div class="panel">
        <h2>Setup<span class="aside"><button class="btn small" id="toGarage">Edit</button></span></h2>
        <dl class="spec" id="spec"></dl>
      </div>
      <div class="panel">
        <h2>Your car</h2>
        <p class="tip" id="carState" style="margin-top:0"></p>
        <div class="actions">
          <select id="driveTrack" aria-label="Track for the test drive"></select>
          <button class="btn" id="testDrive">Test drive</button>
        </div>
        <div class="actions">
          <button class="btn" id="saveCar">Save car</button>
          <button class="btn" id="loadCar">Load car</button>
          <input type="file" id="file" accept=".json,application/json" hidden />
        </div>
        <p class="msg" id="carMsg"></p>
      </div>
    </div>
  </aside>
</main>`

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('track')
const ctx = canvas.getContext('2d')!
const gcanvas = $<HTMLCanvasElement>('graph')
const gctx = gcanvas.getContext('2d')!
const strip = $('strip')

// ---------- TABS ----------
type Tab = 'garage' | 'practice'
function setTab(t: Tab) {
  document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tab === t)
    btn.setAttribute('aria-selected', String(btn.dataset.tab === t))
  })
  $('garage').hidden = t !== 'garage'
  $('practice').hidden = t !== 'practice'
  $('graphBox').hidden = t !== 'practice'
  if (t === 'garage') stopTestDrive()
  renderPractice()
}
document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab as Tab)))
$('toPractice').addEventListener('click', () => setTab('practice'))
$('toGarage').addEventListener('click', () => setTab('garage'))

// ---------- CAMERA ----------
// The camera never rotates. It shows the whole track in the garage, and follows a car when one drives.
const cam = newCamera()

// ---------- GARAGE ----------
const input = (id: string) => $<HTMLInputElement>(id)
const pct = (v: number) => Math.round(v * 100) + '%'
const nameInput = input('name')
nameInput.value = draft.name
nameInput.addEventListener('input', () => {
  draft.name = nameInput.value.trim() || 'Unnamed'
  changed()
})

const b = draft.build
function bindSlider(id: string, get: () => number, set: (v: number) => void, scale = 1) {
  const el = input(id)
  el.value = String(Math.round(get() * scale))
  el.addEventListener('input', () => {
    set(Number(el.value) / scale)
    changed()
  })
}
bindSlider('count', () => b.sensors.count, (v) => (b.sensors.count = v))
bindSlider('spread', () => b.sensors.spread, (v) => (b.sensors.spread = v))
bindSlider('range', () => b.sensors.range, (v) => (b.sensors.range = v))
bindSlider('balance', () => b.balance, (v) => (b.balance = v), 100)
bindSlider('pace', () => b.reward.pace, (v) => (b.reward.pace = v), 100)
bindSlider('safety', () => b.reward.safety, (v) => (b.reward.safety = v), 100)
bindSlider('smooth', () => b.reward.smooth, (v) => (b.reward.smooth = v), 100)

// The practice track picker
const trackGrid = $('tracks')
const thumbs: HTMLCanvasElement[] = []
let focusTrack = b.practice[0] ?? 0 // the track shown on the big screen in the garage
for (let id = 0; id < PRACTICE_COUNT; id++) {
  const btn = document.createElement('button')
  btn.className = 'track'
  btn.type = 'button'
  btn.dataset.id = String(id)
  const thumb = document.createElement('canvas')
  thumb.width = 160
  thumb.height = 100
  thumbs.push(thumb)
  const name = document.createElement('span')
  name.className = 'tn'
  name.textContent = TRACK_NAMES[id]
  const tags = document.createElement('span')
  tags.className = 'tt'
  btn.append(thumb, name, tags)
  btn.addEventListener('click', () => {
    const picked = b.practice.indexOf(id)
    focusTrack = id
    if (picked >= 0) {
      if (b.practice.length > LIMITS.practice[0]) b.practice.splice(picked, 1)
    } else if (b.practice.length < LIMITS.practice[1]) {
      b.practice.push(id)
      b.practice.sort((x, y) => x - y)
    }
    changed()
  })
  trackGrid.appendChild(btn)
}
// Tracks take a moment to build, so the thumbnails fill in one per frame
const thumbsLeft = Array.from({ length: PRACTICE_COUNT }, (_, i) => i)
function buildOneThumb() {
  const id = thumbsLeft.shift()
  if (id === undefined) return
  drawThumb(thumbs[id], practiceTrack(id))
  built.add(id)
  renderGarage()
}

// The fewest generations the budget allows (more when early cars crash quickly)
const estGenerations = (build: Build) => Math.floor(TRAINING_BUDGET / (POPULATION * build.practice.length * MAX_STEPS))

function renderGarage() {
  const spec = specOf(b)
  $('weights').textContent = genomeLength(shapeOf(b.sensors)) + ' weights'
  $('countOut').textContent = String(b.sensors.count)
  $('spreadOut').textContent = b.sensors.spread + '°'
  $('rangeOut').textContent = String(b.sensors.range)
  $('speedOut').textContent = spec.maxSpeed.toFixed(1)
  $('gripOut').textContent = spec.gripSpeed.toFixed(1)
  $('speedBar').style.width = ((spec.maxSpeed - 4.5) / 3) * 100 + '%'
  $('gripBar').style.width = ((spec.gripSpeed - 2) / 2) * 100 + '%'
  $('paceOut').textContent = pct(b.reward.pace)
  $('safetyOut').textContent = pct(b.reward.safety)
  $('smoothOut').textContent = pct(b.reward.smooth)
  $('pickCount').textContent = b.practice.length + ' of ' + LIMITS.practice[1] + ' picked'
  trackGrid.querySelectorAll<HTMLButtonElement>('.track').forEach((btn) => {
    const id = Number(btn.dataset.id)
    const on = b.practice.includes(id)
    btn.classList.toggle('on', on)
    btn.setAttribute('aria-pressed', String(on))
    btn.querySelector('.tt')!.textContent = trackTags(id)
  })
}

function changed() {
  save(KEYS.draft, draft)
  renderGarage()
  renderChip()
  renderPractice()
}

function renderChip() {
  const chip = $('chip')
  chip.classList.toggle('stale', carIsStale())
  if (!car) {
    chip.textContent = 'No car yet: train one in Practice'
    return
  }
  const label = document.createElement('b')
  label.textContent = car.name
  chip.replaceChildren('CAR ', label, carIsStale() ? ' · setup changed, retrain' : ' · ready')
}

// ---------- TRAINING ----------
type History = { best: number; mean: number }[]
type Finish = { genome: number[]; generations: number }
type Run = { build: Build; name: string; history: History; shown: number; watching: boolean; finish: Finish | null; spent: number }
let worker: Worker | null = null
let run: Run | null = null

type Swarm = { gen: number; trackId: number; track: Track; cars: Car[]; brains: Brain[]; done: boolean[]; hold: number; trails: { x: number; y: number }[][]; lead: number }
let swarm: Swarm | null = null
let waiting: { gen: number; genomes: number[][] } | null = null
const VIEW_STEPS = 900 // each generation is shown for 15 seconds of driving

function trainMsg(text: string, bad = false) {
  const m = $('trainMsg')
  m.textContent = text
  m.classList.toggle('bad', bad)
}

function stopTraining(text: string) {
  worker?.terminate()
  worker = null
  run = null
  swarm = null
  waiting = null
  trainMsg(text)
  renderPractice()
}

function finishTraining(f: Finish) {
  const r = run!
  car = { name: r.name, build: r.build, genome: f.genome }
  carBrain = genomeToBrain(f.genome, shapeOf(r.build.sensors))
  save(KEYS.car, carToJson(car))
  drawGraph(r.history)
  stopTraining('Done: ' + f.generations + ' generations. Here is your car on its first test drive.')
  renderChip()
  startTestDrive()
}

$('train').addEventListener('click', () => {
  if (worker) {
    stopTraining('Training stopped. Your car from before is unchanged.')
    return
  }
  stopTestDrive()
  const watch = input('watchAll').checked
  run = { build: clone(b), name: draft.name, history: [], shown: 0, watching: watch, finish: null, spent: 0 }
  drawGraph([])
  trainMsg(watch ? 'Each generation is shown for 15 seconds of driving.' : 'Training at full speed...')
  worker = new Worker(new URL('./trainWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data
    if (!run) return
    if (m.type === 'progress') {
      run.history.push({ best: m.best, mean: m.mean })
      run.spent = m.spent
      if (run.watching) waiting = { gen: m.generation, genomes: m.population }
      else {
        run.shown = run.history.length
        drawGraph(run.history)
      }
      renderPractice()
    } else if (m.type === 'done') {
      run.finish = { genome: m.genome, generations: m.generations }
      if (!run.watching) finishTraining(run.finish)
    }
  }
  worker.onerror = () => stopTraining('Training failed. Try again.')
  worker.postMessage({ type: 'start', build: run.build, seed: Math.floor(Math.random() * 1e9), watch })
  renderPractice()
})

$('skip').addEventListener('click', () => {
  if (!worker || !run || !run.watching) return
  run.watching = false
  swarm = null
  waiting = null
  run.shown = run.history.length
  drawGraph(run.history)
  trainMsg('Skipping ahead: spending the rest of the budget...')
  worker.postMessage({ type: 'free' })
  if (run.finish) finishTraining(run.finish)
  renderPractice()
})

// The practice track the generations are shown on (scoring always uses all of them)
const watchSelect = $<HTMLSelectElement>('watchTrack')
function renderWatchOptions() {
  const ids = run?.build.practice ?? b.practice
  const keep = Number(watchSelect.value)
  watchSelect.replaceChildren(...ids.map((id) => new Option(TRACK_NAMES[id], String(id))))
  watchSelect.value = String(ids.includes(keep) ? keep : ids[0])
}

function makeSwarm(gen: number, genomes: number[][], build: Build): Swarm {
  const shape = shapeOf(build.sensors)
  const spec = specOf(build)
  const trackId = Number(watchSelect.value)
  const track = practiceTrack(trackId)
  const brains = genomes.map((g) => genomeToBrain(g, shape))
  const cars = brains.map(() => createCar(track, spec))
  return { gen, trackId, track, cars, brains, done: brains.map(() => false), hold: 0, trails: cars.map((c) => [{ x: c.x, y: c.y }]), lead: 0 }
}

function stepSwarm() {
  if (!worker || !run) return
  const over = swarm !== null && swarm.done.every(Boolean)
  if (swarm && over) {
    swarm.hold++ // linger a moment so the end of the generation can be seen
    if (swarm.hold < 20) return
  }
  if (!swarm || over) {
    if (waiting) {
      swarm = makeSwarm(waiting.gen, waiting.genomes, run.build)
      waiting = null
      if (run.watching) {
        run.shown = swarm.gen + 1
        drawGraph(run.history.slice(0, run.shown))
        if (!run.finish) worker.postMessage({ type: 'next' })
        follow(cam, swarm.cars[0], true)
      }
    } else if (run.watching && run.finish) {
      finishTraining(run.finish)
      return
    }
  }
  if (!swarm) return
  // the fewer cars are left, the faster time runs (so the work per frame stays about the same)
  const sw = swarm
  const alive = sw.done.filter((d) => !d).length
  const steps = Math.min(12, Math.max(6, Math.round(600 / Math.max(alive, 1))))
  for (let k = 0; k < steps; k++) {
    sw.cars.forEach((c, i) => {
      if (sw.done[i]) return
      drive(c, sw.brains[i])
      const trail = sw.trails[i]
      trail.push({ x: c.x, y: c.y })
      if (trail.length > 40) trail.shift()
      if (c.dead || c.steps >= VIEW_STEPS || c.sinceProgress >= STALL_STEPS) sw.done[i] = true
    })
  }
  pickLead(sw)
}

// The camera follows the car furthest round the track. It only switches when that car stops,
// or another gets clearly ahead, so the view does not flick between cars side by side.
function pickLead(sw: Swarm) {
  let best = -1
  sw.cars.forEach((c, i) => {
    if (!sw.done[i] && (best < 0 || c.passed > sw.cars[best].passed)) best = i
  })
  if (best < 0) return
  const current = sw.cars[sw.lead]
  if (sw.done[sw.lead] || sw.cars[best].passed > current.passed + 2) sw.lead = best
}

// ---------- TEST DRIVE ----------
type TestDrive = { track: Track; car: Car; lastLap: number | null; bestLap: number | null; crashFrames: number; crashAt: { x: number; y: number } | null }
let test: TestDrive | null = null
const driveSelect = $<HTMLSelectElement>('driveTrack')
TRACK_NAMES.forEach((n, i) => driveSelect.add(new Option(n, String(i))))

function startTestDrive() {
  if (!car || !carBrain) return
  const track = practiceTrack(Number(driveSelect.value))
  test = { track, car: createCar(track, specOf(car.build)), lastLap: null, bestLap: null, crashFrames: 0, crashAt: null }
  follow(cam, test.car, true)
  renderPractice()
}
function stopTestDrive() {
  test = null
  renderPractice()
}
$('testDrive').addEventListener('click', () => (test ? stopTestDrive() : startTestDrive()))
driveSelect.addEventListener('change', () => {
  if (test) startTestDrive()
})

function tickTestDrive() {
  if (!test || !car || !carBrain) return
  if (test.crashFrames > 0) {
    if (--test.crashFrames === 0) {
      test.car = createCar(test.track, specOf(car.build))
      follow(cam, test.car, true)
    }
    return
  }
  drive(test.car, carBrain)
  if (test.car.passed >= CHECKPOINTS) {
    test.lastLap = test.car.steps / 60
    test.bestLap = test.bestLap === null ? test.lastLap : Math.min(test.bestLap, test.lastLap)
    test.car = createCar(test.track, specOf(car.build))
  } else if (test.car.dead || test.car.sinceProgress >= STALL_STEPS) {
    test.crashAt = { x: test.car.x, y: test.car.y }
    test.crashFrames = 60
  }
}

// ---------- SAVE AND LOAD ----------
function carMsg(text: string, bad = false) {
  const m = $('carMsg')
  m.textContent = text
  m.classList.toggle('bad', bad)
}
$('saveCar').addEventListener('click', () => {
  if (!car) return
  const url = URL.createObjectURL(new Blob([carToJson(car)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = (car.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'car') + '.json'
  a.click()
  URL.revokeObjectURL(url)
  carMsg('Saved ' + a.download + '.')
})
const fileInput = $<HTMLInputElement>('file')
$('loadCar').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return
  const result = carFromJson(await file.text())
  if ('error' in result) {
    carMsg(result.error, true)
    return
  }
  if (worker) stopTraining('')
  save(KEYS.car, carToJson(result))
  // the garage takes on the loaded car's setup, so it is not marked as changed
  save(KEYS.draft, { name: result.name, build: result.build })
  location.reload() // the simplest way to refresh every control from the loaded setup
})

// ---------- PRACTICE PANEL ----------
function renderPractice() {
  renderWatchOptions()
  const training = !!worker
  const spent = run?.spent ?? 0
  $('budgetBar').style.width = (100 * spent) / TRAINING_BUDGET + '%'
  $('budgetUsed').textContent = (spent / 1e6).toFixed(1) + ' of ' + (TRAINING_BUDGET / 1e6).toFixed(0) + 'M steps'
  $('budgetGen').textContent = run ? 'generation ' + run.history.length : 'at least ' + estGenerations(b) + ' generations'
  $('trainState').textContent = training ? (run?.watching ? 'watching' : 'training') : 'ready'
  $('train').textContent = training ? 'Stop' : car ? 'Train a new car' : 'Start training'
  $('skip').hidden = !(training && run?.watching)
  const spec = specOf(b)
  const rows: [string, string][] = [
    ['Sensors', b.sensors.count + ' rays · ' + b.sensors.spread + '° · range ' + b.sensors.range],
    ['Brain', genomeLength(shapeOf(b.sensors)) + ' weights'],
    ['Top speed · cornering', spec.maxSpeed.toFixed(1) + ' · ' + spec.gripSpeed.toFixed(1)],
    ['Pace · crash · smooth', pct(b.reward.pace) + ' · ' + pct(b.reward.safety) + ' · ' + pct(b.reward.smooth)],
    ['Practice', b.practice.map((id) => TRACK_NAMES[id]).join(', ')],
  ]
  $('spec').replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt')
      dt.textContent = k
      const dd = document.createElement('dd')
      dd.textContent = v
      return [dt, dd]
    }),
  )
  const state = $('carState')
  state.classList.toggle('warn', carIsStale())
  state.textContent = !car
    ? 'No car yet. Training builds one from the setup above.'
    : carIsStale()
      ? car.name + ' was trained with a different setup. Train again to use the new one.'
      : car.name + ' is trained and ready.'
  $<HTMLButtonElement>('testDrive').disabled = !car || training
  $('testDrive').textContent = test ? 'Stop driving' : 'Test drive'
  $<HTMLButtonElement>('saveCar').disabled = !car
}

// ---------- THE LEARNING GRAPH ----------
function drawGraph(history: History) {
  const Wg = gcanvas.width
  const Hg = gcanvas.height
  const left = 48
  const right = Wg - 16
  const top = 30
  const bottom = Hg - 22
  gctx.fillStyle = COL.ground
  gctx.fillRect(0, 0, Wg, Hg)
  gctx.font = '700 13px "Barlow Condensed", sans-serif'
  gctx.fillStyle = COL.muted
  gctx.textAlign = 'left'
  gctx.textBaseline = 'alphabetic'
  gctx.fillText('SCORE PER GENERATION', left, 18)
  gctx.fillStyle = COL.accent
  gctx.fillText('— BEST CAR', left + 150, 18)
  gctx.fillStyle = COL.tele
  gctx.fillText('— AVERAGE CAR', left + 228, 18)
  const maxY = Math.max(20, ...history.map((h) => h.best)) * 1.1
  const minY = Math.min(0, ...history.map((h) => h.mean))
  const n = Math.max(history.length, 10)
  const x = (i: number) => left + (i / (n - 1)) * (right - left)
  const y = (v: number) => bottom - ((v - minY) / (maxY - minY)) * (bottom - top)
  gctx.font = '11px "JetBrains Mono", monospace'
  gctx.textAlign = 'right'
  gctx.textBaseline = 'middle'
  const stepY = maxY > 150 ? 50 : maxY > 60 ? 20 : 10
  for (let v = 0; v <= maxY; v += stepY) {
    gctx.strokeStyle = COL.road
    gctx.lineWidth = 1
    gctx.beginPath()
    gctx.moveTo(left, y(v))
    gctx.lineTo(right, y(v))
    gctx.stroke()
    gctx.fillStyle = COL.muted
    gctx.fillText(String(v), left - 8, y(v))
  }
  if (history.length === 0) {
    gctx.textAlign = 'center'
    gctx.fillText('Start training and the scores appear here.', (left + right) / 2, (top + bottom) / 2)
    return
  }
  const line = (vals: number[], colour: string, width: number) => {
    gctx.strokeStyle = colour
    gctx.lineWidth = width
    gctx.beginPath()
    vals.forEach((v, i) => (i === 0 ? gctx.moveTo(x(i), y(v)) : gctx.lineTo(x(i), y(v))))
    gctx.stroke()
  }
  line(history.map((h) => h.mean), COL.tele, 2)
  line(history.map((h) => h.best), COL.accent, 2.5)
  const last = history[history.length - 1]
  gctx.textAlign = 'right'
  gctx.textBaseline = 'bottom'
  gctx.fillStyle = COL.accent
  gctx.fillText(last.best.toFixed(1), right, Math.max(top, y(last.best) - 4))
}

// ---------- THE BIG SCREEN ----------
// The car the camera follows: the test-drive car or the lead car of the generation (none in the garage)
function focusCar(): Car | null {
  if (test) return test.car
  if (swarm) return swarm.cars[swarm.lead]
  return null
}
let parkedCache: { key: string; car: Car } | null = null
function parked(): Car {
  const key = JSON.stringify(b.sensors) + b.balance + ':' + focusTrack
  if (!parkedCache || parkedCache.key !== key) parkedCache = { key, car: createCar(practiceTrack(focusTrack), specOf(b)) }
  return parkedCache.car
}

function hudText(text: string, x: number, y: number, size: number, colour: string = COL.text, align: CanvasTextAlign = 'left') {
  ctx.font = '700 ' + size + 'px "Barlow Condensed", sans-serif'
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = colour
  ctx.fillText(text, x, y)
}
const time = (s: number | null) => (s === null ? '--.--' : s.toFixed(2))

let lastStrip = ''
function setStrip(cells: [string, string][]) {
  const html = cells.map(([k, v]) => '<div class="cell"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>').join('')
  if (html === lastStrip) return
  lastStrip = html
  strip.innerHTML = html
}

function draw() {
  clear(ctx)
  const target = focusCar()
  if (target) follow(cam, target)
  else fit(cam)
  if (swarm && run) {
    const sw = swarm
    withCamera(ctx, cam, () => {
      drawTrack(ctx, sw.track)
      sw.trails.forEach((trail, i) => {
        if (trail.length < 2) return
        ctx.strokeStyle = i === sw.lead ? 'rgba(255,179,26,0.7)' : 'rgba(63,208,255,0.16)'
        ctx.lineWidth = i === sw.lead ? 3 : 2
        ctx.beginPath()
        ctx.moveTo(trail[0].x, trail[0].y)
        for (let k = 1; k < trail.length; k++) ctx.lineTo(trail[k].x, trail[k].y)
        ctx.stroke()
      })
      sw.cars.forEach((c) => c.dead && drawCrash(ctx, c.x, c.y))
      sw.cars.forEach((c, i) => !c.dead && i !== sw.lead && drawCar(ctx, c, 26, 14, COL.swarm))
      drawCar(ctx, sw.cars[sw.lead], 34, 18, COL.accent) // the lead car on top
    })
    drawMinimap(ctx, sw.track, cam, sw.cars[sw.lead], sw.cars.filter((_, i) => !sw.done[i] && i !== sw.lead))
    const alive = sw.done.filter((d) => !d).length
    hudText('GEN ' + (sw.gen + 1), 16, 42, 36)
    hudText('WATCHING ' + TRACK_NAMES[sw.trackId].toUpperCase(), 16, 64, 16, COL.muted)
    hudText('SCORED ON ALL ' + run.build.practice.length + ' PRACTICE TRACKS', 16, 82, 13, COL.muted)
    hudText(alive + ' / ' + sw.cars.length + ' DRIVING', W - 16, H - 16, 18, COL.tele, 'right')
    hudText('FOLLOWING THE LEAD CAR', W - 16, H - 38, 13, COL.accent, 'right')
    setStrip([
      ['Generation', String(sw.gen + 1)],
      ['Budget used', Math.round((100 * run.spent) / TRAINING_BUDGET) + '<small>%</small>'],
      ['Best score', run.history[sw.gen]?.best.toFixed(1) ?? '–'],
      ['Crashed', String(sw.cars.filter((c) => c.dead).length)],
    ])
    return
  }
  if (test) {
    const t = test
    withCamera(ctx, cam, () => {
      drawTrack(ctx, t.track)
      if (t.crashFrames > 0 && t.crashAt) drawCrash(ctx, t.crashAt.x, t.crashAt.y)
      else {
        drawRays(ctx, t.car)
        drawCar(ctx, t.car, 34, 18, COL.accent)
      }
    })
    drawMinimap(ctx, t.track, cam, t.car)
    hudText(time(t.car.steps / 60), 16, 50, 46)
    hudText('LAST ' + time(t.lastLap) + '    BEST ' + time(t.bestLap), 16, 74, 16, COL.muted)
    if (t.crashFrames > 0) hudText('CRASHED', W / 2, H / 2, 40, COL.bad, 'center')
    const speed = Math.max(0, t.car.speed) / t.car.spec.maxSpeed
    ctx.fillStyle = COL.road
    ctx.fillRect(W - 216, H - 28, 200, 10)
    ctx.fillStyle = speed > 0.85 ? COL.bad : COL.tele
    ctx.fillRect(W - 216, H - 28, 200 * speed, 10)
    hudText('SPEED', W - 216, H - 36, 13, COL.muted)
    setStrip([
      ['Lap time', time(t.car.steps / 60) + '<small>s</small>'],
      ['Best lap', time(t.bestLap) + '<small>s</small>'],
      ['Lap progress', Math.round((100 * t.car.passed) / CHECKPOINTS) + '<small>%</small>'],
      ['Speed', (Math.max(0, t.car.speed) * 40).toFixed(0) + '<small> km/h</small>'],
    ])
    return
  }
  // the garage and idle practice: the whole track, with this setup's car on the start line
  const p = parked()
  withCamera(ctx, cam, () => {
    drawTrack(ctx, p.track)
    drawRays(ctx, p)
    drawCar(ctx, p, 34, 18, COL.accent)
  })
  hudText('LAP ' + (trackStats(p.track).length / 1000).toFixed(1) + ' KM', W - 16, 30, 16, COL.muted, 'right')
  const picked = b.practice.includes(focusTrack)
  hudText(TRACK_NAMES[focusTrack].toUpperCase(), 16, 38, 26)
  hudText(picked ? 'PRACTICE TRACK' : 'NOT PICKED', 16, 58, 14, picked ? COL.accent : COL.muted)
  setStrip([
    ['Brain', genomeLength(shapeOf(b.sensors)) + '<small> weights</small>'],
    ['Top speed', specOf(b).maxSpeed.toFixed(1)],
    ['Practice', b.practice.length + '<small> tracks</small>'],
    ['Generations', estGenerations(b) + '<small>+</small>'],
  ])
}

// ---------- THE LOOP ----------
const STEP = 1000 / 60
let lastTime = performance.now()
let owed = 0
function loop(now: number) {
  owed = Math.min(owed + now - lastTime, 250)
  lastTime = now
  while (owed >= STEP) {
    tickTestDrive()
    owed -= STEP
  }
  stepSwarm()
  buildOneThumb()
  draw()
  requestAnimationFrame(loop)
}

renderGarage()
renderChip()
drawGraph([])
setTab('garage')
requestAnimationFrame(loop)
