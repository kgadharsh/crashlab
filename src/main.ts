import './style.css'
import { DEFAULT_BUILD, LIMITS, POPULATION, REPLAY_EVERY, TRAINING_BUDGET, buildProblem, cleanBuild, genomeLength, shapeOf, specOf, type Build } from './setup'
import { CHECKPOINTS, STALL_STEPS, createCar, drive, type Brain, type Car } from './sim'
import { PRACTICE, PRACTICE_COUNT, practiceTrack, trackFeatures, trackStats, type Track } from './track'
import { genomeToBrain } from './genome'
import { carFromJson, carToJson, type CarFile } from './carFile'
import { createRaceView } from './raceView'
import { COL, H, W, clear, drawCar, drawCrash, drawMinimap, drawRays, drawSensorFan, drawThumb, drawTrack, fanFrame, fit, follow, lookAt, newCamera, withCamera } from './draw'

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
    ? { name: savedDraft.name, build: cleanBuild(savedDraft.build) }
    : { name: 'Team Crash', build: clone(DEFAULT_BUILD) }
const savedCar = load<string>(KEYS.car)
const parsedCar = savedCar ? carFromJson(savedCar) : null
let car: CarFile | null = parsedCar && !('error' in parsedCar) ? parsedCar : null
let carBrain: Brain | null = car ? genomeToBrain(car.genome, shapeOf(car.build.sensors)) : null

const sameBuild = (a: Build, c: Build) => JSON.stringify(a) === JSON.stringify(c)
const carIsStale = () => !!car && !sameBuild(car.build, draft.build)

// ---------- TRACK NAMES AND TAGS ----------
const TRACK_NAMES = PRACTICE.map((p) => p.name)
const built = new Set<number>([0])
const km = (px: number) => (px / 1000).toFixed(1) + ' km'
const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's')
// What stands out about a track, measured from its shape (shown once the track is built)
function trackTags(id: number): string {
  if (!built.has(id)) return '…'
  const f = trackFeatures(practiceTrack(id))
  if (f.blocks >= 10) return plural(f.blocks, 'block')
  if (f.longestStraight >= 1500) return km(f.longestStraight) + ' straight'
  if (f.hairpins >= 4) return plural(f.hairpins, 'tight bend')
  if (trackStats(practiceTrack(id)).tightest > 200) return 'wide, fast bends'
  if (f.blocks >= 8) return plural(f.blocks, 'block')
  if (f.hairpins >= 1) return plural(f.hairpins, 'tight bend')
  if (f.longestStraight >= 1000) return km(f.longestStraight) + ' straight'
  return plural(f.blocks, 'block')
}
// Everything about a track, for the big screen
function trackLine(id: number): string {
  const f = trackFeatures(practiceTrack(id))
  return [km(f.length) + ' lap', plural(f.hairpins, 'tight bend'), km(f.longestStraight) + ' straight', plural(f.blocks, 'block')].join(' · ').toUpperCase()
}

// ---------- PAGE ----------
document.querySelector('#app')!.innerHTML = `
<header class="top">
  <div class="brand">CRASH<span>LAB</span></div>
  <nav class="tabs" role="tablist">
    <button class="tab" data-tab="garage" role="tab">Garage</button>
    <button class="tab" data-tab="practice" role="tab">Practice</button>
    <button class="tab" data-tab="race" role="tab">Race</button>
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
        <p class="tip">More rays see more, but every ray adds weights for training to find. A wide spread sees bends sooner; a narrow one sees straight ahead in more detail.</p>
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
        <label class="row" style="grid-template-columns:auto 1fr;margin-top:10px"><input type="checkbox" id="watchAll" checked /><span>Replay every ${REPLAY_EVERY}th generation</span></label>
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
    <div id="race" class="side">
      <div class="panel">
        <h2>Grand Prix 1<span class="aside">8 secret tracks</span></h2>
        <p class="tip" style="margin-top:0">Your car drives 8 tracks it has never seen, once each. Most tracks finished wins, then the lowest total time.</p>
        <p class="tip" id="medalRules"></p>
        <div class="actions">
          <button class="btn primary" id="raceGo">Race your car</button>
          <button class="btn" id="raceSpeed">Speed 4×</button>
          <button class="btn" id="raceSkip">Skip to results</button>
        </div>
        <p class="msg" id="raceMsg"></p>
      </div>
      <div class="panel">
        <h2>Timing<span class="aside" id="raceTotal"></span></h2>
        <ol class="tower" id="tower"></ol>
      </div>
      <div class="panel" id="resultPanel" hidden>
        <h2>Result</h2>
        <div class="medal" id="medal"></div>
        <p class="tip" id="resultLine" style="margin-top:4px"></p>
        <p class="tip warn" id="advice"></p>
      </div>
      <p class="tip" id="pb"></p>
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
type Tab = 'garage' | 'practice' | 'race'
let tab: Tab = 'garage'
function setTab(t: Tab) {
  tab = t
  document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tab === t)
    btn.setAttribute('aria-selected', String(btn.dataset.tab === t))
  })
  $('garage').hidden = t !== 'garage'
  $('practice').hidden = t !== 'practice'
  $('race').hidden = t !== 'race'
  $('graphBox').hidden = t !== 'practice'
  if (t !== 'practice') stopTestDrive()
  renderPractice()
  raceView?.render()
}
document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab as Tab)))
$('toPractice').addEventListener('click', () => setTab('practice'))
$('toGarage').addEventListener('click', () => setTab('garage'))

// ---------- RACE DAY (raceView.ts) ----------
let raceView: ReturnType<typeof createRaceView> | null = null

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
for (const id of ['count', 'spread']) input(id).addEventListener('input', () => (garageView = 'car'))
bindSlider('balance', () => b.balance, (v) => (b.balance = v), 100)
bindSlider('pace', () => b.reward.pace, (v) => (b.reward.pace = v), 100)
bindSlider('safety', () => b.reward.safety, (v) => (b.reward.safety = v), 100)
bindSlider('smooth', () => b.reward.smooth, (v) => (b.reward.smooth = v), 100)

// The practice track picker
const trackGrid = $('tracks')
const thumbs: HTMLCanvasElement[] = []
let focusTrack = b.practice[0] ?? 0 // the track shown on the big screen in the garage
// The garage screen zooms in on the car's sensors (to choose rays and spread), and shows the whole
// track when a track card is clicked (to choose practice tracks). Moving a sensor slider zooms back in.
let garageView: 'car' | 'track' = 'car'
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
    garageView = 'track'
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

// Roughly how many generations the budget buys. Measured 4 Nov 2026: an attempt lasts about
// 700 steps on average over a run (early cars crash fast, later ones drive the full 40 s).
const AVERAGE_ATTEMPT = 700
const estGenerations = (build: Build) => Math.round(TRAINING_BUDGET / (POPULATION * build.practice.length * AVERAGE_ATTEMPT) / 5) * 5

function renderGarage() {
  const spec = specOf(b)
  $('weights').textContent = genomeLength(shapeOf(b.sensors)) + ' weights'
  $('countOut').textContent = String(b.sensors.count)
  $('spreadOut').textContent = b.sensors.spread + '°'
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
type History = { best: number; mean: number }[] // laps driven in one practice attempt: the best car, and the average car
type Finish = { genome: number[]; generations: number }
type Run = { build: Build; name: string; history: History; watching: boolean; judging: boolean; finish: Finish | null; spent: number }
let worker: Worker | null = null
let run: Run | null = null
let lastRun: { spent: number; generations: number } | null = null // what the finished run used, for the budget panel

type Swarm = { gen: number; genomes: number[][]; bestSteps: number; trackId: number; track: Track; cars: Car[]; brains: Brain[]; done: boolean[]; hold: number; trails: { x: number; y: number }[][]; lead: number; speed: number; owed: number; frames: number; plays: number }
let swarm: Swarm | null = null
let waiting: { gen: number; genomes: number[][]; bestSteps: number } | null = null
const VIEW_STEPS = 900 // a replayed generation drives for up to 15 seconds

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
  lastRun = { spent: r.spent, generations: f.generations }
  car = { name: r.name, build: r.build, genome: f.genome }
  carBrain = genomeToBrain(f.genome, shapeOf(r.build.sensors))
  save(KEYS.car, carToJson(car))
  drawGraph(r.history)
  stopTraining('Done: ' + f.generations + ' generations. Here is your car on its first test drive.')
  renderChip()
  raceView?.render()
  startTestDrive()
}

$('train').addEventListener('click', () => {
  if (worker) {
    stopTraining('Training stopped. Your car from before is unchanged.')
    return
  }
  stopTestDrive()
  const watch = input('watchAll').checked
  run = { build: clone(b), name: draft.name, history: [], watching: watch, judging: false, finish: null, spent: 0 }
  drawGraph([])
  trainMsg(watch ? 'Training at full speed. Every ' + REPLAY_EVERY + 'th generation is replayed here.' : 'Training at full speed...')
  worker = new Worker(new URL('./trainWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data
    if (!run) return
    if (m.type === 'progress') {
      run.history.push({ best: m.checkpoints / CHECKPOINTS, mean: m.meanCheckpoints / CHECKPOINTS })
      run.spent = m.spent
      // training never waits for the screen: the graph follows every generation, and the newest
      // replayable generation waits its turn (an older one that was never shown is dropped)
      if (run.watching && m.population) waiting = { gen: m.generation, genomes: m.population, bestSteps: m.bestSteps }
      drawGraph(run.history)
      renderPractice()
    } else if (m.type === 'judging') {
      run.judging = true
      trainMsg('Picking your car: the best 20 drive mirrored and backwards versions of your practice tracks...')
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
  drawGraph(run.history)
  trainMsg('Skipping the replays: finishing the training...')
  if (run.finish) finishTraining(run.finish)
  renderPractice()
})

// The practice track the generations are shown on (scoring always uses all of them).
// The options are only rebuilt when the practice tracks change, so an open list is never
// snapped shut mid-choice. A new choice shows straight away: the current generation is
// replayed on it, and before training the screen shows that track.
const watchSelect = $<HTMLSelectElement>('watchTrack')
let watchOptionsFor = ''
function renderWatchOptions() {
  const ids = run?.build.practice ?? b.practice
  if (ids.join() !== watchOptionsFor) {
    watchOptionsFor = ids.join()
    const keep = Number(watchSelect.value)
    watchSelect.replaceChildren(...ids.map((id) => new Option(TRACK_NAMES[id], String(id))))
    watchSelect.value = String(ids.includes(keep) ? keep : ids[0])
  }
  // outside training, the list follows the track last looked at in the garage
  if (!run && ids.includes(focusTrack) && watchSelect.value !== String(focusTrack)) watchSelect.value = String(focusTrack)
}
watchSelect.addEventListener('change', () => {
  focusTrack = Number(watchSelect.value)
  if (swarm && run) {
    swarm = makeSwarm(swarm.gen, swarm.genomes, run.build, swarm.bestSteps)
    follow(cam, swarm.cars[0], true)
  }
})

// Training runs flat out and every REPLAY_EVERY-th generation is replayed, so a replay has
// about as long as those generations take to train (roughly 10 seconds on a laptop) and then
// the next one is ready. The worker says how long the best car lasted in practice: a generation
// that crashes early plays at real time (and can be watched), and one that drives the full
// distance plays a little faster than real time (and does not drag).
const SHOW_FRAMES = 600 // about 10 seconds per replay
const MAX_SPEED = 12 // simulated steps per frame
const paceFor = (bestSteps: number) => Math.min(MAX_SPEED, Math.max(1, Math.min(bestSteps, VIEW_STEPS) / SHOW_FRAMES))

function makeSwarm(gen: number, genomes: number[][], build: Build, bestSteps: number, plays = 0): Swarm {
  const shape = shapeOf(build.sensors)
  const spec = specOf(build)
  const trackId = Number(watchSelect.value)
  const track = practiceTrack(trackId)
  const brains = genomes.map((g) => genomeToBrain(g, shape))
  const cars = brains.map(() => createCar(track, spec))
  return { gen, genomes, bestSteps, trackId, track, cars, brains, done: brains.map(() => false), hold: 0, trails: cars.map((c) => [{ x: c.x, y: c.y }]), lead: 0, speed: paceFor(bestSteps), owed: 0, frames: 0, plays }
}

// frames: how many 1/60-second frames of real time have passed since the last call. The replay
// runs on the clock, not on the number of frames drawn, so a slow screen (a busy phone) drops
// frames but does not turn the replay into slow motion.
function stepSwarm(frames: number) {
  if (!worker || !run) return
  const over = swarm !== null && swarm.done.every(Boolean)
  if (swarm && over) {
    swarm.hold += frames // linger a moment so the end of the generation can be seen
    if (swarm.hold < 20) return
  }
  if (!swarm || over) {
    if (run.watching && run.finish) {
      // training is over: no more replays, on to the result
      finishTraining(run.finish)
      return
    }
    if (waiting) {
      swarm = makeSwarm(waiting.gen, waiting.genomes, run.build, waiting.bestSteps)
      waiting = null
      follow(cam, swarm.cars[0], true)
    } else if (swarm) {
      // nothing newer is ready yet: show this generation again rather than leave the screen frozen
      swarm = makeSwarm(swarm.gen, swarm.genomes, run.build, swarm.bestSteps, swarm.plays + 1)
      follow(cam, swarm.cars[0], true)
    }
  }
  if (!swarm) return
  // the fewer cars are left, the faster time runs (so the work per frame stays about the same)
  const sw = swarm
  const alive = sw.done.filter((d) => !d).length
  // once the followed car has stopped, or the replay runs past its planned time, or training
  // has finished, the rest plays at top speed
  sw.frames += frames
  const late = sw.frames > SHOW_FRAMES * 1.5 || sw.done[sw.lead] || alive === 0 || !!run.finish
  sw.owed += (late ? MAX_SPEED : sw.speed) * frames
  const steps = Math.floor(sw.owed)
  sw.owed -= steps
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
}
// The camera follows one car per generation, the best one (cars come sorted by their score on
// all the practice tracks), and never switches: if that car crashes, the view stays on the crash.
// So the view only ever moves to a new car when a new generation starts at the start line.

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
  const spent = run?.spent ?? lastRun?.spent ?? 0
  $('budgetBar').style.width = (100 * spent) / TRAINING_BUDGET + '%'
  $('budgetUsed').textContent = (spent / 1e6).toFixed(1) + ' of ' + (TRAINING_BUDGET / 1e6).toFixed(0) + 'M steps'
  $('budgetGen').textContent = run
    ? 'generation ' + run.history.length
    : lastRun
      ? lastRun.generations + ' generations · done'
      : 'about ' + estGenerations(b) + ' generations'
  $('trainState').textContent = training ? (run?.watching ? 'watching' : 'training') : 'ready'
  $('train').textContent = training ? 'Stop' : car ? 'Train a new car' : 'Start training'
  $('skip').hidden = !(training && run?.watching)
  const spec = specOf(b)
  const rows: [string, string][] = [
    ['Sensors', b.sensors.count + ' rays across ' + b.sensors.spread + '°'],
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
let lastHistory: History = [] // the last graph drawn, so it can be redrawn
function drawGraph(history: History) {
  lastHistory = history
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
  // the legend sits after the title, measured, so a wider fallback font never runs into it
  let x0 = left
  for (const [text, colour] of [['LAPS DRIVEN IN 40 S, PER GENERATION', COL.muted], ['— BEST CAR', COL.accent], ['— AVERAGE CAR', COL.tele]]) {
    gctx.fillStyle = colour
    gctx.fillText(text, x0, 18)
    x0 += gctx.measureText(text).width + 16
  }
  const maxY = Math.max(1, ...history.map((h) => h.best)) * 1.1
  const minY = 0
  const n = Math.max(history.length, 10)
  const x = (i: number) => left + (i / (n - 1)) * (right - left)
  const y = (v: number) => bottom - ((v - minY) / (maxY - minY)) * (bottom - top)
  gctx.font = '11px "JetBrains Mono", monospace'
  gctx.textAlign = 'right'
  gctx.textBaseline = 'middle'
  const stepY = maxY > 2.2 ? 1 : 0.5
  for (let v = 0; v <= maxY; v += stepY) {
    gctx.strokeStyle = COL.road
    gctx.lineWidth = 1
    gctx.beginPath()
    gctx.moveTo(left, y(v))
    gctx.lineTo(right, y(v))
    gctx.stroke()
    gctx.fillStyle = COL.muted
    gctx.fillText(v.toFixed(1), left - 8, y(v))
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
  gctx.fillText(last.best.toFixed(2) + ' laps', right, Math.max(top, y(last.best) - 4))
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

// Training with nothing to replay (replays are off, or the first one is not ready yet): a progress
// screen, so it is clear that training is running and how far it has got.
function drawTrainingScreen(r: Run) {
  const gen = r.history.length
  const last = r.history[gen - 1]
  const done = Math.min(1, r.spent / TRAINING_BUDGET)
  const cx = W / 2
  const bar = 360
  ctx.strokeStyle = COL.accent // a turning arc, so the screen is clearly alive
  ctx.lineWidth = 3
  ctx.beginPath()
  const turn = performance.now() / 350
  ctx.arc(cx, H / 2 - 112, 14, turn, turn + 4)
  ctx.stroke()
  hudText(r.judging ? 'PICKING YOUR CAR' : 'TRAINING AT FULL SPEED', cx, H / 2 - 66, 18, COL.accent, 'center')
  hudText('GEN ' + gen, cx, H / 2 - 8, 72, COL.text, 'center')
  ctx.fillStyle = COL.road
  ctx.fillRect(cx - bar / 2, H / 2 + 24, bar, 10)
  ctx.fillStyle = COL.accent
  ctx.fillRect(cx - bar / 2, H / 2 + 24, bar * done, 10)
  hudText(Math.round(100 * done) + '% OF THE BUDGET USED' + (last ? ' · BEST CAR ' + last.best.toFixed(2) + ' LAPS' : ''), cx, H / 2 + 62, 16, COL.muted, 'center')
  hudText(r.watching ? 'THE FIRST REPLAY IS ON ITS WAY' : 'REPLAYS ARE OFF FOR THIS RUN · TICK THE BOX BEFORE STARTING TO WATCH THEM', cx, H - 24, 13, COL.muted, 'center')
  setStrip([
    ['Generation', String(gen)],
    ['Budget used', Math.round(100 * done) + '<small>%</small>'],
    ['Best car', (last ? last.best.toFixed(2) : '–') + '<small> laps</small>'],
    ['Average car', (last ? last.mean.toFixed(2) : '–') + '<small> laps</small>'],
  ])
}

function draw() {
  if (tab === 'race' && raceView) return raceView.draw()
  clear(ctx)
  const target = focusCar()
  // a stopped car needs no look-ahead: the view settles on where it stopped
  const stopped = !!swarm && swarm.done[swarm.lead]
  // in the garage the camera glides in on the car's sensors, or out to the whole track
  const zoomedIn = tab === 'garage' && garageView === 'car'
  if (target) follow(cam, stopped ? { ...target, speed: 0 } : target)
  else if (zoomedIn) {
    const f = fanFrame(parked())
    lookAt(cam, f.x, f.y, f.zoom)
  } else fit(cam, tab !== 'garage')
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
      const lead = sw.cars[sw.lead]
      if (!lead.dead) drawCar(ctx, lead, 34, 18, COL.accent) // the followed car on top
    })
    drawMinimap(ctx, sw.track, cam, sw.cars[sw.lead], sw.cars.filter((_, i) => !sw.done[i] && i !== sw.lead))
    const alive = sw.done.filter((d) => !d).length
    hudText('GEN ' + (sw.gen + 1), 16, 42, 36)
    hudText('REPLAY ON ' + TRACK_NAMES[sw.trackId].toUpperCase() + ' · TRAINING IS ON GEN ' + run.history.length, 16, 64, 16, COL.muted)
    hudText('SCORED ON ALL ' + run.build.practice.length + ' PRACTICE TRACKS', 16, 82, 13, COL.muted)
    hudText(alive + ' / ' + sw.cars.length + ' DRIVING', W - 16, H - 16, 18, COL.tele, 'right')
    const status = run.judging
      ? 'TRAINING DONE · PICKING YOUR CAR'
      : sw.plays > 0
        ? 'SHOWING IT AGAIN · THE NEXT REPLAY IS STILL TRAINING'
        : sw.done[sw.lead]
          ? 'BEST CAR STOPPED · FINISHING THE REPLAY'
          : "FOLLOWING THIS GENERATION'S BEST CAR"
    hudText(status, W - 16, H - 38, 13, COL.accent, 'right')
    setStrip([
      ['Replaying gen', String(sw.gen + 1)],
      ['Training at gen', String(run.history.length)],
      ['Budget used', Math.round((100 * run.spent) / TRAINING_BUDGET) + '<small>%</small>'],
      ['Best car', (run.history[sw.gen]?.best.toFixed(2) ?? '–') + '<small> laps</small>'],
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
  if (run && tab === 'practice') {
    drawTrainingScreen(run)
    return
  }
  // the garage and idle practice: this setup's car on the start line, with its sensors zoomed in on
  // (garage) or the whole track
  const p = parked()
  withCamera(ctx, cam, () => {
    drawTrack(ctx, p.track)
    if (zoomedIn) drawSensorFan(ctx, p, cam.zoom)
    drawRays(ctx, p)
    drawCar(ctx, p, 34, 18, COL.accent)
  })
  if (zoomedIn) {
    hudText(b.sensors.count + ' RAYS', 16, 38, 26)
    hudText(b.sensors.spread + '° SPREAD · RANGE ' + p.spec.rayRange, 16, 58, 14, COL.accent)
    hudText(TRACK_NAMES[focusTrack].toUpperCase() + ' · START LINE', 16, 76, 13, COL.muted)
    hudText('PICK A TRACK BELOW TO SEE IT WHOLE', W - 16, H - 16, 13, COL.muted, 'right')
  } else {
    hudText(trackLine(focusTrack), W - 16, 30, 14, COL.muted, 'right')
    const picked = b.practice.includes(focusTrack)
    hudText(TRACK_NAMES[focusTrack].toUpperCase(), 16, 38, 26)
    hudText(picked ? 'PRACTICE TRACK' : 'NOT PICKED', 16, 58, 14, picked ? COL.accent : COL.muted)
    if (tab === 'garage') hudText('MOVE RAYS OR SPREAD TO ZOOM BACK IN ON THE CAR', W - 16, H - 16, 13, COL.muted, 'right')
  }
  setStrip([
    ['Brain', genomeLength(shapeOf(b.sensors)) + '<small> weights</small>'],
    ['Top speed', specOf(b).maxSpeed.toFixed(1)],
    ['Practice', b.practice.length + '<small> tracks</small>'],
    ['Generations', '~' + estGenerations(b)],
  ])
}

// ---------- THE LOOP ----------
const STEP = 1000 / 60
let lastTime = performance.now()
let owed = 0
function loop(now: number) {
  const elapsed = Math.min(now - lastTime, 250)
  owed = Math.min(owed + now - lastTime, 250)
  lastTime = now
  while (owed >= STEP) {
    tickTestDrive()
    if (tab === 'race') raceView?.tick()
    owed -= STEP
  }
  stepSwarm(Math.min(elapsed / STEP, 6)) // below 10 frames a second the replay slows down rather than stalling the screen
  buildOneThumb()
  draw()
  requestAnimationFrame(loop)
}

raceView = createRaceView({ ctx, cam, getCar: () => car, isStale: carIsStale, hudText, setStrip })
renderGarage()
renderChip()
drawGraph([])
// the graph is only redrawn when it changes, so redraw it once the web fonts have arrived
void document.fonts?.ready.then(() => drawGraph(run ? run.history : lastHistory))
setTab('garage')
requestAnimationFrame(loop)
