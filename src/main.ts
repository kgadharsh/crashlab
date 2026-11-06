import './style.css'
import { GOLD_TIME, GRAND_PRIXES, RACE_COUNT, medalFor, raceCar } from './race'
import { carFromChallenge, challengeCode } from './challenge'
import { DEFAULT_BUILD, KEEP_TRAINING_SHARE, LIMITS, POPULATION, REPLAY_EVERY, TRAINING_BUDGET, buildProblem, cleanBuild, genomeLength, shapeOf, specOf, type Build, type Weather } from './setup'
import { CHECKPOINTS, STALL_STEPS, createCar, drive, getInputs, type Brain, type Car } from './sim'
import { think } from './brain'
import { PRACTICE, PRACTICE_COUNT, practiceOnRoad, practiceTrack, trackFeatures, trackStats, type Track } from './track'
import { genomeToBrain } from './genome'
import { carFromJson, carToJson, type CarFile } from './carFile'
import { createLeaderboard } from './leaderboard'
import { createRaceView, loadBest, type Challenge } from './raceView'
import { bestOn, driveLap, loadMedals, parFor, recordLaps, totalStars, type Lap } from './board'
import { LOOKS, isUnlocked, loadLook, nextLook, saveLook } from './looks'
import { hasRaced, logEvent, playtestNotes } from './playLog'
import { COL, H, W, clear, drawBrain, drawCar, drawCrash, drawMinimap, drawRays, drawSensorFan, drawThumb, drawTrack, fanFrame, fit, follow, lookAt, newCamera, withCamera } from './draw'

// ---------- SAVED STATE ----------
const KEYS = { draft: 'crashlab.draft', car: 'crashlab.car', previous: 'crashlab.previous', challenge: 'crashlab.challenge', shelf: 'crashlab.shelf' }
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
// The car before the latest training run, so a run that turns out worse can be undone
const savedPrevious = load<string>(KEYS.previous)
const parsedPrevious = savedPrevious ? carFromJson(savedPrevious) : null
let previousCar: CarFile | null = parsedPrevious && !('error' in parsedPrevious) ? parsedPrevious : null
// The shelf: up to MAX_SLOTS cars kept side by side, so a player can train twice and keep the better car
const MAX_SLOTS = 5
const savedShelf = load<unknown>(KEYS.shelf)
let shelf: CarFile[] = (Array.isArray(savedShelf) ? savedShelf : []).flatMap((t) => {
  const c = typeof t === 'string' ? carFromJson(t) : null
  return c && !('error' in c) ? [c] : []
}).slice(0, MAX_SLOTS)
const saveShelf = () => save(KEYS.shelf, shelf.map(carToJson))
// The car design the player chose (they only change how the car looks)
let look = loadLook()
function rememberPrevious(c: CarFile | null) {
  previousCar = c
  save(KEYS.previous, c ? carToJson(c) : null)
}
// A friend's car to beat, from a challenge link. Its result is worked out on this device, so both cars run on the same engine.
let challenge: Challenge | null = null
function setChallenge(c: CarFile | null) {
  challenge = c ? { car: c, results: GRAND_PRIXES.map((gp) => raceCar(c, gp)) } : null
  save(KEYS.challenge, c ? carToJson(c) : null)
}

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

// The training budget is counted in simulated driving steps, 60 per second. Players see it as hours of driving.
function hours(steps: number) {
  return Math.round(steps / 60 / 3600)
}

// ---------- PAGE ----------
document.querySelector('#app')!.innerHTML = `
<header class="top">
  <div class="brand">CRASH<span>LAB</span></div>
  <nav class="tabs" role="tablist">
    <button class="tab" data-tab="garage" role="tab"><span class="tnum">1</span>Garage</button>
    <button class="tab" data-tab="practice" role="tab"><span class="tnum">2</span>Practice</button>
    <button class="tab" data-tab="race" role="tab"><span class="tnum">3</span>Race</button>
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
      <div class="panel">
        <h2>Your job</h2>
        <p class="tip" style="margin-top:0">Build a car, train its brain on practice tracks, then race it on ${RACE_COUNT} tracks it has never seen. Gold: all ${RACE_COUNT} in under ${GOLD_TIME} s.</p>
        <p class="tip">Not sure where to start? The setup below finished all ${RACE_COUNT} dry-road race tracks in all 7 of our test trainings. Train with it, then change one thing at a time to see what it does.</p>
        <div class="actions"><button class="btn small primary" id="toPracticeTop">Train with this setup →</button></div>
      </div>
      <div class="panel name">
        <input id="name" maxlength="24" aria-label="Car name" spellcheck="false" />
      </div>
      <div class="panel">
        <h2>Car design<span class="aside" id="starCount"></span></h2>
        <div class="looks" id="looks"></div>
        <p class="tip" id="lookTip"></p>
      </div>
      <div class="panel">
        <h2><span class="n">01</span>Sensors<span class="aside" id="weights"></span></h2>
        <label class="row"><span>Eyes (rays)</span><input type="range" id="count" min="${LIMITS.count[0]}" max="${LIMITS.count[1]}" step="1" /><output id="countOut"></output></label>
        <label class="row"><span>View width</span><input type="range" id="spread" min="${LIMITS.spread[0]}" max="${LIMITS.spread[1]}" step="5" /><output id="spreadOut"></output></label>
        <p class="tip">Rays are the car's eyes: each one is a line that measures the distance to the road edge or a block. More rays show more, but the brain has more to learn, so training needs more rounds. View width is how wide the rays fan out: wide sees bends sooner, narrow sees straight ahead in more detail.</p>
      </div>
      <div class="panel">
        <h2><span class="n">02</span>Car setup</h2>
        <label class="row trade"><span>Grip</span><input type="range" id="balance" min="0" max="100" step="5" aria-label="Grip or top speed" /><span>Speed</span></label>
        <div class="stats">
          <div class="stat">Top speed<div class="bar amber"><i id="speedBar"></i></div><b id="speedOut"></b></div>
          <div class="stat">Cornering<div class="bar"><i id="gripBar"></i></div><b id="gripOut"></b></div>
        </div>
        <p class="tip">Grip takes bends harder; speed is quicker on the straights. A fast car has to brake earlier, because the tyres let go sooner. In our tests a very fast car crashed too often to finish all ${RACE_COUNT} race tracks.</p>
      </div>
      <div class="panel">
        <h2><span class="n">03</span>What to reward</h2>
        <label class="row"><span>Reward speed</span><input type="range" id="pace" min="0" max="100" step="5" /><output id="paceOut"></output></label>
        <label class="row"><span>Punish crashes</span><input type="range" id="safety" min="0" max="100" step="5" /><output id="safetyOut"></output></label>
        <label class="row"><span>Punish jerky steering</span><input type="range" id="smooth" min="0" max="100" step="5" /><output id="smoothOut"></output></label>
        <p class="tip">Training always rewards getting round the track. These sliders add extras. Reward speed pushes the car to go faster and take more risks. Punish crashes makes it drive more carefully. Punish jerky steering makes it steer smoothly. In our tests the sliders did not clearly help or hurt, so zero is a fine start.</p>
      </div>
      <div class="panel">
        <h2><span class="n">04</span>Practice tracks<span class="aside" id="pickCount"></span></h2>
        <label class="row" style="grid-template-columns:auto 1fr"><span>Road</span><select id="weather" aria-label="Road the practice tracks are driven on"><option value="dry">Dry</option><option value="wet">Wet</option></select></label>
        <p class="tip" style="margin-top:2px">Grand Prix 2 is raced on a wet road. A car practised only on dry roads loses most of its grip there, so practise on wet roads to prepare for it.</p>
        <div class="tracks" id="tracks"></div>
        <p class="tip">Race day uses tracks you have never seen. More practice tracks prepare the car better, but each round uses more of the run's practice budget, so you get fewer rounds.</p>
      </div>
      <button class="btn primary wide" id="toPractice">Go to practice →</button>
    </div>
    <div id="practice" class="side">
      <div class="panel">
        <h2>Training<span class="aside" id="trainState">ready</span></h2>
        <div class="budget"><div class="bar"><i id="budgetBar" style="width:0%"></i></div>
          <div class="legend"><span id="budgetUsed"></span><span id="budgetGen"></span></div></div>
        <p class="tip">Practice budget: every run gets the same ${hours(TRAINING_BUDGET)} hours of simulated driving, shared by all ${POPULATION} cars and your practice tracks. It is counted in driving, not seconds, so a faster device gets no advantage. More practice tracks use it up faster, so you get fewer rounds. Every new run starts with a full budget; Keep training uses ${Math.round(KEEP_TRAINING_SHARE * 100)}% of it.</p>
        <div class="actions">
          <button class="btn primary" id="train">Start training</button>
          <button class="btn" id="keep">Keep training</button>
          <button class="btn" id="skip" hidden>Skip to the end</button>
        </div>
        <p class="tip" id="keepHint" style="margin-top:8px"></p>
        <label class="row" style="grid-template-columns:auto 1fr;margin-top:10px"><input type="checkbox" id="watchAll" checked /><span>Replay every ${REPLAY_EVERY}th round</span></label>
        <label class="row" style="grid-template-columns:auto 1fr"><input type="checkbox" id="bestOnly" /><span>Show only the best car (lighter on phones)</span></label>
        <label class="row" style="grid-template-columns:auto 1fr"><span>Watch on</span><select id="watchTrack" aria-label="Practice track to watch"></select></label>
        <p class="tip">Training goes in rounds. In each round, ${POPULATION} cars drive all your practice tracks, with the blocks moved each time. The best 10 carry over unchanged and the rest are children of good cars, with small random changes. The screen shows one track.</p>
        <p class="msg" id="trainMsg"></p>
        <p class="tip" id="trainTip" hidden></p>
      </div>
      <div class="panel" id="boardPanel">
        <h2>Track board<span class="aside" id="boardCount"></span></h2>
        <div class="board" id="board"></div>
        <p class="tip" id="boardNext"></p>
        <p class="tip" id="boardStars"></p>
      </div>
      <div class="panel">
        <h2>Setup<span class="aside"><button class="btn small" id="toGarage">Edit</button></span></h2>
        <dl class="spec" id="spec"></dl>
      </div>
      <div class="panel">
        <h2>Your car</h2>
        <p class="tip" id="carState" style="margin-top:0"></p>
        <p class="tip">During a test drive, the box in the corner shows what the car sees (its rays), thinks (five neurons) and does (steering and gas).</p>
        <div class="actions">
          <select id="driveTrack" aria-label="Track for the test drive"></select>
          <button class="btn" id="testDrive">Test drive</button>
        </div>
        <div class="actions">
          <button class="btn" id="saveCar">Save car</button>
          <button class="btn" id="loadCar">Load car</button>
          <input type="file" id="file" accept=".json,application/json" hidden />
        </div>
        <div class="actions"><button class="btn" id="swapCar" hidden>Switch to previous car</button></div>
        <div class="actions"><button class="btn" id="shareCar">Copy challenge link</button></div>
        <div class="actions"><button class="btn" id="notes">Copy playtest notes</button></div>
        <input id="shareLink" readonly hidden aria-label="Challenge link" style="width:100%;margin-top:6px" />
        <p class="msg" id="carMsg"></p>
      </div>
      <div class="panel">
        <h2>Car shelf<span class="aside" id="shelfCount"></span></h2>
        <p class="tip" style="margin-top:0">Keep up to ${MAX_SLOTS} cars here, such as two trainings of the same setup, and use whichever races best. Using a shelf car puts your current car back under Switch to previous car.</p>
        <div class="shelf" id="shelf"></div>
        <div class="actions"><button class="btn" id="shelve">Put your car on the shelf</button></div>
      </div>
    </div>
    <div id="race" class="side">
      <div class="panel" id="challengePanel" hidden>
        <h2>Challenge<span class="aside"><button class="btn small" id="challengeClear">Dismiss</button></span></h2>
        <p class="tip" id="challengeLine" style="margin-top:0"></p>
        <p class="tip" id="challengeVs" style="color:var(--text);font-weight:600"></p>
      </div>
      <div class="panel">
        <h2><span id="gpTitle">Grand Prix 1</span><span class="aside">8 secret tracks</span></h2>
        <div class="actions"><button class="btn small primary" id="gp0" aria-pressed="true">Dry road</button><button class="btn small" id="gp1" aria-pressed="false">Wet road</button></div>
        <div class="actions">
          <button class="btn primary wide" id="raceGo">Race your car</button>
          <button class="btn" id="raceSpeed">Speed 4×</button>
          <button class="btn" id="raceSkip">Skip to results</button>
        </div>
        <p class="msg" id="raceMsg"></p>
        <p class="tip" style="margin-top:8px">Your car drives 8 tracks it has never seen, once each. Most tracks finished wins, then the lowest total time. Grand Prix 2 is the same tracks on a wet road.</p>
        <p class="tip" id="medalRules"></p>
      </div>
      <div class="panel" id="boardOnline" hidden>
        <h2>Leaderboard<span class="aside"><button class="btn small primary" id="onlineDry">Dry</button> <button class="btn small" id="onlineWet">Wet</button></span></h2>
        <ol class="tower" id="onlineRows"></ol>
        <p class="tip" id="onlineEmpty" hidden>No cars on this board yet. Be the first.</p>
        <div class="actions"><button class="btn primary" id="onlineEnter">Enter your car</button></div>
        <p class="msg" id="onlineMsg"></p>
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
        <div class="actions"><button class="btn small primary" id="resultGarage">Edit setup in Garage →</button><button class="btn small" id="resultPractice">Go to Practice →</button><button class="btn small" id="resultShare">Challenge a friend</button></div>
        <input id="resultLink" readonly hidden aria-label="Challenge link" style="width:100%;margin-top:6px" />
        <p class="msg" id="resultMsg"></p>
      </div>
      <p class="tip" id="pb"></p>
    </div>
  </aside>
</main>
<div class="nudge" id="raceNudge" role="status" hidden>
  <p id="nudgeText"></p>
  <button class="btn primary" id="nudgeGo">Race<span class="long"> your car</span> →</button>
  <button class="btn small" id="nudgeClose" aria-label="Dismiss">✕</button>
</div>`

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>('track')
const ctx = canvas.getContext('2d')!
const gcanvas = $<HTMLCanvasElement>('graph')
const gctx = gcanvas.getContext('2d')!
const strip = $('strip')

// ---------- RACE NUDGE ----------
// When a training ends, a bar at the bottom of the screen says the car is ready and takes the player to the Race tab.
// Without it, nothing on the Practice screen says that racing is the next step.
const nudge = $('raceNudge')
function showNudge(carName: string) {
  // the second sentence is left out on a phone, where the bar must stay small
  const more = document.createElement('span')
  more.className = 'more'
  more.textContent = ' Race it on ' + RACE_COUNT + ' tracks it has never seen.'
  $('nudgeText').replaceChildren(carName + ' is trained.', more)
  nudge.hidden = false
  document.body.classList.add('has-nudge') // keeps the bar from covering the last panel
}
function hideNudge() {
  nudge.hidden = true
  document.body.classList.remove('has-nudge')
}
$('nudgeGo').addEventListener('click', () => setTab('race'))
$('nudgeClose').addEventListener('click', hideNudge)

// ---------- TABS ----------
type Tab = 'garage' | 'practice' | 'race'
let tab: Tab = 'garage'
function setTab(t: Tab) {
  tab = t
  if (t === 'race') hideNudge()
  if (t === 'garage') renderLooks()
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
$('toPracticeTop').addEventListener('click', () => setTab('practice'))
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
// The road the practice tracks are driven on (a wet road is what Grand Prix 2 is raced on)
const weatherSel = $<HTMLSelectElement>('weather')
weatherSel.addEventListener('change', () => {
  if (weatherSel.value === 'wet') b.weather = 'wet'
  else delete b.weather // dry is the same as nothing
  changed()
})
// A practice track on the road a build practises on
const practiceOn = (id: number, weather?: Weather): Track => practiceOnRoad(id, weather === 'wet')

// The practice track picker
const trackGrid = $('tracks')
const thumbs: HTMLCanvasElement[] = []
let focusTrack = b.practice[0] ?? 0 // the track shown on the big screen in the garage
// The garage screen zooms in on the car's sensors (to choose rays and view width), and shows the whole
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
  $('weights').textContent = genomeLength(shapeOf(b.sensors)) + ' connections'
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
  weatherSel.value = b.weather === 'wet' ? 'wet' : 'dry'
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
type Run = { build: Build; name: string; history: History; watching: boolean; judging: boolean; finish: Finish | null; spent: number; budget: number; keep: boolean; startedAt: number; awayAtStart: number; tipStart: number; secs?: number }

// How long the page has been hidden in all (a phone asleep, another tab in front), so a training's time
// counts only the time it ran on screen. Without this a run left while the phone slept reads as an hour.
let hiddenTotal = 0
let hiddenSince: number | null = document.hidden ? performance.now() : null
const hiddenNow = () => hiddenTotal + (hiddenSince === null ? 0 : performance.now() - hiddenSince)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenSince = performance.now()
  else if (hiddenSince !== null) {
    hiddenTotal += performance.now() - hiddenSince
    hiddenSince = null
  }
})
const runSeconds = (r: Run) => Math.round((performance.now() - r.startedAt - (hiddenNow() - r.awayAtStart)) / 1000)

// Tips shown while training runs, a new one every few seconds. Each one is something that helps
// build a faster car, and none is more than a sentence.
const TIPS = [
  'More practice tracks prepare the car better for tracks it has never seen, but every round then costs more of the budget.',
  'A wide view sees bends sooner. A narrow view sees straight ahead in more detail.',
  'More rays see more, but the brain has more to learn, so training needs more rounds.',
  'A fast car has to brake earlier, because the tyres let go sooner.',
  'Rewarding speed keeps cars moving. Punishing crashes teaches them to take bends carefully.',
  'Blocks catch cars that see them too late. More rays, or a wider view, spot them sooner.',
  'Training has luck in it: the same setup can give a better or a worse car, so it can be worth training it twice.',
  'Race day counts tracks finished first, then total time. Gold needs all ' + RACE_COUNT + ' tracks in under ' + GOLD_TIME + ' seconds.',
  'You can tune your next car in the Garage while this one trains.',
  'Your old car stays yours until the new one finishes, so you can race it on the Race tab in the meantime.',
  'Keep training carries on from your car in about a third of the time, so you can add a practice track or change your style without starting over.',
  'Race day has a wet Grand Prix too. A car practised only on dry roads struggles in the wet, so set Road to Wet in the Garage, or keep a separate car for each.',
]
const TIP_SECONDS = 9
const currentTip = (r: Run) => TIPS[(r.tipStart + Math.floor((performance.now() - r.startedAt) / (TIP_SECONDS * 1000))) % TIPS.length]

let worker: Worker | null = null
let run: Run | null = null
let lastRun: { spent: number; generations: number; budget: number } | null = null // what the finished run used, for the budget panel

type Swarm = { gen: number; genomes: number[][]; bestSteps: number; trackId: number; track: Track; cars: Car[]; brains: Brain[]; done: boolean[]; hold: number; trails: { x: number; y: number }[][]; lead: number; speed: number; owed: number; frames: number; plays: number; rush: number }
let swarm: Swarm | null = null
// The generations picked for replay (every REPLAY_EVERY-th), in order, waiting for their turn on screen.
// If a slow device falls more than MAX_BACKLOG behind, the oldest are dropped.
let waiting: { gen: number; genomes: number[][]; bestSteps: number }[] = []
const MAX_BACKLOG = 4
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
  waiting = []
  trainMsg(text)
  renderPractice()
}

function finishTraining(f: Finish) {
  const r = run!
  lastRun = { spent: r.spent, generations: f.generations, budget: r.budget }
  logEvent({ k: 'train', secs: r.secs ?? runSeconds(r), generations: f.generations, keep: r.keep, wet: r.build.weather === 'wet', rays: r.build.sensors.count, practice: r.build.practice.length })
  if (car) rememberPrevious(car) // the car this run replaces, in case the new one is worse
  // the generations the brain has had in all: carrying on adds to the car's count (unknown if the old car's was)
  const total = r.keep ? (car?.generations !== undefined ? car.generations + f.generations : undefined) : f.generations
  car = { name: r.name, build: r.build, genome: f.genome, ...(total !== undefined ? { generations: total } : {}) }
  carBrain = genomeToBrain(f.genome, shapeOf(r.build.sensors))
  save(KEYS.car, carToJson(car))
  drawGraph(r.history)
  // the test drive only starts if you are watching it; from another tab the car is simply ready
  const here = tab === 'practice'
  const worse = r.keep ? ' If it feels worse, switch back with "Switch to previous car" under Your car.' : ''
  stopTraining('Done: ' + f.generations + ' rounds of training. ' + (here ? 'Here is your car on its first test drive.' : 'Your new car is ready: test drive it in Practice, or race it.') + worse)
  renderChip()
  raceView?.render()
  if (here) startTestDrive()
  if (tab !== 'race') showNudge(car.name)
}

// Keep training carries on from the car you have, so its brain must be the same size as the garage's
const canKeepTraining = () => !!car && genomeLength(shapeOf(b.sensors)) === car.genome.length

// keep: carry on from your car with a share of the budget, instead of starting from random brains
function startTraining(keep: boolean) {
  if (worker) return
  if (keep && !canKeepTraining()) return
  hideNudge()
  stopTestDrive()
  const watch = input('watchAll').checked
  const budget = keep ? TRAINING_BUDGET * KEEP_TRAINING_SHARE : TRAINING_BUDGET
  run = { build: clone(b), name: draft.name, history: [], watching: watch, judging: false, finish: null, spent: 0, budget, keep, startedAt: performance.now(), awayAtStart: hiddenNow(), tipStart: Math.floor(Math.random() * TIPS.length) }
  drawGraph([])
  const pace = watch ? 'Every ' + REPLAY_EVERY + 'th round is replayed here.' : ''
  trainMsg(keep ? 'Carrying on from your car at full speed. ' + pace : watch ? 'Training at full speed. ' + pace : 'Training at full speed...')
  worker = new Worker(new URL('./trainWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data
    if (!run) return
    if (m.type === 'progress') {
      run.history.push({ best: m.checkpoints / CHECKPOINTS, mean: m.meanCheckpoints / CHECKPOINTS })
      run.spent = m.spent
      // training never waits for the screen: the graph follows every generation, and each
      // replayable generation joins the queue to be shown in order
      if (run.watching && m.population) {
        waiting.push({ gen: m.generation, genomes: m.population, bestSteps: m.bestSteps })
        if (waiting.length > MAX_BACKLOG) waiting.shift()
      }
      drawGraph(run.history)
      renderPractice()
    } else if (m.type === 'judging') {
      run.judging = true
      trainMsg('Picking your car: the best 20 drive mirrored and backwards versions of your practice tracks...')
    } else if (m.type === 'done') {
      run.finish = { genome: m.genome, generations: m.generations }
      run.secs = runSeconds(run)
      if (!run.watching) finishTraining(run.finish)
    }
  }
  worker.onerror = () => stopTraining('Training failed. Try again.')
  worker.postMessage({ type: 'start', build: run.build, seed: Math.floor(Math.random() * 1e9), watch, budget, start: keep ? car!.genome : undefined })
  renderPractice()
}

$('train').addEventListener('click', () => {
  if (worker) stopTraining('Training stopped. Your car from before is unchanged.')
  else startTraining(false)
})
$('keep').addEventListener('click', () => startTraining(true))

// Swap back to the car before the latest run (and again, to go forward: the two cars trade places)
$('swapCar').addEventListener('click', () => {
  if (worker || !previousCar || !car) return
  const now = car
  car = previousCar
  carBrain = genomeToBrain(car.genome, shapeOf(car.build.sensors))
  save(KEYS.car, carToJson(car))
  rememberPrevious(now)
  stopTestDrive()
  renderChip()
  raceView?.render()
  carMsg('Switched cars. Your other car is now the previous one.')
})

$('skip').addEventListener('click', () => {
  if (!worker || !run || !run.watching) return
  run.watching = false
  swarm = null
  waiting = []
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

// One car is far lighter to draw than a hundred, so touch screens start with only the best car
// (and it can be switched either way at any time, even mid-replay)
const bestOnly = input('bestOnly')
bestOnly.checked = window.matchMedia('(pointer: coarse)').matches
bestOnly.addEventListener('change', () => {
  if (swarm && run) {
    swarm = makeSwarm(swarm.gen, swarm.genomes, run.build, swarm.bestSteps, swarm.plays)
    follow(cam, swarm.cars[0], true)
  }
})

// Training runs flat out and every REPLAY_EVERY-th generation is replayed, so a replay has
// about as long as those generations take to train (roughly 10 seconds on a laptop) and then
// the next one is ready. The worker says how long the best car lasted in practice: a generation
// that crashes early plays at real time (and can be watched), and one that drives the full
// distance plays a little faster than real time (and does not drag).
const SHOW_FRAMES = 420 // a replay is paced to fill about 7 seconds, a little under the time ten generations take to train...
const MAX_CLIP_FRAMES = 480 // ...so it ends before this. One still running at 8 seconds (a slow screen) eases into a fast-forward so the queue keeps up
const MAX_SPEED = 12 // simulated steps per frame
const RAMP_FRAMES = 90 // the fast-forward eases in over 1.5 seconds, so the speed never jumps
const paceFor = (bestSteps: number) => Math.min(MAX_SPEED, Math.max(1, Math.min(bestSteps, VIEW_STEPS) / SHOW_FRAMES))

function makeSwarm(gen: number, genomes: number[][], build: Build, bestSteps: number, plays = 0): Swarm {
  const shape = shapeOf(build.sensors)
  const spec = specOf(build)
  const trackId = Number(watchSelect.value)
  const track = practiceOn(trackId, build.weather)
  // best car only: the genomes come best first, so the first one is the generation's best car
  const brains = (input('bestOnly').checked ? genomes.slice(0, 1) : genomes).map((g) => genomeToBrain(g, shape))
  const cars = brains.map(() => createCar(track, spec))
  return { gen, genomes, bestSteps, trackId, track, cars, brains, done: brains.map(() => false), hold: 0, trails: cars.map((c) => [{ x: c.x, y: c.y }]), lead: 0, speed: paceFor(bestSteps), owed: 0, frames: 0, plays, rush: 0 }
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
    const next = waiting.shift()
    if (next) {
      swarm = makeSwarm(next.gen, next.genomes, run.build, next.bestSteps)
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
  // has finished, the rest speeds up to top speed, easing in rather than jumping
  sw.frames += frames
  const late = sw.frames > MAX_CLIP_FRAMES || sw.done[sw.lead] || alive === 0 || !!run.finish
  if (late) sw.rush = Math.min(1, sw.rush + frames / RAMP_FRAMES) // 0 = planned pace, 1 = top speed; it only goes up
  sw.owed += (sw.speed + (MAX_SPEED - sw.speed) * sw.rush) * frames
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
  const track = practiceOn(Number(driveSelect.value), car.build.weather) // a wet-trained car drives its test on a wet road
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

// ---------- STARS, CAR DESIGNS AND THE TRACK BOARD ----------
// Medals earn stars. Stars unlock car designs. The track board shows how the current car drives every practice
// track, which is also how a player sees whether it can win on all of them.
const gpMedals = () =>
  GRAND_PRIXES.map((gp) => {
    const best = loadBest(gp)
    return best ? medalFor(best, gp) : null
  })
const starCount = () => totalStars(loadMedals(), gpMedals())

const lookGrid = $('looks')
const lookButtons: HTMLButtonElement[] = LOOKS.map((l, i) => {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'look'
  const cv = document.createElement('canvas')
  cv.width = 120
  cv.height = 64
  btn.append(cv, document.createElement('span'))
  btn.addEventListener('click', () => {
    if (!isUnlocked(i, starCount())) {
      $('lookTip').textContent = l.name + ' unlocks at ' + l.stars + ' stars. Medals on the Track board (Practice) and in the Grand Prix earn them.'
      return
    }
    look = i
    saveLook(i)
    renderLooks()
  })
  lookGrid.appendChild(btn)
  return btn
})
function renderLooks() {
  const stars = starCount()
  $('starCount').textContent = '★ ' + stars
  lookButtons.forEach((btn, i) => {
    const open = isUnlocked(i, stars)
    btn.classList.toggle('on', i === look)
    btn.classList.toggle('locked', !open)
    btn.setAttribute('aria-pressed', String(i === look))
    const cv = btn.querySelector('canvas')!
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, cv.width, cv.height)
    g.globalAlpha = open ? 1 : 0.3
    drawCar(g, { x: 60, y: 32, angle: 0 }, 78, 42, COL.accent, i)
    g.globalAlpha = 1
    btn.querySelector('span')!.textContent = open ? LOOKS[i].name : LOOKS[i].name + '\n★ ' + LOOKS[i].stars
  })
  const next = nextLook(stars)
  $('lookTip').textContent = next
    ? 'Next design: ' + next.name + ', ' + next.need + ' more stars. A medal on a track is worth 1, 2 or 3 stars (bronze, silver, gold), and a Grand Prix medal 3, 6 or 10.'
    : 'Every design is unlocked.'
}

type Board = { car: CarFile; brain: Brain; laps: (Lap | null)[]; next: number }
let board: Board | null = null
let boardMsg = '' // what the latest laps earned, such as a design unlocked
let boardVersion = 0 // changes whenever the rows would look different, so they are only rebuilt then
let boardShown = -1

// Drive a lap of every practice track with the current car, one every few milliseconds so the page stays smooth
function ensureBoard() {
  if (!car || !carBrain) {
    board = null
    return
  }
  if ((board && board.car.genome === car.genome) || worker) return // already done for this car, or a training is running
  const bd: Board = { car, brain: carBrain, laps: Array(PRACTICE_COUNT).fill(null), next: 0 }
  board = bd
  boardMsg = ''
  boardVersion++
  setTimeout(() => boardStep(bd), 0)
}
function boardStep(bd: Board) {
  if (board !== bd) return // another car has come along
  bd.laps[bd.next] = driveLap(bd.car, bd.brain, bd.next)
  bd.next++
  boardVersion++
  if (bd.next >= PRACTICE_COUNT) finishBoard(bd)
  else setTimeout(() => boardStep(bd), 20)
  renderBoard()
}
function finishBoard(bd: Board) {
  const before = starCount()
  const { gained } = recordLaps(bd.laps as Lap[], bd.car.build.weather === 'wet')
  const after = starCount()
  const unlocked = LOOKS.filter((l) => l.stars > before && l.stars <= after).map((l) => l.name)
  boardMsg = unlocked.length ? 'New design unlocked: ' + unlocked.join(', ') + '. Pick it in the Garage.' : gained ? 'These laps earned ' + gained + ' more stars.' : ''
  boardVersion++
  renderLooks()
}

const dot = (medal: string | null | undefined) => {
  const i = document.createElement('i')
  i.className = 'dot ' + (medal ?? 'none')
  i.title = medal ?? 'no medal'
  return i
}
function renderBoard() {
  if (tab !== 'practice') return
  const wet = car?.build.weather === 'wet'
  const medals = loadMedals()
  const laps = board?.laps ?? []
  const done = laps.filter((l): l is Lap => !!l)
  const finished = done.filter((l) => l.time !== null).length
  $('boardCount').textContent = !car ? '' : done.length < PRACTICE_COUNT ? 'driving laps…' : finished + ' of ' + PRACTICE_COUNT + ' finished'
  const rebuild = boardShown !== boardVersion || !car !== !$('board').querySelector('.brow:not(:disabled)')
  boardShown = boardVersion
  if (rebuild) paintRows()
  paintNotes()
  function paintRows() {
  const head = document.createElement('div')
  head.className = 'bhead'
  head.append(...['TRACK', 'THIS CAR', 'BEST'].map((t) => Object.assign(document.createElement('span'), { textContent: t })))
  $('board').replaceChildren(
    head,
    ...TRACK_NAMES.map((name, id) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'brow'
      row.disabled = !car
      const lap = laps[id]
      const result = document.createElement('span')
      result.className = 'bt' + (lap && lap.time === null ? ' bad' : '')
      result.textContent = !car ? '–' : !lap ? '…' : lap.time !== null ? lap.time.toFixed(1) + ' s' : 'crashed at ' + Math.round(lap.progress * 100) + '%'
      const mine = document.createElement('span')
      mine.className = 'bm'
      mine.append(dot(lap?.medal), result)
      const best = document.createElement('span')
      best.className = 'bb'
      best.append(dot(bestOn(medals, id, wet)?.medal))
      const label = document.createElement('span')
      label.className = 'bn'
      label.textContent = name
      row.append(label, mine, best)
      row.addEventListener('click', () => {
        driveSelect.value = String(id)
        startTestDrive()
      })
      return row
    }),
  )
  }
  function paintNotes() {
  const unmedalled = TRACK_NAMES.findIndex((_, id) => !bestOn(medals, id, wet))
  const noGold = TRACK_NAMES.findIndex((_, id) => bestOn(medals, id, wet)?.medal !== 'gold')
  const target = unmedalled >= 0 ? unmedalled : noGold
  const sweep = car && done.length === PRACTICE_COUNT && finished === PRACTICE_COUNT ? 'Clean sweep: this car finished every track. ' : ''
  $('boardNext').textContent = !car
    ? 'Train a car to see how it drives every track. Tap a track to watch its lap.'
    : sweep +
      (target < 0
        ? 'Gold on every track: the board is mastered.'
        : unmedalled >= 0
          ? 'Next map: ' + TRACK_NAMES[target] + '. Finish a lap there to earn its first medal.'
          : 'Next: ' + TRACK_NAMES[target] + '. Your best is ' + bestOn(medals, target, wet)!.medal + ' (' + bestOn(medals, target, wet)!.time.toFixed(1) + ' s); gold is ' + parFor(target, wet).toFixed(1) + ' s or faster.')
  const stars = starCount()
  const next = nextLook(stars)
  $('boardStars').textContent = (boardMsg ? boardMsg + ' ' : '') + '★ ' + stars + (next ? ' · next design: ' + next.name + ' at ★ ' + (stars + next.need) : ' · every design unlocked')
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

// ---------- CAR SHELF ----------
const carLabel = (c: CarFile) => c.name + ' · ' + c.build.sensors.count + ' rays' + (c.generations ? ' · ' + c.generations + ' rounds' : '') + (c.build.weather === 'wet' ? ' · wet' : '')
function renderShelf() {
  const training = !!worker
  $('shelfCount').textContent = shelf.length + ' of ' + MAX_SLOTS
  $<HTMLButtonElement>('shelve').disabled = !car || shelf.length >= MAX_SLOTS
  $('shelve').textContent = shelf.length >= MAX_SLOTS ? 'Shelf is full' : 'Put your car on the shelf'
  $('shelf').replaceChildren(
    ...shelf.map((c, i) => {
      const row = document.createElement('div')
      row.className = 'slot'
      const label = document.createElement('span')
      label.textContent = carLabel(c)
      const use = document.createElement('button')
      use.className = 'btn small'
      use.textContent = 'Use'
      use.disabled = training
      use.addEventListener('click', () => {
        if (worker) return
        if (car) rememberPrevious(car)
        save(KEYS.car, carToJson(c))
        // the garage takes on the shelf car's setup, as when loading a file
        save(KEYS.draft, { name: c.name, build: c.build })
        location.reload()
      })
      const drop = document.createElement('button')
      drop.className = 'btn small'
      drop.textContent = 'Remove'
      drop.addEventListener('click', () => {
        shelf.splice(i, 1)
        saveShelf()
        renderShelf()
        carMsg('Removed ' + c.name + ' from the shelf.')
      })
      row.append(label, use, drop)
      return row
    }),
  )
}
$('shelve').addEventListener('click', () => {
  if (!car || shelf.length >= MAX_SLOTS) return
  shelf.push(clone(car))
  saveShelf()
  renderShelf()
  carMsg('Put ' + car.name + ' on the shelf.')
})

// ---------- PRACTICE PANEL ----------
function renderPractice() {
  renderWatchOptions()
  const training = !!worker
  const spent = run?.spent ?? lastRun?.spent ?? 0
  const total = run?.budget ?? lastRun?.budget ?? TRAINING_BUDGET
  $('budgetBar').style.width = (100 * spent) / total + '%'
  $('budgetUsed').textContent = hours(spent) + ' of ' + hours(total) + ' hours'
  $('budgetGen').textContent = run
    ? 'round ' + run.history.length
    : lastRun
      ? lastRun.generations + ' rounds · done'
      : 'about ' + estGenerations(b) + ' rounds'
  $('trainState').textContent = training ? (run?.watching ? 'watching' : 'training') : 'ready'
  $('train').textContent = training ? 'Stop' : car ? 'Train a new car' : 'Start training'
  $('skip').hidden = !(training && run?.watching)
  $<HTMLButtonElement>('keep').disabled = training || !canKeepTraining()
  $('keepHint').textContent = !car
    ? 'Keep training carries on from a car, so train one first.'
    : !canKeepTraining()
      ? 'Your car has a different number of rays from the garage, so it cannot be carried on. Train a new car instead.'
      : 'Keep training carries on from your car in about a third of the time. Add practice tracks or change what you reward first, then press it. If the result is worse, switch back under Your car.'
  $('swapCar').hidden = !previousCar
  $<HTMLButtonElement>('swapCar').disabled = training
  const spec = specOf(b)
  const rows: [string, string][] = [
    ['Sensors', b.sensors.count + ' rays over a ' + b.sensors.spread + '° view'],
    ['Brain', genomeLength(shapeOf(b.sensors)) + ' connections'],
    ['Top speed · cornering', spec.maxSpeed.toFixed(1) + ' · ' + spec.gripSpeed.toFixed(1)],
    ['Pace · crash · smooth', pct(b.reward.pace) + ' · ' + pct(b.reward.safety) + ' · ' + pct(b.reward.smooth)],
    ['Practice', b.practice.map((id) => TRACK_NAMES[id]).join(', ')],
    ['Road', b.weather === 'wet' ? 'Wet' : 'Dry'],
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
  $<HTMLButtonElement>('shareCar').disabled = !car
  renderShelf()
  ensureBoard()
  renderBoard()
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
  for (const [text, colour] of [['LAPS DRIVEN IN 40 S, PER ROUND', COL.muted], ['— BEST CAR', COL.accent], ['— AVERAGE CAR', COL.tele]]) {
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
  if (swarm && tab === 'practice') return swarm.cars[swarm.lead] // the Garage keeps its own view while a run goes on
  return null
}
let parkedCache: { key: string; car: Car } | null = null
function parked(): Car {
  const key = JSON.stringify(b.sensors) + b.balance + ':' + focusTrack + ':' + (b.weather ?? 'dry')
  if (!parkedCache || parkedCache.key !== key) parkedCache = { key, car: createCar(practiceOn(focusTrack, b.weather), specOf(b)) }
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

// Centred text that wraps onto more lines to fit a width
function hudWrap(text: string, x: number, y: number, width: number, size: number, colour: string, lineHeight: number) {
  ctx.font = '700 ' + size + 'px "Barlow Condensed", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = colour
  let line = ''
  let top = y
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word
    if (line && ctx.measureText(next).width > width) {
      ctx.fillText(line, x, top)
      line = word
      top += lineHeight
    } else line = next
  }
  if (line) ctx.fillText(line, x, top)
}

// The tip under the Training panel changes every few seconds while a run goes on
const tipEl = $('trainTip')
let tipText = ''
function updateTip() {
  const text = run && !run.judging ? 'Tip: ' + currentTip(run) : ''
  if (text === tipText) return
  tipText = text
  tipEl.textContent = text
  tipEl.hidden = !text
}

// Training with nothing to replay (replays are off, or the first one is not ready yet): a progress
// screen, so it is clear that training is running and how far it has got.
function drawTrainingScreen(r: Run) {
  const gen = r.history.length
  const last = r.history[gen - 1]
  const done = Math.min(1, r.spent / r.budget)
  const cx = W / 2
  const bar = 360
  ctx.strokeStyle = COL.accent // a turning arc, so the screen is clearly alive
  ctx.lineWidth = 3
  ctx.beginPath()
  const turn = performance.now() / 350
  // the text is large because on a phone this whole screen is drawn small
  ctx.arc(cx, H / 2 - 128, 14, turn, turn + 4)
  ctx.stroke()
  hudText(r.judging ? 'PICKING YOUR CAR' : r.keep ? 'CARRYING ON FROM YOUR CAR' : 'TRAINING AT FULL SPEED', cx, H / 2 - 78, 24, COL.accent, 'center')
  hudText('GEN ' + gen, cx, H / 2 - 4, 84, COL.text, 'center')
  ctx.fillStyle = COL.road
  ctx.fillRect(cx - bar / 2, H / 2 + 26, bar, 10)
  ctx.fillStyle = COL.accent
  ctx.fillRect(cx - bar / 2, H / 2 + 26, bar * done, 10)
  hudText(Math.round(100 * done) + '% OF THE BUDGET USED' + (last ? ' · BEST CAR ' + last.best.toFixed(2) + ' LAPS' : ''), cx, H / 2 + 68, 21, COL.muted, 'center')
  if (!r.judging) hudWrap('Tip: ' + currentTip(r), cx, H / 2 + 116, 680, 25, COL.text, 31)
  hudText(r.watching ? 'THE FIRST REPLAY IS ON ITS WAY' : 'REPLAYS ARE OFF FOR THIS RUN · TICK THE BOX BEFORE STARTING TO WATCH THEM', cx, H - 20, 16, COL.muted, 'center')
  setStrip([
    ['Round', String(gen)],
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
  if (swarm && run && tab === 'practice') {
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
      if (!lead.dead) drawCar(ctx, lead, 34, 18, COL.accent, look) // the followed car on top
    })
    drawMinimap(ctx, sw.track, cam, sw.cars[sw.lead], sw.cars.filter((_, i) => !sw.done[i] && i !== sw.lead))
    const alive = sw.done.filter((d) => !d).length
    hudText('GEN ' + (sw.gen + 1), 16, 42, 36)
    hudText('REPLAY ON ' + TRACK_NAMES[sw.trackId].toUpperCase() + ' · TRAINING IS ON GEN ' + run.history.length, 16, 64, 16, COL.muted)
    hudText('SCORED ON ALL ' + run.build.practice.length + ' PRACTICE TRACKS', 16, 82, 13, COL.muted)
    hudText('EACH ROUND IS BRED FROM THE BEST CARS OF THE ROUND BEFORE', 16, 100, 13, COL.muted)
    hudText(sw.cars.length === 1 ? 'BEST OF ' + sw.genomes.length + ' CARS' : alive + ' / ' + sw.cars.length + ' DRIVING', W - 16, H - 16, 18, COL.tele, 'right')
    const status = run.judging
      ? 'TRAINING DONE · PICKING YOUR CAR'
      : sw.plays > 0
        ? 'SHOWING IT AGAIN · THE NEXT REPLAY IS STILL TRAINING'
        : sw.done[sw.lead]
          ? 'BEST CAR STOPPED · FINISHING THE REPLAY'
          : "FOLLOWING THIS ROUND'S BEST CAR"
    hudText(status, W - 16, H - 38, 13, COL.accent, 'right')
    setStrip([
      ['Replaying gen', String(sw.gen + 1)],
      ['Training at gen', String(run.history.length)],
      ['Budget used', Math.round((100 * run.spent) / run.budget) + '<small>%</small>'],
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
        drawCar(ctx, t.car, 34, 18, COL.accent, look)
      }
    })
    drawMinimap(ctx, t.track, cam, t.car)
    if (t.crashFrames === 0 && carBrain) {
      const inputs = getInputs(t.car)
      const thought = think(carBrain, inputs)
      drawBrain(ctx, { inputs, hidden: thought.hidden, outputs: thought.outputs }, W - 296, 12, 284, 132)
    }
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
    drawCar(ctx, p, 34, 18, COL.accent, look)
  })
  if (zoomedIn) {
    hudText(b.sensors.count + ' RAYS', 16, 38, 26)
    hudText(b.sensors.spread + '° VIEW · RANGE ' + p.spec.rayRange, 16, 58, 14, COL.accent)
    hudText(TRACK_NAMES[focusTrack].toUpperCase() + ' · START LINE', 16, 76, 13, COL.muted)
    hudText('PICK A TRACK BELOW TO SEE IT WHOLE', W - 16, H - 16, 13, COL.muted, 'right')
  } else {
    hudText(trackLine(focusTrack), W - 16, 30, 14, COL.muted, 'right')
    const picked = b.practice.includes(focusTrack)
    hudText(TRACK_NAMES[focusTrack].toUpperCase(), 16, 38, 26)
    hudText(picked ? 'PRACTICE TRACK' : 'NOT PICKED', 16, 58, 14, picked ? COL.accent : COL.muted)
    if (tab === 'garage') hudText('MOVE RAYS OR VIEW WIDTH TO ZOOM BACK IN ON THE CAR', W - 16, H - 16, 13, COL.muted, 'right')
  }
  setStrip([
    ['Brain', genomeLength(shapeOf(b.sensors)) + '<small> connections</small>'],
    ['Top speed', specOf(b).maxSpeed.toFixed(1)],
    ['Practice', b.practice.length + '<small> tracks</small>'],
    ['Rounds', '~' + estGenerations(b)],
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
  updateTip()
  stepSwarm(Math.min(elapsed / STEP, 6)) // below 10 frames a second the replay slows down rather than stalling the screen
  buildOneThumb()
  draw()
  requestAnimationFrame(loop)
}

raceView = createRaceView({ ctx, cam, getCar: () => car, isStale: carIsStale, getChallenge: () => challenge, getLook: () => look, goTo: setTab, hudText, setStrip })
createLeaderboard(() => car)

// ---------- CHALLENGE LINKS ----------
// Share: the car goes into a link, so a friend can race it with no server.
// It is offered under Your car in Practice, and under the result of a race, where the wish to show it off is greatest.
async function shareCar(say: (text: string) => void, box: HTMLInputElement) {
  if (!car) return
  const link = location.origin + location.pathname + challengeCode(car)
  try {
    await navigator.clipboard.writeText(link)
    logEvent({ k: 'share' })
    box.hidden = true
    say('Challenge link copied. Anyone who opens it can race ' + car.name + ' on the Grand Prix and try to beat it.')
  } catch {
    box.value = link // the browser would not copy for us: show the link to copy by hand
    box.hidden = false
    box.select()
    say('Copy this link and send it. Anyone who opens it can race your car.')
  }
}
$('shareCar').addEventListener('click', () => shareCar(carMsg, $<HTMLInputElement>('shareLink')))
$('resultShare').addEventListener('click', () => shareCar((text) => ($('resultMsg').textContent = text), $<HTMLInputElement>('resultLink')))
// Playtest notes: what happened in this browser, copied to paste into the feedback form. Nothing is sent anywhere.
$('notes').addEventListener('click', async () => {
  const text = playtestNotes(car?.build ?? null, car?.name ?? null)
  // the notes are most useful after a race, and this button sits right under a fresh training
  const raceFirst = hasRaced() ? '' : ' You have not raced yet: race your car on the Race tab first, then copy the notes again.'
  try {
    await navigator.clipboard.writeText(text)
    carMsg('Notes copied. Paste them into the feedback form.' + raceFirst)
  } catch {
    const box = $<HTMLInputElement>('shareLink')
    box.value = text.replace(/\n/g, ' | ')
    box.hidden = false
    box.select()
    carMsg('Copy this text into the feedback form.' + raceFirst)
  }
})
// Receive: a link brings a car to beat, or one remembered from earlier is brought back
function takeChallenge() {
  const fromLink = carFromChallenge(location.hash)
  if (fromLink) {
    history.replaceState(null, '', location.pathname + location.search) // the long code is not left in the address bar
    if ('error' in fromLink) challenge = fromLink
    else setChallenge(fromLink)
    setTab('race')
    raceView?.render()
    return
  }
  const text = load<string>(KEYS.challenge)
  const saved = text ? carFromJson(text) : null
  if (saved && !('error' in saved)) challenge = { car: saved, results: GRAND_PRIXES.map((gp) => raceCar(saved, gp)) }
}
$('challengeClear').addEventListener('click', () => {
  challenge = null
  save(KEYS.challenge, null)
  raceView?.render()
})
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#challenge=')) takeChallenge()
})
takeChallenge()
raceView.render()
renderGarage()
renderLooks()
renderChip()
drawGraph([])
// the graph is only redrawn when it changes, so redraw it once the web fonts have arrived
void document.fonts?.ready.then(() => drawGraph(run ? run.history : lastHistory))
setTab(tab) // the Garage, unless a challenge link has already sent the player to the Race tab
requestAnimationFrame(loop)
