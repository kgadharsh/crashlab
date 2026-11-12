import './style.css'
import { GOLD_TIME, GRAND_PRIXES, RACE_COUNT, medalFor, raceCar, type GrandPrix } from './race'
import { SHORT_PREFIX, carFromChallenge, carFromShort, challengeCode, shortCode } from './challenge'
import { DEFAULT_BUILD, CHASSIS, KEEP_TRAINING_SHARE, LIMITS, POPULATION, QUICK_GENERATION_LIMIT, REPLAY_EVERY, TRAINING_BUDGET, buildProblem, cleanBuild, genomeLength, brainShape, specOf, levelOf, maxPractice, maxRays, maxSpread, rivalOf, pointsUsed, POINT_BUDGET, type Build, type Parts } from './setup'
import { CHECKPOINTS, NITRO_STEPS, STALL_STEPS, createCar, drive, getInputs, step, type Brain, type Car } from './sim'
import { think } from './brain'
import { PRACTICE, PRACTICE_COUNT, practiceOnRoad, practiceTrack, trackFeatures, trackStats, type Track } from './track'
import { genomeToBrain } from './genome'
import { carFromJson, carToJson, type CarFile } from './carFile'
import { API, createLeaderboard } from './leaderboard'
import { reveal, setupFolds } from './fold'
import { PERKS, PAINTS, drawMine, hasPerk, loadPaint, paintColour, nextPerk, savePaint, shelfSize, streak, visit } from './perks'
import { renderProfile } from './profile'
import { createSkillTree } from './skilltree'
import { createControls, handBest, handMedal, licence, recordHand } from './driver'
import { cardText, createRaceView, loadBest, type Challenge } from './raceView'
import { bestOn, driveLap, lapMedal, legacyStars, loadMedals, parFor, recordLaps, totalStars, type Lap } from './board'
import { PARTS, newlyUnlocked, type PartId, type Progress } from './parts'
import { LOOKS, isUnlocked, loadLook, nextLook, saveLook } from './looks'
import { counts, hasRaced, logEvent, playtestNotes } from './playLog'
import { COL, H, W, clear, drawBrain, drawCar, drawCrash, drawMinimap, drawRays, drawSensorFan, drawThumb, drawTrack, fanFrame, fitTrack, follow, lookAt, newCamera, withCamera } from './draw'

// ---------- SAVED STATE ----------
const KEYS = { draft: 'crashlab.draft', car: 'crashlab.car', previous: 'crashlab.previous', challenge: 'crashlab.challenge', shelf: 'crashlab.shelf', bestLaps: 'crashlab.bestlaps', lastCurve: 'crashlab.lastcurve' }
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
let carBrain: Brain | null = car ? genomeToBrain(car.genome, brainShape(car.build)) : null
// The car before the latest training run, so a run that turns out worse can be undone
const savedPrevious = load<string>(KEYS.previous)
const parsedPrevious = savedPrevious ? carFromJson(savedPrevious) : null
let previousCar: CarFile | null = parsedPrevious && !('error' in parsedPrevious) ? parsedPrevious : null
// The shelf: up to maxSlots() cars kept side by side, so a player can train twice and keep the better car
const maxSlots = () => shelfSize(5) // a streak perk adds two places (perks.ts)
const savedShelf = load<unknown>(KEYS.shelf)
let shelf: CarFile[] = (Array.isArray(savedShelf) ? savedShelf : []).flatMap((t) => {
  const c = typeof t === 'string' ? carFromJson(t) : null
  return c && !('error' in c) ? [c] : []
}).slice(0, maxSlots())
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
  <div class="brand"><svg class="logo" viewBox="-1 -1 34 34" aria-hidden="true"><rect x="-1" y="-1" width="34" height="34" rx="8" fill="var(--accent)"/><path d="M28 16 15 10.5 4.5 12.5v7L15 21.5z" fill="var(--accent-ink)"/><ellipse cx="14" cy="16" rx="3.4" ry="1.9" fill="var(--accent)"/></svg><span class="word">CRASH<b>LAB</b></span></div>
  <nav class="tabs" role="tablist">
    <button class="tab" data-tab="garage" role="tab"><span class="tnum">1</span>Garage</button>
    <button class="tab" data-tab="skills" role="tab"><span class="tnum">2</span>Skill tree</button>
    <button class="tab" data-tab="practice" role="tab"><span class="tnum">3</span>Practice</button>
    <button class="tab" data-tab="race" role="tab"><span class="tnum">4</span>Race</button>
    <button class="tab profile" data-tab="profile" role="tab"><span class="pico" aria-hidden="true">☻</span>Profile</button>
  </nav>
  <button type="button" class="btn small primary hot" id="topChallenge" title="Train a car first, then dare a friend to beat it">⚔ Challenge a friend</button>
  <div class="chip" id="chip"></div>
  <button type="button" class="btn small shelfbtn" id="shelfBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="shelfPop" title="Cars you have saved: switch back to any of them">My cars</button>
  <div class="shelfpop" id="shelfPop" role="dialog" aria-label="My cars" hidden>
    <div class="spHead"><b>My cars</b><span id="spCount"></span></div>
    <div class="spNow" id="spNow"></div>
    <div class="slot" id="spPrev" hidden><span id="spPrevText"></span><button class="btn small" id="spSwap">Switch back</button></div>
    <div class="shelf" id="spShelf"></div>
    <p class="tip" id="spEmpty" style="margin-top:0"></p>
    <div class="actions"><button class="btn small primary" id="spShelve">Put your car on the shelf</button></div>
    <p class="msg" id="spMsg"></p>
  </div>
</header>
<main class="layout">
  <section class="view">
    <div class="screen">
      <canvas id="track" width="${W}" height="${H}"></canvas>
    </div>
    <div class="strip" id="strip"></div>
    <div class="graph" id="graphBox"><p id="graphStatus"></p><canvas id="graph" width="240" height="44" aria-hidden="true"></canvas></div>
  </section>
  <aside class="side">
    <div id="garage" class="side">
      <div class="panel">
        <h2>Your job</h2>
        <p class="tip" style="margin-top:0">Build a car, train it on practice tracks, then race ${RACE_COUNT} new tracks. Gold means finishing all ${RACE_COUNT} in under ${GOLD_TIME} s. Start with the setup below; change one thing at a time to see what helps.</p>
      </div>
      <div class="panel name">
        <label for="name" class="namelabel">Your car's name <span>tap the name to change it</span></label>
        <div class="namebox"><input id="name" maxlength="24" aria-label="Car name (you can change it)" placeholder="Name your car" spellcheck="false" /><span class="pencil" aria-hidden="true">✎</span></div>
      </div>
      <div class="panel">
        <h2>Car design<span class="aside" id="starCount"></span></h2>
        <div class="looks" id="looks"></div>
        <p class="tip" id="lookTip"></p>
        <div class="paints" id="paints"></div>
        <h3 class="sub">Chassis</h3>
        <div class="chassis" id="chassis"></div>
        <p class="tip" id="chassisTip"></p>
        <p class="tip" id="streakLine"></p>
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
        <p class="tip">Grip takes bends harder; speed is quicker on the straights. A fast car has to brake earlier, because the tyres start to slide at a lower speed in bends. In our tests a very fast car crashed too often to finish all ${RACE_COUNT} race tracks.</p>
      </div>
      <div class="panel">
        <h2><span class="n">03</span>What to reward</h2>
        <label class="row"><span>Reward speed</span><input type="range" id="pace" min="0" max="100" step="5" /><output id="paceOut"></output></label>
        <label class="row"><span>Punish crashes</span><input type="range" id="safety" min="0" max="100" step="5" /><output id="safetyOut"></output></label>
        <label class="row"><span>Punish jerky steering</span><input type="range" id="smooth" min="0" max="100" step="5" /><output id="smoothOut"></output></label>
        <p class="tip">These change which cars training keeps: speed adds up to 20 points, a crash can cost 30, and steering changes can cost up to 40. They trade off pace, survival and smoothness; none is a guaranteed faster build.</p>
      </div>
      <div class="panel">
        <h2><span class="n">04</span>Practice tracks<span class="aside" id="pickCount"></span></h2>
        <div class="roads" role="group" aria-label="Road the practice tracks are driven on"><button type="button" class="road" data-road="dry" aria-pressed="true"><i aria-hidden="true">☀</i><b>Dry road</b><small>Grand Prix 1</small></button><button type="button" class="road wetroad" data-road="wet" aria-pressed="false"><i aria-hidden="true">🌧</i><b>Wet road</b><small>Grand Prix 2: tyres lose grip sooner</small></button></div>
        <select id="weather" aria-label="Road the practice tracks are driven on" hidden><option value="dry">Dry</option><option value="wet">Wet</option></select>
        <div class="actions" style="margin-top:2px"><label class="check"><input type="checkbox" id="condNight" /> Night</label><label class="check"><input type="checkbox" id="condIce" /> Ice patches</label></div>
        <p class="tip" style="margin-top:2px">Grand Prix 2 is raced on a wet road. A car practised only on dry roads loses most of its grip there, so practise on wet roads to prepare for it.</p>
        <div class="tracks" id="tracks"></div>
        <p class="tip">Race day uses tracks you have never seen. More practice tracks prepare the car better, but each round uses more of the run's practice budget, so you get fewer rounds.</p>
      </div>
      <button class="btn primary wide" id="toSkills">Next: Skill tree →</button>
    </div>
    <div id="skills" class="side">
      <div class="panel" data-fixed>
        <h2>Skill tree<span class="aside" id="partCount"></span></h2>
        <p class="tip" style="margin-top:0">Every car has ${POINT_BUDGET} points to spend. Point at a node (or tap it) to read what it gives and what it costs you on the road, then fit it. Spend the points on what the tracks need. Racing, stars, the Weekly Challenge and driving by hand unlock more nodes. The lines between nodes only group related ones: there is no order, so fit any unlocked node at any time.</p>
        <p class="tip legend" style="margin-top:6px">The number on a circle is the points it costs · a glowing circle is fitted · a padlock means you have not unlocked it yet.</p>
        <div id="treeSvg"></div>
        <div class="ncard" id="treeDetail"></div>
        <div class="actions"><button class="btn" id="resetTree">Reset skill tree</button><button class="btn primary" id="toPractice" style="flex:1">Go to practice →</button></div>
      </div>
    </div>
    <div id="practice" class="side">
      <div class="panel" data-fixed>
        <h2>Training<span class="aside" id="trainState">ready</span></h2>
        <div class="budget"><div class="bar"><i id="budgetBar" style="width:0%"></i></div>
          <div class="legend"><span id="budgetUsed"></span><span id="budgetGen"></span></div></div>
        <p class="tip">Every training run gets the same amount of practice, shared by all ${POPULATION} cars and all your practice tracks. It is counted in simulated driving, not seconds, so a faster device gets no advantage. More practice tracks use it up faster, so you get fewer rounds. Round counts are estimates, not caps: short crashes can mean more rounds. Phones take longer, but device speed does not change the count. Nothing carries over between runs: every new run starts with a full amount, so you can train as often as you like. Keep training uses ${Math.round(KEEP_TRAINING_SHARE * 100)}% of a full run. In numbers, a full run is ${hours(TRAINING_BUDGET)} hours of simulated driving, which the game plays through in about a minute on a laptop (longer on a phone).</p>
        <div class="actions">
          <button class="btn primary" id="train">Start training</button>
          <button class="btn" id="quickTrain">Quick run · ${QUICK_GENERATION_LIMIT} rounds</button>
          <button class="btn" id="keep">Keep training</button>
          <button class="btn" id="shelveQuick">Save to shelf</button>
          <button class="btn" id="swapQuick" hidden>Back to previous car</button>
          <button class="btn" id="skip" hidden>Skip to the end</button>
        </div>
        <p class="tip" id="keepHint" style="margin-top:8px"></p>
        <label class="row" style="grid-template-columns:auto 1fr;margin-top:10px"><input type="checkbox" id="watchAll" checked /><span>Replay every ${REPLAY_EVERY}th round</span></label>
        <label class="row" style="grid-template-columns:auto 1fr"><input type="checkbox" id="bestOnly" /><span>Show only the best car (lighter on phones)</span></label>
        <label class="row" style="grid-template-columns:auto 1fr"><span>Watch on</span><select id="watchTrack" aria-label="Practice track to watch"></select></label>
        <p class="tip">Each round breeds ${POPULATION} cars from the strongest drivers. The replay shows one practice track.</p>
        <p class="msg" id="trainMsg"></p>
        <p class="tip" id="trainTip" hidden></p>
      </div>
      <div class="panel" id="boardPanel">
        <h2>Track board<span class="aside" id="boardCount"></span></h2>
        <div class="board" id="board"></div>
        <p class="tip" id="boardNext"></p>
        <p class="tip" id="boardStars"></p>
      </div>
      <div class="panel" id="handPanel">
        <h2>Drive it yourself<span class="aside" id="handCount"></span></h2>
        <p class="tip" style="margin-top:0">Take the wheel and be the brain. Same car, same track: steering is gentle at first and snaps to full lock if you hold a key, so tap in bends and floor it on straights. Arrow keys or W A S D (Space for the boost, if you have earned it). Your own car runs beside you if you have trained one. Finish a lap on 2 tracks to open Steady steering and on 5 to open the Featherweight chassis in the skill tree.</p>
        <div class="actions"><select id="handTrack" aria-label="Track to drive yourself"></select><button class="btn primary" id="handGo">Take the wheel</button></div>
        <div class="pad" id="pad" hidden>
          <button type="button" data-k="l" aria-label="Steer left">◀</button><button type="button" data-k="r" aria-label="Steer right">▶</button>
          <button type="button" data-k="d" aria-label="Brake">▼</button><button type="button" data-k="u" aria-label="Gas">▲</button>
          <button type="button" data-k="b" id="padBoost" aria-label="Boost" hidden>⚡</button>
        </div>
        <p class="msg" id="handMsg"></p>
        <div class="board" id="handBoard"></div>
      </div>
      <div class="panel">
        <h2>Setup<span class="aside"><button class="btn small" id="toGarage">Edit</button></span></h2>
        <dl class="spec" id="spec"></dl>
      </div>
      <div class="panel">
        <h2>Your car</h2>
        <p class="tip" id="carState" style="margin-top:0"></p>
        <p class="tip">While you watch it drive, the box in the corner shows what the car sees (its rays), thinks (its neurons) and does (steering and gas).</p>
        <div class="actions"><button class="btn primary hot" id="shareCar">⚔ Challenge a friend</button></div>
        <p class="tip" style="margin-top:4px">Copies a link. Your friend opens it, races your car on the same secret tracks, and tries to beat it.</p>
        <select id="driveTrack" aria-label="Track to watch the car on" hidden></select>
        <div class="actions" id="testDriveActions"><button class="btn small" id="testDrive">Watch it drive</button><button class="btn small" id="swapCar" hidden>Switch to previous car</button></div>
        <p class="tip" id="testDriveTip" style="margin-top:4px">To watch a particular lap, tap its track on the Track board.</p>
        <details class="more">
          <summary>More: save, load, playtest notes</summary>
          <div class="actions">
            <button class="btn" id="saveCar">Save car to a file</button>
            <button class="btn" id="loadCar">Load car from a file</button>
            <input type="file" id="file" accept=".json,application/json" hidden />
          </div>
          <div class="actions"><button class="btn" id="notes">Copy playtest notes</button></div>
        </details>
        <input id="shareLink" readonly hidden aria-label="Challenge link" style="width:100%;margin-top:6px" />
        <p class="msg" id="carMsg"></p>
      </div>
      <div class="panel">
        <h2>Car shelf<span class="aside" id="shelfCount"></span></h2>
        <p class="tip" style="margin-top:0">Keep up to ${maxSlots()} cars here, such as two trainings of the same setup, and use whichever races best. Using a shelf car puts your current car back under Switch to previous car.</p>
        <div class="shelf" id="shelf"></div>
        <div class="actions"><button class="btn" id="shelve">Put your car on the shelf</button></div>
      </div>
    </div>
    <div id="race" class="side" data-view="hub">
      <div class="panel hub" id="raceHub" data-fixed>
        <button type="button" class="hubcard daily" id="hubDaily" hidden>
          <span class="hubtop"><span class="hubkind">Daily</span><em id="hubDailyEnds"></em></span>
          <b class="hubname">Daily Challenge</b>
          <span class="hubpitch">One track style, one twist, eight open tracks everyone races. One entry a day.</span>
          <span class="hubfacts">
            <span><small>Tracks</small>8</span>
            <span><small>Entries</small><i id="hubDailyLimit">2 a day</i></span>
            <span><small>Reward</small>Board rank</span>
          </span>
          <span class="hubnow" id="hubDailyNow">Loading today's challenge…</span>
          <span class="hubgo" aria-hidden="true">→</span>
        </button>
        <button type="button" class="hubcard weekly" id="hubWeekly" hidden>
          <span class="hubtop"><span class="hubkind">Weekly</span><em id="hubWeeklyEnds"></em></span>
          <b class="hubname">Weekly Challenge</b>
          <span class="hubpitch">The big one: mixed track styles and harder conditions, all week.</span>
          <span class="hubfacts">
            <span><small>Tracks</small>8</span>
            <span><small>Entries</small><i id="hubWeeklyLimit">3 a week</i></span>
            <span><small>Reward</small>Top-3 trophies</span>
          </span>
          <span class="hubnow" id="hubWeeklyNow">Loading this week's challenge…</span>
          <span class="hubgo" aria-hidden="true">→</span>
        </button>
        <button type="button" class="hubcard gp" id="hubGp">
          <span class="hubtop"><span class="hubkind">Always open</span></span>
          <b class="hubname">Grand Prix</b>
          <span class="hubpitch">The fixed tracks, dry and wet. Race for gold, silver and bronze.</span>
          <span class="hubgo" aria-hidden="true">→</span>
        </button>
      </div>
      <div class="panel rbar" id="raceBar" data-fixed>
        <button type="button" class="back" id="raceBack" aria-label="Back to all races"><span aria-hidden="true">←</span> All races</button>
        <b id="raceBarTitle"></b>
      </div>
      <div class="panel" id="challengePanel" data-fixed hidden>
        <h2>Challenge<span class="aside"><button class="btn small" id="challengeClear">Dismiss</button></span></h2>
        <p class="tip" id="challengeLine" style="margin-top:0"></p>
        <p class="tip" id="challengeVs" style="color:var(--text);font-weight:600"></p>
      </div>
      <div class="panel" id="gpPanel" data-fixed>
        <h2><span id="gpTitle">Grand Prix 1</span><span class="aside" id="gpAside">8 secret tracks</span></h2>
        <div class="roads" id="gpRoads" role="group" aria-label="Which Grand Prix to race"><button type="button" class="road" id="gp0" aria-pressed="true"><i aria-hidden="true">☀</i><b>Dry road</b><small>Grand Prix 1</small></button><button type="button" class="road wetroad" id="gp1" aria-pressed="false"><i aria-hidden="true">🌧</i><b>Wet road</b><small>Grand Prix 2</small></button><button type="button" class="road" id="gp2" aria-pressed="false" hidden>Past week</button></div>
        <div class="actions">
          <button class="btn primary wide" id="raceGo">Race your car</button>
          <button class="btn" id="raceSpeed">Speed 4×</button>
          <button class="btn" id="raceSkip">Skip to results</button>
          <button class="btn" id="raceCars" title="Race a different saved car">Change car</button>
        </div>
        <p class="msg" id="raceMsg"></p>
        <p class="tip" style="margin-top:8px">Your car drives 8 tracks it has never seen, once each. Most tracks finished wins, then the lowest total time. Grand Prix 2 is the same tracks on a wet road.</p>
        <p class="tip" id="medalRules"></p>
      </div>
      <div class="panel" id="dailyPanel" data-fixed hidden>
        <h2>Daily Challenge<span class="aside" id="dailyEnds"></span></h2>
        <p class="tip" id="dailyLine" style="margin-top:0"></p>
        <p class="tip">Entering submits this car's setup, not its trained brain. The server trains each setup once under the same conditions; your official result may differ from your local race.</p>
        <div class="actions"><label class="entry-car" for="dailyCar">Car to enter <select id="dailyCar" aria-label="Car to enter in the Daily Challenge"></select></label><button class="btn primary" id="dailyGo">Submit selected setup</button></div>
        <p class="msg" id="dailyMsg"></p>
        <div class="jobs" id="dailyJobs"></div>
        <p class="tip" style="color:var(--text);font-weight:600">Today</p>
        <ol class="rank" id="dailyRows"></ol>
        <p class="tip" id="dailyEmpty" hidden>No entries today yet. Be the first.</p>
        <div id="dailyPast"></div>
      </div>
      <div class="panel" id="weeklyPanel" data-fixed hidden>
        <h2>Weekly Challenge<span class="aside" id="weeklyEnds"></span></h2>
        <p class="tip" id="weeklyLine" style="margin-top:0"></p>
        <p class="tip">Entering submits this car's setup, not its trained brain. The server trains each setup once under the same conditions; your official result may differ from your local race.</p>
        <div class="actions"><label class="entry-car" for="weeklyCar">Car to enter <select id="weeklyCar" aria-label="Car to enter in the Weekly Challenge"></select></label><button class="btn primary" id="weeklyGo">Submit selected setup</button></div>
        <p class="msg" id="weeklyMsg"></p>
        <div class="jobs" id="weeklyJobs"></div>
        <ol class="tower" id="weeklyTracks" hidden></ol>
        <p class="tip" id="weeklyBoardTitle" style="color:var(--text);font-weight:600">This week</p>
        <ol class="rank" id="weeklyRows"></ol>
        <p class="tip" id="weeklyEmpty" hidden>No entries this week yet. Be the first.</p>
        <div id="weeklyPast"></div>
      </div>
      <div class="panel" id="boardOnline" hidden>
        <h2>Leaderboard</h2>
        <div class="roads slim" role="group" aria-label="Which leaderboard"><button type="button" class="road on" id="onlineDry" aria-pressed="true"><i aria-hidden="true">☀</i><b>Dry road</b></button><button type="button" class="road wetroad" id="onlineWet" aria-pressed="false"><i aria-hidden="true">🌧</i><b>Wet road</b></button></div>
        <ol class="rank" id="onlineRows"></ol>
        <p class="tip" id="onlineEmpty" hidden>No cars on this board yet. Be the first.</p>
        <p class="tip" style="margin-top:4px">Every car on these boards was trained by the game itself: one run, the same way for everyone. Only your setup counts, not how often you retrain. An entry shows up within about 30 minutes.</p>
        <p class="tip" id="onlineWho"></p>
        <div class="jobs" id="onlineJobs"></div>
        <div class="actions" id="onlineNameRow" hidden><input id="onlineName" maxlength="20" placeholder="Choose a unique username" aria-label="Profile username (unique and shown on leaderboards; separate from your car name)" autocomplete="off" /><button class="btn small primary" id="onlineNameSave">Save username</button><small class="tip" style="flex:1 0 100%;margin-top:0">Unique public username, separate from your car's name.</small></div>
        <div class="actions"><button class="btn primary" id="onlineSignIn">Sign in with Google</button><button class="btn small" id="onlineSignOut" hidden>Sign out</button><button class="btn primary" id="onlineEnter">Enter your car</button></div>
        <p class="msg" id="onlineMsg"></p>
      </div>
      <div class="panel" id="timingPanel">
        <h2>Timing<span class="aside" id="raceTotal"></span></h2>
        <ol class="tower" id="tower"></ol>
      </div>
      <div class="panel" id="resultPanel" data-fixed hidden>
        <h2>Result</h2>
        <div class="medal" id="medal"></div>
        <div class="sharecard" id="shareCard" hidden>
          <div class="sc-top"><b>CRASH<span>LAB</span></b><span id="scGp"></span></div>
          <div class="sc-name" id="scName"></div>
          <div class="sc-medal" id="scMedal"></div>
          <div class="sc-grid" id="scGrid" aria-hidden="true"></div>
          <div class="sc-line" id="scLine"></div>
          <div class="sc-cta">Drives tracks it has never seen. Can yours beat it?</div>
        </div>
        <p class="tip" id="resultLine" style="margin-top:4px"></p>
        <p class="tip warn" id="advice"></p>
        <div class="actions"><button class="btn small primary" id="resultGarage">Edit setup in Garage →</button><button class="btn small" id="resultPractice">Go to Practice →</button><button class="btn small primary hot" id="resultShare">⚔ Share this result</button></div>
        <input id="resultLink" readonly hidden aria-label="Challenge link" style="width:100%;margin-top:6px" />
        <div id="resultBoard" hidden>
          <p class="tip" id="resultBoardAsk" style="margin-top:12px;color:var(--text);font-weight:600">Put this on the leaderboard?</p>
          <div class="actions" style="margin-top:4px"><button class="btn primary" id="resultBoardGo">Sign in with Google to enter</button></div>
          <p class="tip" id="resultBoardPlace" style="margin-top:2px"></p>
          <p class="msg" id="resultBoardMsg"></p>
        </div>
        <p class="msg" id="resultMsg"></p>
      </div>
      <p class="tip" id="pb"></p>
    </div>
    <div id="profile" class="side">
      <div class="panel" data-fixed id="profileBox"></div>
    </div>
  </aside>
</main>
<footer class="made">
  <span>Made by <b>Adharsh</b></span>
  <a class="soc" href="https://www.instagram.com/adhdrsh" target="_blank" rel="noopener noreferrer" aria-label="Instagram @adhdrsh"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg><span>@adhdrsh</span></a>
  <a class="soc" href="https://www.linkedin.com/in/kgadharsh" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn @kgadharsh"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4V21H3zM9.75 9.75h3.8v1.6h.06c.53-1 1.82-2.05 3.75-2.05 4 0 4.74 2.63 4.74 6.05V21h-4v-5.1c0-1.22-.02-2.78-1.7-2.78-1.7 0-1.96 1.33-1.96 2.7V21h-4z"/></svg><span>@kgadharsh</span></a>
</footer>
<dialog class="dare" id="dareDialog" aria-labelledby="dareTitle">
  <div class="dare-ico" aria-hidden="true">⚔️</div>
  <h3 id="dareTitle">Dare a friend</h3>
  <p id="dareText"></p>
  <div class="actions"><button type="button" class="btn primary" id="dareGo">Copy challenge link</button><button type="button" class="btn" id="dareNo">Not now</button></div>
  <p class="msg" id="dareMsg"></p>
  <input id="dareLink" readonly hidden aria-label="Challenge link" style="width:100%;margin-top:6px" />
</dialog>
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
// The same bar can carry other news, such as players who passed you on the board while you were away
function showNotice(text: string) {
  $('nudgeText').replaceChildren(text)
  nudge.hidden = false
  document.body.classList.add('has-nudge')
}
function hideNudge() {
  nudge.hidden = true
  document.body.classList.remove('has-nudge')
}
$('nudgeGo').addEventListener('click', () => setTab('race'))
$('nudgeClose').addEventListener('click', hideNudge)

// ---------- TABS ----------
type Tab = 'garage' | 'skills' | 'practice' | 'race' | 'profile'
// Using a shelf car reloads the page to refresh every control, so the tab it was used from is remembered for that one reload
const TABS: Tab[] = ['garage', 'skills', 'practice', 'race', 'profile']
const cameFrom = (() => {
  try {
    const t = sessionStorage.getItem('crashlab.tab') as Tab | null
    sessionStorage.removeItem('crashlab.tab')
    return t && TABS.includes(t) ? t : null
  } catch {
    return null
  }
})()
let tab: Tab = cameFrom ?? 'garage'
function setTab(t: Tab) {
  tab = t
  if (t === 'race') hideNudge()
  if (t === 'garage') renderLooks()
  if (t === 'profile') showProfile()
  document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.tab === t)
    btn.setAttribute('aria-selected', String(btn.dataset.tab === t))
  })
  document.body.classList.toggle('full', t === 'skills' || t === 'profile') // these two have no use for the track screen
  document.body.classList.toggle('hubview', t === 'race' && raceSection === 'hub') // the race menu needs no track screen above it on a narrow window
  $('garage').hidden = t !== 'garage'
  $('skills').hidden = t !== 'skills'
  $('profile').hidden = t !== 'profile'
  $('practice').hidden = t !== 'practice'
  $('race').hidden = t !== 'race'
  if (t === 'skills') renderParts()
  $('graphBox').hidden = t !== 'practice'
  strip.hidden = t === 'garage' // everything in it is already in the Garage's panels
  if (t !== 'practice') {
    stopTestDrive()
    stopHand()
  }
  renderPractice()
  raceView?.render()
}
document.querySelectorAll<HTMLButtonElement>('.tab[data-tab]').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab as Tab)))

// ---------- THE RACE TAB'S SECTIONS ----------
// The Race tab opens on a menu: the Daily Challenge, the Weekly Challenge and the fixed Grand Prix. Each opens the same race
// screen with its own tracks, and the back arrow returns to the menu.
type RaceSection = 'hub' | 'gp' | 'daily' | 'weekly'
const SECTION_TITLE: Record<RaceSection, string> = { hub: '', gp: 'Grand Prix', daily: 'Daily Challenge', weekly: 'Weekly Challenge' }
const SECTION_IDLE: Record<'daily' | 'weekly', { title: string; sub: string }> = {
  daily: { title: 'DAILY CHALLENGE', sub: "TODAY'S TRACKS ARE OPEN · RACE THEM, THEN ENTER BELOW" },
  weekly: { title: 'WEEKLY CHALLENGE', sub: "THIS WEEK'S TRACKS ARE SECRET · ENTER BELOW, OR RACE A PAST WEEK" },
}
let raceSection: RaceSection = 'hub'
function setRaceSection(v: RaceSection) {
  if (v !== raceSection) {
    raceView?.clearPast() // a past day or week belongs to its own section
    delete $('race').dataset.open
  }
  raceSection = v
  document.body.classList.toggle('hubview', tab === 'race' && v === 'hub')
  $('race').dataset.view = v
  $('raceBarTitle').textContent = SECTION_TITLE[v]
  $('raceBar').dataset.kind = v
  raceView?.setIdle(v === 'hub' ? { title: 'PICK A RACE', sub: 'DAILY · WEEKLY · GRAND PRIX' } : v === 'gp' ? null : SECTION_IDLE[v])
  raceView?.render()
}
// A finished day's or week's tracks were opened: show them in their own section, with the race screen
function openPastIn(gp: GrandPrix) {
  setRaceSection(gp.day !== undefined ? 'daily' : 'weekly')
  raceView!.showPastWeek(gp)
  $('race').dataset.open = '1'
  raceView?.setIdle(null)
}
$('hubDaily').addEventListener('click', () => {
  setRaceSection('daily')
  const today = leaderboard.dailyToday() // today's tracks are open, so the race screen is ready to use at once
  if (today) openPastIn(today)
})
$('hubWeekly').addEventListener('click', () => setRaceSection('weekly'))
$('hubGp').addEventListener('click', () => setRaceSection('gp'))
$('raceBack').addEventListener('click', () => setRaceSection('hub'))
$('toPractice').addEventListener('click', () => setTab('practice'))
$('toSkills').addEventListener('click', () => setTab('skills'))
$('resetTree').addEventListener('click', () => resetTree())
$('toGarage').addEventListener('click', () => setTab('garage'))

// ---------- RACE DAY (raceView.ts) ----------
let raceView: ReturnType<typeof createRaceView> | null = null

// ---------- CAMERA ----------
// The camera never rotates. It shows the whole track in the garage, and follows a car when one drives.
const cam = newCamera()

// ---------- GARAGE ----------
const input = (id: string) => $<HTMLInputElement>(id)
// speeds are shown in km/h everywhere: the sim's units are 40 km/h each
const kmh = (v: number) => Math.round(v * 40) + ' km/h'
const pct = (v: number) => Math.round(v * 100) + '%'
const nameInput = input('name')
nameInput.value = draft.name
// A car's name can be changed here or on the Profile. The trained car takes the new name too, so it never shows an old one.
function setName(value: string) {
  draft.name = value.trim() || 'Unnamed'
  if (car && car.name !== draft.name) {
    car.name = draft.name
    save(KEYS.car, carToJson(car))
  }
  changed()
  raceView?.render()
}
nameInput.addEventListener('input', () => setName(nameInput.value))

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
// Practice conditions: the Weekly Grand Prix can be raced at night or with ice patches, so a car can practise in them
for (const [id, key] of [['condNight', 'night'], ['condIce', 'ice']] as const) {
  input(id).addEventListener('change', () => {
    const c = { ...(b.cond ?? {}) }
    if (input(id).checked) c[key] = true
    else delete c[key]
    if (c.night || c.ice) b.cond = c
    else delete b.cond // no conditions is written exactly as before they existed
    changed()
  })
}
document.querySelectorAll<HTMLButtonElement>('.road[data-road]').forEach((btn) =>
  btn.addEventListener('click', () => {
    weatherSel.value = btn.dataset.road!
    weatherSel.dispatchEvent(new Event('change'))
  }),
)
weatherSel.addEventListener('change', () => {
  if (weatherSel.value === 'wet') b.weather = 'wet'
  else delete b.weather // dry is the same as nothing
  changed()
})
// A practice track on the road a build practises on
const practiceOn = (id: number, build: Build): Track => practiceOnRoad(id, build.weather === 'wet', build.cond)

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
    } else if (b.practice.length < maxPractice(b)) {
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
  $('weights').textContent = genomeLength(brainShape(b)) + ' connections'
  input('spread').max = String(maxSpread(b.parts))
  input('spread').value = String(b.sensors.spread)
  input('count').max = String(maxRays(b.parts))
  input('count').value = String(b.sensors.count)
  $('countOut').textContent = String(b.sensors.count)
  $('spreadOut').textContent = b.sensors.spread + '°'
  $('speedOut').textContent = kmh(spec.maxSpeed)
  $('gripOut').textContent = kmh(spec.gripSpeed)
  $('speedBar').style.width = ((spec.maxSpeed - 4.5) / 3) * 100 + '%'
  $('gripBar').style.width = ((spec.gripSpeed - 2) / 2) * 100 + '%'
  $('paceOut').textContent = pct(b.reward.pace)
  $('safetyOut').textContent = pct(b.reward.safety)
  $('smoothOut').textContent = pct(b.reward.smooth)
  $('pickCount').textContent = b.practice.length + ' of ' + maxPractice(b) + ' picked'
  input('condNight').checked = !!b.cond?.night
  input('condIce').checked = !!b.cond?.ice
  weatherSel.value = b.weather === 'wet' ? 'wet' : 'dry'
  document.querySelectorAll<HTMLButtonElement>('.road[data-road]').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.road === weatherSel.value)
    btn.setAttribute('aria-pressed', String(btn.dataset.road === weatherSel.value))
  })
  renderParts()
  renderChassis()
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
type Run = { build: Build; name: string; history: History; watching: boolean; judging: boolean; finish: Finish | null; spent: number; budget: number; keep: boolean; quick: boolean; maxGenerations?: number; startedAt: number; awayAtStart: number; tipStart: number; secs?: number }

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
  'A fast car has to brake earlier, because the tyres start to slide at a lower speed in bends.',
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
let lastRun: { spent: number; generations: number; budget: number; quick: boolean } | null = null // what the finished run used, for the budget panel

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
  lastRun = { spent: r.spent, generations: f.generations, budget: r.budget, quick: r.quick }
  logEvent({ k: 'train', secs: r.secs ?? runSeconds(r), generations: f.generations, keep: r.keep, wet: r.build.weather === 'wet', rays: r.build.sensors.count, practice: r.build.practice.length })
  if (car) rememberPrevious(car) // the car this run replaces, in case the new one is worse
  // the generations the brain has had in all: carrying on adds to the car's count (unknown if the old car's was)
  const total = r.keep ? (car?.generations !== undefined ? car.generations + f.generations : undefined) : f.generations
  // training runs in all: a fresh run is 1, and Keep training adds one to the car it carried on from (unknown stays unknown)
  const runs = r.keep ? (car?.runs !== undefined ? car.runs + 1 : undefined) : 1
  car = { name: r.name, build: r.build, genome: f.genome, ...(total !== undefined ? { generations: total } : {}), ...(runs !== undefined ? { runs } : {}) }
  carBrain = genomeToBrain(f.genome, brainShape(r.build))
  save(KEYS.car, carToJson(car))
  drawGraph(r.history)
  lastCurves[refKey(r.build)] = r.history.map((h) => Math.round(h.best * 1000) / 1000) // the next run compares itself with this one
  save(KEYS.lastCurve, lastCurves)
  // the test drive only starts if you are watching it; from another tab the car is simply ready
  const here = tab === 'practice'
  const worse = r.keep ? ' If it feels worse, press "Back to previous car" next to Keep training, or find it under My cars.' : ''
  stopTraining('Done: ' + f.generations + ' rounds of training. ' + (here ? 'Here is your car driving its first lap.' : 'Your new car is ready: watch it drive in Practice, or race it.') + worse)
  renderChip()
  raceView?.render()
  if (here) startTestDrive()
  if (tab !== 'race') showNudge(car.name)
  showDare('trained')
}

// Keep training carries on from the car you have, so its brain must be the same size as the garage's
const canKeepTraining = () => !!car && genomeLength(brainShape(b)) === car.genome.length

// keep: carry on from your car with a share of the budget, instead of starting from random brains
function startTraining(keep: boolean, quick = false) {
  if (worker) return
  if (keep && !canKeepTraining()) return
  hideNudge()
  stopTestDrive()
  const watch = input('watchAll').checked
  const budget = keep ? TRAINING_BUDGET * KEEP_TRAINING_SHARE : TRAINING_BUDGET
  const maxGenerations = quick ? QUICK_GENERATION_LIMIT : undefined
  run = { build: clone(b), name: draft.name, history: [], watching: watch, judging: false, finish: null, spent: 0, budget, keep, quick, maxGenerations, startedAt: performance.now(), awayAtStart: hiddenNow(), tipStart: Math.floor(Math.random() * TIPS.length) }
  ghostCurve = lastCurves[refKey(run.build)] ?? null
  drawGraph([])
  const pace = watch ? 'Every ' + REPLAY_EVERY + 'th round is replayed here.' : ''
  trainMsg(quick ? 'Quick run: up to ' + QUICK_GENERATION_LIMIT + ' rounds. ' + pace : keep ? 'Carrying on from your car at full speed. ' + pace : watch ? 'Training at full speed. ' + pace : 'Training at full speed...')
  worker = new Worker(new URL('./trainWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent) => {
    const m = event.data
    if (!run) return
    if (m.type === 'progress') {
      run.history.push({ best: m.checkpoints / CHECKPOINTS, mean: m.meanCheckpoints / CHECKPOINTS })
      const rk = refKey(run.build)
      const laps = m.checkpoints / CHECKPOINTS
      if (!(bestLaps[rk] >= laps)) {
        bestLaps[rk] = laps // a new record on these practice tracks
        save(KEYS.bestLaps, bestLaps)
      }
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
  worker.postMessage({ type: 'start', build: run.build, seed: Math.floor(Math.random() * 1e9), watch, budget, maxGenerations, start: keep ? car!.genome : undefined })
  renderPractice()
}

$('train').addEventListener('click', () => {
  if (worker) stopTraining('Training stopped. Your car from before is unchanged.')
  else startTraining(false)
})
$('quickTrain').addEventListener('click', () => startTraining(false, true))
$('keep').addEventListener('click', () => startTraining(true))

// Swap back to the car before the latest run (and again, to go forward: the two cars trade places)
function swapCars() {
  if (worker || !previousCar || !car) return
  const now = car
  car = previousCar
  carBrain = genomeToBrain(car.genome, brainShape(car.build))
  save(KEYS.car, carToJson(car))
  rememberPrevious(now)
  stopTestDrive()
  renderChip()
  raceView?.render()
  carMsg('Switched cars. Your other car is now the previous one.')
  $('trainMsg').textContent = 'Switched back to ' + car.name + ' (' + carLabel(car) + '). Your other car is now the previous one, so press the button again to swap back.'
  renderPractice()
}
$('swapCar').addEventListener('click', swapCars)
$('swapQuick').addEventListener('click', swapCars)
$('spSwap').addEventListener('click', () => {
  swapCars()
  setShelfPop(false)
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
  const shape = brainShape(build)
  const spec = specOf(build)
  const trackId = Number(watchSelect.value)
  const track = practiceOn(trackId, build)
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
  const track = practiceOn(Number(driveSelect.value), car.build) // a car drives its test on the road and in the conditions it practised in
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

// ---------- DRIVE IT YOURSELF ----------
// The player is the brain. The same car and track as a test drive, with the Garage's setup and skill tree. If a car has been
// trained it drives beside you, so you can see whether you can beat your own creation. Laps are kept for the licence (driver.ts).
type Hand = { id: number; wet: boolean; track: Track; car: Car; ghost: Car | null; ghostTime: number | null; ghostDone: boolean; hold: number; crashAt: { x: number; y: number } | null; tries: number; lastLap: number | null; bestLap: number | null }
let hand: Hand | null = null
const controls = createControls()
const handSelect = $<HTMLSelectElement>('handTrack')
TRACK_NAMES.forEach((n, i) => handSelect.add(new Option(n, String(i))))
const handSpec = () => ({ ...specOf(b), nitro: hasPerk('nitro') }) // the nitro perk is only for driving yourself
const handMsg = (text: string, good = false) => {
  $('handMsg').textContent = text
  $('handMsg').classList.toggle('good', good)
}
function resetHand(h: Hand) {
  h.car = createCar(h.track, handSpec())
  h.ghost = car && carBrain ? createCar(h.track, specOf(car.build)) : null
  h.ghostTime = null
  h.ghostDone = !h.ghost
  h.hold = 0
  h.crashAt = null
  follow(cam, h.car, true)
}
function startHand() {
  stopTestDrive()
  const id = Number(handSelect.value)
  const wet = b.weather === 'wet'
  const track = practiceOn(id, b)
  hand = { id, wet, track, car: createCar(track, handSpec()), ghost: null, ghostTime: null, ghostDone: true, hold: 0, crashAt: null, tries: 0, lastLap: null, bestLap: null }
  resetHand(hand)
  controls.enable(true)
  $('pad').hidden = false
  $('padBoost').hidden = !hasPerk('nitro')
  handMsg('Go! ← → steer, ↑ gas, ↓ brake' + (hasPerk('nitro') ? ', Space for the boost.' : '.'))
  renderPractice()
}
function stopHand() {
  if (!hand) return
  hand = null
  controls.enable(false)
  $('pad').hidden = true
  handMsg('')
  renderPractice()
}
$('handGo').addEventListener('click', () => (hand ? stopHand() : startHand()))
handSelect.addEventListener('change', () => {
  if (hand) startHand()
})
$('pad').querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
  const set = (v: boolean) => controls.press(btn.dataset.k!, v)
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    btn.setPointerCapture(e.pointerId)
    set(true)
  })
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(ev, () => set(false))
})
function tickHand() {
  const h = hand
  if (!h) return
  if (h.hold > 0) {
    if (--h.hold === 0) resetHand(h)
    return
  }
  if (h.ghost && !h.ghostDone && carBrain) {
    drive(h.ghost, carBrain)
    if (h.ghost.passed >= CHECKPOINTS) {
      h.ghostTime = h.ghost.steps / 60
      h.ghostDone = true
    } else if (h.ghost.dead || h.ghost.sinceProgress >= STALL_STEPS) h.ghostDone = true // it crashed: no time to beat
  }
  step(h.car, controls.read())
  if (h.car.passed >= CHECKPOINTS) {
    const secs = h.car.steps / 60
    h.lastLap = secs
    h.bestLap = h.bestLap === null ? secs : Math.min(h.bestLap, secs)
    const fresh = recordHand(h.id, h.wet, secs)
    const medal = lapMedal(h.id, secs, h.wet)
    const rival = !h.ghost ? '' : h.ghostTime === null ? ' ' + (car?.name ?? 'Your car') + ' crashed on this track, so you beat it.' : secs < h.ghostTime ? ' You beat ' + (car?.name ?? 'your car') + ' (' + h.ghostTime.toFixed(1) + ' s).' : ' ' + (car?.name ?? 'Your car') + ' was quicker (' + h.ghostTime.toFixed(1) + ' s).'
    handMsg(secs.toFixed(1) + ' s' + (medal ? ' · ' + medal : '') + (fresh ? ' · new best' : '') + '.' + rival, true)
    h.hold = 120
    announceParts()
    renderHandBoard()
  } else if (h.car.dead || h.car.sinceProgress >= STALL_STEPS) {
    h.tries++
    h.crashAt = { x: h.car.x, y: h.car.y }
    h.hold = 60
    handMsg(h.car.dead ? 'Crashed. Attempt ' + h.tries + ': lift off before the bends.' : 'Stuck. Attempt ' + h.tries + '.')
  }
}
function renderHandBoard() {
  const wet = b.weather === 'wet'
  $('handCount').textContent = licence() + ' of ' + PRACTICE_COUNT + ' driven'
  $('handBoard').replaceChildren(
    ...TRACK_NAMES.map((name, id) => {
      const row = document.createElement('div')
      row.className = 'brow static'
      const best = handBest(id, wet)
      const t = document.createElement('span')
      t.className = 'bt'
      t.textContent = best !== null ? best.toFixed(1) + ' s' : '–'
      const mine = document.createElement('span')
      mine.className = 'bm'
      mine.append(dot(handMedal(id, wet)), t)
      const label = document.createElement('span')
      label.className = 'bn'
      label.textContent = name
      row.append(label, mine)
      return row
    }),
  )
}

// ---------- STARS, CAR DESIGNS AND THE TRACK BOARD ----------
// Medals earn stars. Stars unlock car designs. The track board shows how the current car drives every practice
// track, which is also how a player sees whether it can win on all of them.
const gpMedals = () =>
  GRAND_PRIXES.map((gp) => {
    const best = loadBest(gp)
    return best ? medalFor(best, gp) : null
  })
// stars earned before the 8 Nov change keep counting, so nothing already unlocked locks again
const starsBefore = legacyStars(loadMedals(), gpMedals())
const starCount = () => Math.max(totalStars(loadMedals(), gpMedals()), starsBefore)

// ---------- PARTS ----------
// Has this browser raced a Weekly Grand Prix: a past week here (it saves a personal best) or an entry on the server
const racedWeekly = () => {
  try {
    return !!localStorage.getItem('crashlab.enteredWeekly') || Object.keys(localStorage).some((k) => k.startsWith('crashlab.best.w:'))
  } catch {
    return false
  }
}
const progress = (): Progress => ({ stars: starCount(), gpMedals: gpMedals(), racedWet: loadBest(GRAND_PRIXES[1]) !== null, racedWeekly: racedWeekly(), licence: licence() })
// Fit a node at a level (0 takes it off). A car with nothing fitted is written exactly as before the tree existed.
function setLevel(id: PartId, level: number) {
  const parts: Parts = { ...(b.parts ?? {}) }
  if (id === 'range') delete parts.eyes // long-range eyes from before the tree become ray range only when range is changed
  if (level) parts[id] = level === 1 ? true : level
  else delete parts[id]
  // fitting one of an exclusive pair takes the other off
  const rival = rivalOf(id)
  if (level && rival) delete parts[rival]
  if (pointsUsed(parts)) b.parts = parts
  else delete b.parts
  // the extra practice track goes when the slot does
  if (b.practice.length > maxPractice(b)) b.practice.length = maxPractice(b)
  // so do the extra eyes and wide-angle lens nodes
  if (b.sensors.count > maxRays(b.parts)) b.sensors.count = maxRays(b.parts)
  if (b.sensors.spread > maxSpread(b.parts)) b.sensors.spread = maxSpread(b.parts)
  changed()
}
// Take every node off at once
function resetTree() {
  delete b.parts
  if (b.practice.length > maxPractice(b)) b.practice.length = maxPractice(b)
  b.sensors.count = Math.min(b.sensors.count, maxRays(b.parts))
  b.sensors.spread = Math.min(b.sensors.spread, maxSpread(b.parts))
  changed()
}
const tree = createSkillTree({
  svgBox: $('treeSvg'),
  detail: $('treeDetail'),
  getBuild: () => b,
  getProgress: progress,
  getName: () => draft.name,
  setLevel,
})
function renderParts() {
  const { used, open } = tree.render()
  $<HTMLButtonElement>('resetTree').disabled = used === 0
  $('partCount').textContent = used + ' of ' + POINT_BUDGET + ' points · ' + open + ' of ' + PARTS.length + ' unlocked'
}
// Tell the player when racing or medals have unlocked a part
function announceParts() {
  const fresh = newlyUnlocked(progress())
  if (!fresh.length) return
  renderParts()
  showNotice('New in your skill tree: ' + fresh.map((f) => f.name).join(', ') + '. Fit ' + (fresh.length === 1 ? 'it' : 'them') + ' in the Skill tree.')
}

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
  renderPaints()
  renderChassis()
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
    drawCar(g, { x: 60, y: 32, angle: 0 }, 78, 42, paintColour(), i)
    g.globalAlpha = 1
    btn.querySelector('span')!.textContent = open ? LOOKS[i].name : LOOKS[i].name + '\n★ ' + LOOKS[i].stars
  })
  const next = nextLook(stars)
  $('lookTip').textContent = next
    ? 'Next design: ' + next.name + ', ' + next.need + ' more stars. A silver on a track is worth 1 star and a gold 2 (just finishing earns none), and a Grand Prix medal 3, 6 or 10.'
    : 'Every design is unlocked.'
}


// ---------- PAINT, STREAK AND PERKS (perks.ts) ----------
function renderPaints() {
  const open = hasPerk('paint')
  const mine = loadPaint()
  $('paints').replaceChildren(
    ...PAINTS.map((p, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'swatch' + (open && i === mine ? ' on' : '') + (open ? '' : ' locked')
      btn.style.setProperty('--c', p.colour)
      btn.title = open ? p.name : 'Paint shop: play on 2 days in a row'
      btn.setAttribute('aria-label', btn.title)
      btn.addEventListener('click', () => {
        if (!open) return
        savePaint(i)
        renderPaints()
        renderLooks()
      })
      return btn
    }),
  )
  const s = streak()
  const next = nextPerk()
  $('streakLine').textContent =
    '🔥 ' + s.days + (s.days === 1 ? ' day' : ' days') + ' in a row. ' +
    (next ? 'Next perk: ' + next.name + ' at ' + next.days + ' days (' + Math.max(1, next.days - Math.max(s.days, 0)) + ' to go). ' + (s.today ? 'Come back tomorrow to keep it.' : 'Play today to keep it going.') : 'Every perk is yours: ' + PERKS.map((p) => p.name).join(', ') + '.')
}
function showProfile() {
  renderProfile($('profileBox'), {
    carName: draft.name,
    stars: starCount(),
    progress: progress(),
    trackNames: TRACK_NAMES,
    look,
    identity: leaderboard.identity(),
    onRename: (v) => {
      setName(v)
      nameInput.value = draft.name
    },
    onSignIn: () => leaderboard.signIn(),
    onOpenBoard: () => leaderboard.openBoard(),
    boardStats: () => leaderboard.boardStats(),
  })
}


// ---------- CHASSIS ----------
// A frame changes how the car drives (setup.ts has the numbers). Frames are unlocked with stars, like designs.
const effectsOf = (c: { top: number; grip: number; accel: number; turn: number; range: number }) =>
  ([['acceleration', c.accel], ['top speed', c.top], ['grip', c.grip], ['steering', c.turn], ['sight', c.range]] as const)
    .filter(([, v]) => v !== 1)
    .map(([k, v]) => (v > 1 ? '+' : '−') + Math.round(Math.abs(v - 1) * 100) + '% ' + k)
    .join(' · ')
function renderChassis() {
  const stars = starCount()
  const choices = [{ id: undefined, name: 'Classic', blurb: 'No strengths and no weaknesses.', stars: 0, fx: 'the baseline' }, ...CHASSIS.map((c) => ({ id: c.id as string | undefined, name: c.name, blurb: c.blurb, stars: c.stars, fx: effectsOf(c) }))]
  $('chassis').replaceChildren(
    ...choices.map((c) => {
      const open = stars >= c.stars
      const on = (b.chassis ?? undefined) === c.id
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'frame' + (on ? ' on' : '') + (open ? '' : ' locked')
      btn.setAttribute('aria-pressed', String(on))
      const name = Object.assign(document.createElement('b'), { textContent: c.name })
      const fx = Object.assign(document.createElement('small'), { textContent: open ? c.fx : '★ ' + c.stars + ' to unlock' })
      btn.append(name, fx)
      btn.addEventListener('click', () => {
        if (!open) {
          $('chassisTip').textContent = c.name + ' unlocks at ' + c.stars + ' stars. ' + c.blurb
          return
        }
        if (c.id) b.chassis = c.id as typeof b.chassis
        else delete b.chassis
        changed()
      })
      return btn
    }),
  )
  const cur = CHASSIS.find((c) => c.id === b.chassis)
  $('chassisTip').textContent = cur ? cur.name + ': ' + cur.blurb + ' A frame is a different car to drive, not a stronger one.' : 'Frames change how the car drives. Each has a strength and a weakness, so pick the one that suits your tracks.'
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
  announceParts()
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
  $('boardNext').hidden = !car
  $('boardStars').hidden = !car
  const rebuild = boardShown !== boardVersion || !!car !== !!$('board').querySelector('.brow')
  boardShown = boardVersion
  if (rebuild) paintRows()
  paintNotes()
  function paintRows() {
  if (!car) {
    const empty = document.createElement('p')
    empty.className = 'board-empty'
    empty.textContent = 'No track results yet. Train a car to see its laps here.'
    $('board').replaceChildren(empty)
    return
  }
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
// One row per shelf car, with Use and Remove, into a container (the Garage panel and the top bar's popover share it)
function shelfRows(box: HTMLElement, training: boolean) {
  box.replaceChildren(
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
        try {
          sessionStorage.setItem('crashlab.tab', tab) // come back to this tab, not the Garage
          sessionStorage.setItem('crashlab.section', raceSection) // and to the same part of the Race tab
        } catch {
          /* storage blocked: the page opens on the Garage */
        }
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
function renderShelf() {
  const training = !!worker
  const full = shelf.length >= maxSlots()
  const text = full ? 'Shelf is full' : 'Put your car on the shelf'
  $('shelfCount').textContent = shelf.length + ' of ' + maxSlots()
  for (const id of ['shelve', 'spShelve', 'shelveQuick']) {
    const btn = $<HTMLButtonElement>(id)
    btn.disabled = !car || full
    btn.textContent = id === 'shelveQuick' ? (full ? 'Shelf is full' : 'Save to shelf') : text
  }
  shelfRows($('shelf'), training)
  shelfRows($('spShelf'), training)
  $('shelfBtn').replaceChildren('My cars ', Object.assign(document.createElement('b'), { textContent: shelf.length + '/' + maxSlots() }), ' ▾')
  $('spCount').textContent = shelf.length + ' of ' + maxSlots() + ' saved'
  $('spNow').textContent = car ? 'On the track now: ' + carLabel(car) : 'No car yet. Train one in Practice.'
  $('spEmpty').textContent = shelf.length ? '' : 'Keep a trained car here, try a different setup, and switch back if the new one is worse.'
  renderChip()
}
// the same car twice: an identical brain on an identical setup (two trainings of one setup differ, so both can be kept)
const sameCar = (a: CarFile, c: CarFile) => JSON.stringify(a.genome) === JSON.stringify(c.genome) && JSON.stringify(a.build) === JSON.stringify(c.build)
function shelveCar() {
  if (!car || shelf.length >= maxSlots()) return
  if (shelf.some((c) => sameCar(c, car!))) {
    const text = car.name + ' is already on your shelf.'
    carMsg(text)
    $('spMsg').textContent = text
    $('trainMsg').textContent = text
    return
  }
  shelf.push(clone(car))
  saveShelf()
  renderShelf()
  carMsg('Put ' + car.name + ' on the shelf.')
  $('spMsg').textContent = 'Put ' + car.name + ' on the shelf.'
  $('trainMsg').textContent = 'Saved ' + car.name + '. Get it back any time from My cars, top right, on any tab.'
}
$('shelve').addEventListener('click', shelveCar)
$('spShelve').addEventListener('click', shelveCar)
$('shelveQuick').addEventListener('click', (e) => {
  e.stopPropagation() // so the click that saves does not also count as a click outside the list
  shelveCar()
  setShelfPop(true) // show where the car went
})
// The CAR chip in the top bar opens the shelf from any tab
function setShelfPop(open: boolean) {
  $('shelfPop').hidden = !open
  $('shelfBtn').setAttribute('aria-expanded', String(open))
  if (open) $('spMsg').textContent = ''
}
$('raceCars').addEventListener('click', (e) => {
  e.stopPropagation()
  setShelfPop(true) // the list of saved cars, from the race screen
  window.scrollTo({ top: 0, behavior: 'smooth' })
})
$('shelfBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  setShelfPop($('shelfPop').hidden === true)
})
document.addEventListener('click', (e) => {
  if (!$('shelfPop').hidden && !(e.target as HTMLElement).closest('#shelfPop')) setShelfPop(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('shelfPop').hidden) {
    setShelfPop(false)
    $('shelfBtn').focus()
  }
})

// ---------- PRACTICE PANEL ----------
function renderPractice() {
  renderWatchOptions()
  if (!run && !lastRun) drawGraph([]) // idle (before anything has run this visit): the last run and your record for the chosen practice tracks
  const training = !!worker
  const spent = run?.spent ?? lastRun?.spent ?? 0
  const total = run?.budget ?? lastRun?.budget ?? TRAINING_BUDGET
  $('budgetBar').style.width = (100 * spent) / total + '%'
  $('budgetUsed').textContent = Math.round((100 * spent) / total) + '% of ' + (run ? (run.quick ? 'the full budget · quick run' : run.keep ? 'this short run' : 'a full run') : lastRun ? (lastRun.quick ? 'the full budget · quick run' : 'that run') : 'a full run')
  $('budgetGen').textContent = run
    ? 'round ' + run.history.length + (run.quick ? ' / ' + QUICK_GENERATION_LIMIT : '')
    : lastRun
      ? lastRun.generations + ' rounds · ' + (lastRun.quick ? 'quick run done' : 'done')
      : 'about ' + estGenerations(b) + ' rounds for a full run, ' + Math.max(1, Math.round(estGenerations(b) * KEEP_TRAINING_SHARE)) + ' for Keep training'
  $('trainState').textContent = training ? (run?.watching ? 'watching' : 'training') : 'ready'
  $('train').textContent = training ? 'Stop' : car ? 'Train a new car' : 'Start training'
  $('quickTrain').hidden = training
  $('skip').hidden = !(training && run?.watching)
  $<HTMLButtonElement>('keep').disabled = training || !canKeepTraining()
  $('keepHint').textContent = !car
    ? 'Keep training carries on from a car, so train one first.'
    : !canKeepTraining()
      ? 'Your car has a different number of rays from the garage, so it cannot be carried on. Train a new car instead.'
      : 'Keep training carries on from your car in about a third of the time. Add practice tracks or change what you reward first, then press it. If the result is worse, press Back to previous car.'
  $('swapCar').hidden = !previousCar
  $<HTMLButtonElement>('swapCar').disabled = training
  $('swapQuick').hidden = !previousCar
  $<HTMLButtonElement>('swapQuick').disabled = training
  $('swapQuick').title = previousCar ? 'Switch to ' + carLabel(previousCar) + ', the car you had before your last training' : ''
  $('spPrev').hidden = !previousCar
  if (previousCar) $('spPrevText').textContent = 'Before your last training: ' + carLabel(previousCar)
  const spec = specOf(b)
  const rows: [string, string][] = [
    ['Sensors', b.sensors.count + ' rays over a ' + b.sensors.spread + '° view'],
    ['Brain', genomeLength(brainShape(b)) + ' connections'],
    ['Top speed · cornering', kmh(spec.maxSpeed) + ' · ' + kmh(spec.gripSpeed)],
    ['Pace · crash · smooth', pct(b.reward.pace) + ' · ' + pct(b.reward.safety) + ' · ' + pct(b.reward.smooth)],
    ['Practice', b.practice.map((id) => TRACK_NAMES[id]).join(', ')],
    ['Road', (b.weather === 'wet' ? 'Wet' : 'Dry') + (b.cond?.night ? ' · night' : '') + (b.cond?.ice ? ' · ice patches' : '')],
    ['Skill tree', PARTS.filter((p) => levelOf(b.parts, p.id)).map((p) => p.name + (p.max > 1 ? ' ' + levelOf(b.parts, p.id) : '')).join(', ') || 'Nothing fitted'],
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
      : car.name + ' is trained and ready' + (car.runs ? ', from ' + car.runs + (car.runs === 1 ? ' training run.' : ' training runs (Keep training adds one each time).') : '.')
  $<HTMLButtonElement>('testDrive').disabled = !car || training
  $('testDriveActions').hidden = !car
  $('testDriveTip').hidden = !car
  $('testDrive').textContent = test ? 'Stop watching' : 'Watch it drive'
  $<HTMLButtonElement>('saveCar').disabled = !car
  $<HTMLButtonElement>('shareCar').disabled = !car
  $('topChallenge').title = car ? 'Copy a link that lets a friend race ' + car.name + ' and try to beat it' : 'Train a car first, then dare a friend to beat it'
  $('handGo').textContent = hand ? 'Stop driving' : 'Take the wheel'
  renderHandBoard()
  renderShelf()
  ensureBoard()
  renderBoard()
}

// ---------- YOUR REFERENCE ----------
// The best car's laps are only meaningful against something, so two references outlive a run: the best the game has ever seen
// on this set of practice tracks and this weather (a faint dashed line), and the previous run's whole curve (a faint line behind
// the new one). Both are kept per set of practice tracks and weather, because laps on different tracks cannot be compared.
const refKey = (bd: Build) => [...bd.practice].sort((x, y) => x - y).join(',') + '|' + (bd.weather === 'wet' ? 'wet' : 'dry')
const savedBests = load<Record<string, number>>(KEYS.bestLaps)
const bestLaps: Record<string, number> = savedBests && typeof savedBests === 'object' ? savedBests : {}
const savedCurves = load<Record<string, number[]>>(KEYS.lastCurve)
const lastCurves: Record<string, number[]> = savedCurves && typeof savedCurves === 'object' ? savedCurves : {}
let ghostCurve: number[] | null = null // the previous run's best-car curve, while a new run draws
const lapsText = (v: number) => v.toFixed(2) + (v >= 1 ? ' laps' : ' of a lap') + ' in 40 s'

// ---------- HOW TRAINING IS GOING ----------
// One plain line (still improving, or levelled off and ready to race) and a small sparkline of the best and
// average car, for anyone who wants the shape. A big chart was more than a game needs.
const RECENT = 10 // rounds compared, to tell improving from levelled off
const LEVEL_GAIN = 0.03 // the best car gaining less than 3% over the last 10 rounds counts as levelled off
function trainingStatus(history: History, record?: number): string {
  const rec = record !== undefined ? ' Your record on these practice tracks: ' + lapsText(record) + '.' : ''
  if (history.length === 0) return record !== undefined ? 'Your best car on these practice tracks reached ' + lapsText(record) + '. Train to beat it.' : 'Start training and you will see here whether your car is still getting better.'
  const best = history[history.length - 1].best
  const laps = lapsText(best)
  if (history.length < RECENT * 2) return 'Learning. Best car so far: ' + laps + '.' + rec
  const before = Math.max(...history.slice(-RECENT * 2, -RECENT).map((h) => h.best))
  const now = Math.max(...history.slice(-RECENT).map((h) => h.best))
  return now > before * (1 + LEVEL_GAIN)
    ? 'Still improving: best car ' + laps + ', up ' + Math.round((now / before - 1) * 100) + '% in the last ' + RECENT + ' rounds.' + rec
    : 'Levelled off at ' + laps + '. More rounds will change little: race it, or change the setup.' + rec
}
function drawGraph(history: History) {
  const key = refKey(run?.build ?? b)
  const record = bestLaps[key]
  // idle, the last run shows faintly; during a run, the run before it does
  const ghost = history.length ? ghostCurve : (lastCurves[key] ?? null)
  $('graphStatus').textContent = trainingStatus(history, record)
  $('graph').title = 'Bright: this run. Faint: the run before it. Dashed: your record on these practice tracks.'
  const Wg = gcanvas.width
  const Hg = gcanvas.height
  gctx.clearRect(0, 0, Wg, Hg)
  const n = Math.max(history.length, ghost?.length ?? 0)
  if (n < 2) return
  const maxY = Math.max(0.01, ...history.map((h) => h.best), ...(ghost ?? []), record ?? 0) * 1.08
  const x = (i: number) => 2 + (i / (n - 1)) * (Wg - 4)
  const y = (v: number) => Hg - 3 - (v / maxY) * (Hg - 6)
  const line = (vals: number[], colour: string, width: number) => {
    gctx.strokeStyle = colour
    gctx.lineWidth = width
    gctx.beginPath()
    vals.forEach((v, i) => (i === 0 ? gctx.moveTo(x(i), y(v)) : gctx.lineTo(x(i), y(v))))
    gctx.stroke()
  }
  gctx.globalAlpha = 0.4
  if (ghost) line(ghost, COL.muted, 1.5)
  if (record !== undefined) {
    gctx.setLineDash([4, 3])
    line([record, record], COL.accent, 1)
    gctx.setLineDash([])
  }
  gctx.globalAlpha = 1
  if (history.length > 1) {
    line(history.map((h) => h.mean), COL.tele, 1.5)
    line(history.map((h) => h.best), COL.accent, 2)
  }
}

// ---------- THE BIG SCREEN ----------
// The car the camera follows: the test-drive car or the lead car of the generation (none in the garage)
function focusCar(): Car | null {
  if (hand) return hand.car
  if (test) return test.car
  if (swarm && tab === 'practice') return swarm.cars[swarm.lead] // the Garage keeps its own view while a run goes on
  return null
}
let parkedCache: { key: string; car: Car } | null = null
function parked(): Car {
  const key = JSON.stringify(b.sensors) + (b.chassis ?? '') + b.balance + JSON.stringify(b.parts ?? {}) + ':' + focusTrack + ':' + (b.weather ?? 'dry') + JSON.stringify(b.cond ?? {})
  if (!parkedCache || parkedCache.key !== key) parkedCache = { key, car: createCar(practiceOn(focusTrack, b), specOf(b)) }
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
  } else fitTrack(cam, parked().track, tab !== 'garage')
  if (swarm && run && tab === 'practice') {
    const sw = swarm
    withCamera(ctx, cam, () => {
      drawTrack(ctx, sw.track)
      sw.trails.forEach((trail, i) => {
        if (trail.length < 2) return
        ctx.strokeStyle = i === sw.lead ? 'rgba(229,168,60,0.88)' : 'rgba(75,67,233,0.3)'
        ctx.lineWidth = i === sw.lead ? 3 : 2
        ctx.beginPath()
        ctx.moveTo(trail[0].x, trail[0].y)
        for (let k = 1; k < trail.length; k++) ctx.lineTo(trail[k].x, trail[k].y)
        ctx.stroke()
      })
      sw.cars.forEach((c) => c.dead && drawCrash(ctx, c.x, c.y))
      sw.cars.forEach((c, i) => !c.dead && i !== sw.lead && drawCar(ctx, c, 26, 14, COL.swarm))
      const lead = sw.cars[sw.lead]
      if (!lead.dead) drawMine(ctx, lead, 34, 18, look) // the followed car on top
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
  if (hand) {
    const hd = hand
    withCamera(ctx, cam, () => {
      drawTrack(ctx, hd.track)
      if (hd.ghost && !hd.ghost.dead) {
        ctx.globalAlpha = 0.45
        drawCar(ctx, hd.ghost, 34, 18, COL.tele, look)
        ctx.globalAlpha = 1
      }
      if (hd.hold > 0 && hd.crashAt && hd.car.dead) drawCrash(ctx, hd.crashAt.x, hd.crashAt.y)
      else drawMine(ctx, hd.car, 34, 18, look)
    })
    drawMinimap(ctx, hd.track, cam, hd.car)
    hudText(time(hd.car.steps / 60), 16, 50, 46)
    hudText('LAST ' + time(hd.lastLap) + '    BEST ' + time(hd.bestLap) + (hd.ghost ? '    ' + (car?.name ?? 'CAR').toUpperCase() + ' ' + (hd.ghostDone ? (hd.ghostTime === null ? 'CRASHED' : time(hd.ghostTime)) : 'DRIVING') : ''), 16, 74, 16, COL.muted)
    const sp = Math.max(0, hd.car.speed) / hd.car.spec.maxSpeed
    ctx.fillStyle = COL.road
    ctx.fillRect(W - 216, H - 28, 200, 10)
    ctx.fillStyle = sp > 0.85 ? COL.bad : COL.tele
    ctx.fillRect(W - 216, H - 28, 200 * sp, 10)
    hudText('SPEED', W - 216, H - 36, 13, COL.muted)
    if (hd.car.spec.nitro) {
      ctx.fillStyle = COL.road
      ctx.fillRect(W - 216, H - 56, 200, 8)
      ctx.fillStyle = COL.accent
      ctx.fillRect(W - 216, H - 56, 200 * (hd.car.boost / NITRO_STEPS), 8)
      hudText('NITRO', W - 216, H - 62, 13, COL.muted)
    }
    if (hd.hold > 0 && hd.car.dead) hudText('CRASHED', W / 2, H / 2, 40, COL.bad, 'center')
    else if (hd.hold > 0) hudText('LAP ' + time(hd.lastLap), W / 2, H / 2, 40, COL.good, 'center')
    setStrip([
      ['You', 'DRIVING'],
      ['Attempts', String(hd.tries + 1)],
      ['Lap progress', Math.round((100 * hd.car.passed) / CHECKPOINTS) + '<small>%</small>'],
      ['Speed', kmh(Math.max(0, hd.car.speed))],
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
        drawMine(ctx, t.car, 34, 18, look)
      }
    })
    drawMinimap(ctx, t.track, cam, t.car)
    if (t.crashFrames === 0 && carBrain) {
      const inputs = getInputs(t.car)
      const thought = think(carBrain, inputs)
      drawBrain(ctx, { inputs, hidden: thought.hidden, outputs: thought.outputs, rays: t.car.spec.rayAngles.length }, W - 296, 12, 284, 132)
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
      ['Speed', kmh(Math.max(0, t.car.speed))],
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
    drawMine(ctx, p, 34, 18, look)
  })
  if (zoomedIn) {
    hudText(b.sensors.count + ' RAYS', 16, 38, 26)
    hudText(b.sensors.spread + '° VIEW · RANGE ' + p.spec.rayRange + ' PX', 16, 58, 14, COL.accent)
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
    ['Brain', genomeLength(brainShape(b)) + '<small> connections</small>'],
    ['Top speed', kmh(specOf(b).maxSpeed)],
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
    tickHand()
    if (tab === 'race') raceView?.tick()
    owed -= STEP
  }
  updateTip()
  stepSwarm(Math.min(elapsed / STEP, 6)) // below 10 frames a second the replay slows down rather than stalling the screen
  buildOneThumb()
  draw()
  requestAnimationFrame(loop)
}

// fold the side panels: one open at a time in each tab
setupFolds(['garage', 'skills', 'practice', 'race', 'profile'], ['garage'])
$('raceGo').addEventListener('click', () => reveal($('tower'))) // a race fills the timing tower, so show it

const leaderboard = createLeaderboard({
  getCar: () => car,
  getShelf: () => shelf,
  getGpId: () => raceView!.gpId(),
  goRace: (section) => {
    setTab('race')
    if (section) setRaceSection(section)
  },
  notify: showNotice,
  onEntered: () => showDare('entered'),
  // a car from the board becomes the car to beat, raced on this device like a friend's challenge
  raceAgainst: (rival, gp) => {
    setChallenge(rival)
    if (typeof gp === 'string') {
      setRaceSection('gp')
      raceView!.selectGpId(gp)
    } else openPastIn(gp)
    setTab('race')
    $('challengePanel').scrollIntoView({ behavior: 'smooth', block: 'center' })
  },
  openWeek: (gp) => {
    openPastIn(gp)
    setTab('race')
    $('gpTitle').scrollIntoView({ behavior: 'smooth', block: 'center' })
  },
})
raceView = createRaceView({ onResult: (gpId, r) => {
  leaderboard.showResult(gpId, r)
  if (r) announceParts()
},  ctx, cam, getCar: () => car, isStale: carIsStale, getChallenge: () => challenge, getLook: () => look, goTo: setTab, hudText, setStrip })


// ---------- DARE A FRIEND ----------
// Nothing else in the game says a car can be sent to a friend, so a dialog asks, right after a car is trained and right after
// it goes on a board. It stops once the player has shared once, or has been asked three times.
const ASKS = 'crashlab.dareAsks'
const asked = () => Number(localStorage.getItem(ASKS)) || 0
const dareDialog = $<HTMLDialogElement>('dareDialog')
function showDare(kind: 'trained' | 'entered' | 'asked') {
  if (dareDialog.open) return
  if (!car) {
    $('dareTitle').textContent = 'Train a car first'
    $('dareText').textContent = 'Once your car is trained, you can challenge a friend to race it.'
    $('dareMsg').textContent = ''
    $('dareGo').textContent = 'Go to Practice'
    $('dareLink').hidden = true
    dareDialog.showModal()
    return
  }
  if (kind !== 'asked' && (counts().shares > 0 || asked() >= 3)) return
  if (kind !== 'asked') try {
    localStorage.setItem(ASKS, String(asked() + 1))
  } catch {
    /* storage blocked: it may ask again */
  }
  $('dareTitle').textContent = kind === 'asked' ? 'Challenge a friend' : kind === 'trained' ? car.name + ' is trained' : car.name + ' is entered'
  $('dareText').textContent =
    kind === 'asked'
      ? 'They open your link, race ' + car.name + ' on the same secret tracks, and try to beat it. Nobody has to sign in.'
      : kind === 'trained'
      ? 'Before you race it, dare a friend. They open your link, race your car on the same secret tracks, and try to beat it. Nobody has to sign in.'
      : 'While the game trains your setup for the board, dare a friend to beat your car. The link comes with your result card, ready to paste into a chat. Nobody has to sign in.'
  $('dareMsg').textContent = ''
  $('dareGo').textContent = 'Copy challenge link'
  $('dareLink').hidden = true
  dareDialog.showModal()
}
$('dareNo').addEventListener('click', () => dareDialog.close())
$('topChallenge').addEventListener('click', () => showDare('asked')) // always in the top bar, so the option is never hidden
$('dareGo').addEventListener('click', async () => {
  if (!car) {
    dareDialog.close()
    setTab('practice')
    return
  }
  await shareCar((text) => ($('dareMsg').textContent = text), $<HTMLInputElement>('dareLink'), true)
  if (!$('dareLink').hidden) return // it could not copy: the link is shown to copy by hand
  $('dareGo').textContent = 'Copied ✓'
  setTimeout(() => dareDialog.open && dareDialog.close(), 1400)
})
// the challenge buttons glow until the first share
function refreshHot() {
  const hot = counts().shares === 0
  document.querySelectorAll('.hot').forEach((e) => e.classList.toggle('on', hot))
}

// ---------- CHALLENGE LINKS ----------
// Share: the car goes into a link, so a friend can race it with no server.
// It is offered under Your car in Practice, and under the result of a race, where the wish to show it off is greatest.
async function shareCar(say: (text: string) => void, box: HTMLInputElement, afterRace = false) {
  if (!car) return
  const c = car
  say('Making your link…')
  // a short link from the server when it can be reached, else the long one that carries the whole car.
  // The link always comes with words: the latest race's card, or this car's result on Grand Prix 1.
  const textP = shortCode(c, API).then((code) => {
    const link = location.origin + location.pathname + (code ? SHORT_PREFIX + code : challengeCode(c))
    return (afterRace ? raceView?.shareText(link) : null) ?? cardText(c.name, GRAND_PRIXES[0], raceCar(c, GRAND_PRIXES[0]), link)
  })
  const copied = () => {
    logEvent({ k: 'share' })
    refreshHot()
    box.hidden = true
    say('Copied: a message with ' + c.name + "'s result and a link. Paste it into a chat. Anyone who opens the link can race your car and try to beat it.")
  }
  try {
    // Safari only lets a page copy during the tap itself; handing it the text as a promise keeps that tap valid while
    // the server makes the short code
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': textP.then((t) => new Blob([t], { type: 'text/plain' })) })])
    } else await navigator.clipboard.writeText(await textP)
    copied()
    return
  } catch {
    /* try the plain way, then show the text */
  }
  const text = await textP
  try {
    await navigator.clipboard.writeText(text)
    copied()
  } catch {
    box.value = text.replace(/\n/g, ' ') // the browser would not copy for us: show the text to copy by hand
    box.hidden = false
    box.select()
    say('Copy this and send it. Anyone who opens the link can race your car.')
  }
}
$('shareCar').addEventListener('click', () => shareCar(carMsg, $<HTMLInputElement>('shareLink')))
$('resultShare').addEventListener('click', () => shareCar((text) => ($('resultMsg').textContent = text), $<HTMLInputElement>('resultLink'), true))
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
  if (location.hash.startsWith(SHORT_PREFIX)) {
    const hash = location.hash
    history.replaceState(null, '', location.pathname + location.search)
    setTab('race')
    setRaceSection('gp')
    $('challengePanel').hidden = false
    $('challengeLine').textContent = 'Loading the challenge…'
    carFromShort(hash, API).then((got) => {
      if (!got) return
      if ('error' in got) challenge = got
      else setChallenge(got)
      raceView?.render()
    })
    return
  }
  const fromLink = carFromChallenge(location.hash)
  if (fromLink) {
    history.replaceState(null, '', location.pathname + location.search) // the long code is not left in the address bar
    if ('error' in fromLink) challenge = fromLink
    else setChallenge(fromLink)
    setTab('race')
    setRaceSection('gp')
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
  if (location.hash.startsWith('#challenge=') || location.hash.startsWith(SHORT_PREFIX)) takeChallenge()
})
const cameSection = (() => {
  try {
    const v = sessionStorage.getItem('crashlab.section') as RaceSection | null
    sessionStorage.removeItem('crashlab.section')
    return v === 'hub' || v === 'gp' || v === 'daily' || v === 'weekly' ? v : null
  } catch {
    return null
  }
})()
// the Race tab starts on its menu (with no board server there is only the Grand Prix); after Use reloads the page it returns to where it was
setRaceSection(API ? (cameSection === 'daily' || cameSection === 'weekly' ? 'hub' : cameSection ?? 'hub') : 'gp')
takeChallenge()
const today = visit()
refreshHot()
raceView.render()
renderGarage()
renderLooks()
renderChip()
drawGraph([])

if (today.fresh.length) showNotice('New perk' + (today.fresh.length > 1 ? 's' : '') + ' for coming back: ' + today.fresh.map((p) => p.name).join(', ') + '. ' + today.fresh[0].does)
setTab(tab) // the Garage, unless a challenge link has already sent the player to the Race tab
requestAnimationFrame(loop)
