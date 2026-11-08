// The profile: everything the player has earned in this browser, in one place. Badges, medal records, best race times,
// times driven by hand and the streak. It only reads what the rest of the game already keeps, and writes nothing.
import { bestOn, loadFewest, loadMedals, type Medals } from './board'
import { GRAND_PRIXES, RACE_COUNT, medalFor, type Medal } from './race'
import { loadBest } from './raceView'
import { PARTS, type Progress } from './parts'
import { LOOKS } from './looks'
import { handBest, handMedal } from './driver'
import { PERKS, streak } from './perks'
import { counts } from './playLog'

export type ProfileData = { carName: string; stars: number; progress: Progress; trackNames: string[]; look: number }

type Badge = { icon: string; name: string; hint: string; got: boolean }

function badges(d: ProfileData, medals: Medals): Badge[] {
  const all = Object.values(medals)
  const gps = GRAND_PRIXES.map((gp) => {
    const b = loadBest(gp)
    return b ? medalFor(b, gp) : null
  })
  const c = counts()
  const s = streak()
  const clean = GRAND_PRIXES.some((gp) => loadBest(gp)?.finished === RACE_COUNT)
  return [
    { icon: '🏁', name: 'First lap', hint: 'Finish a lap on the track board', got: all.length > 0 },
    { icon: '🥇', name: 'Track gold', hint: 'Win gold on any practice track', got: all.some((m) => m.medal === 'gold') },
    { icon: '🧹', name: 'Clean sweep', hint: 'Finish all ' + RACE_COUNT + ' race tracks in one race', got: clean },
    { icon: '🏆', name: 'Podium', hint: 'Win a Grand Prix medal', got: gps.some((m) => m !== null) },
    { icon: '👑', name: 'Grand Prix gold', hint: 'Win gold in a Grand Prix', got: gps.includes('gold') },
    { icon: '🌧️', name: 'Rain driver', hint: 'Finish the wet Grand Prix', got: (loadBest(GRAND_PRIXES[1])?.finished ?? 0) > 0 },
    { icon: '📅', name: 'Weekender', hint: 'Race a Weekly Grand Prix', got: d.progress.racedWeekly },
    { icon: '🧑‍🔧', name: 'Hands on', hint: 'Drive 3 practice tracks yourself', got: d.progress.licence >= 3 },
    { icon: '🎓', name: 'Licensed', hint: 'Drive 8 practice tracks yourself', got: d.progress.licence >= 8 },
    { icon: '🌳', name: 'Fully grown', hint: 'Unlock every node in the skill tree', got: PARTS.every((p) => p.open(d.progress)) },
    { icon: '🔥', name: 'On a roll', hint: 'Play on 3 days in a row', got: s.best >= 3 },
    { icon: '🔁', name: 'Regular', hint: 'Play on 7 days in a row', got: s.best >= 7 },
    { icon: '📣', name: 'Showman', hint: 'Share a challenge', got: c.shares > 0 },
    { icon: '🧪', name: 'Tinkerer', hint: 'Train 5 cars', got: c.trainings >= 5 },
  ]
}

const h = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text })
const dot = (m: Medal | undefined) => {
  const i = h('i', 'dot ' + (m ?? 'none'))
  i.title = m ?? 'no medal'
  return i
}
const section = (title: string, note = '') => {
  const s = h('div', 'psec')
  const t = h('h3', '', title)
  if (note) t.append(h('span', 'aside', note))
  s.append(t)
  return s
}

export function renderProfile(root: HTMLElement, d: ProfileData) {
  const medals = loadMedals()
  const list = badges(d, medals)
  const earned = list.filter((b) => b.got).length
  const s = streak()
  const c = counts()

  // top: who this is
  const top = h('div', 'ptop')
  const lookName = LOOKS[d.look]?.name ?? 'Classic'
  top.append(h('div', 'pname', d.carName), h('div', 'psub', lookName + ' design · ★ ' + d.stars + ' · ' + earned + ' of ' + list.length + ' badges'))
  const numbers = h('div', 'pnums')
  for (const [v, k] of [
    [String(c.races), 'races'],
    [String(c.trainings), 'trainings'],
    [String(d.progress.licence) + '/' + d.trackNames.length, 'driven by hand'],
    [s.days + (s.days === 1 ? ' day' : ' days'), 'streak'],
  ] as const) {
    const cell = h('div', 'pnum')
    cell.append(h('b', '', v), h('small', '', k))
    numbers.append(cell)
  }
  top.append(numbers)

  // badges
  const bs = section('Badges', earned + ' of ' + list.length)
  const grid = h('div', 'badges')
  for (const b of list) {
    const cell = h('div', 'badge' + (b.got ? ' got' : ''))
    cell.title = b.hint
    cell.append(h('span', 'bi', b.got ? b.icon : '🔒'), h('b', '', b.name), h('small', '', b.got ? 'Earned' : b.hint))
    grid.append(cell)
  }
  bs.append(grid)

  // best race times
  const rs = section('Race records')
  for (const gp of GRAND_PRIXES) {
    const best = loadBest(gp)
    const medal = best ? medalFor(best, gp) : null
    const fewest = loadFewest(gp.id)
    const row = h('div', 'prow')
    row.append(dot(medal), h('span', 'pl', gp.name))
    const val = h('span', 'pv', best ? best.finished + '/' + RACE_COUNT + (best.finished === RACE_COUNT ? ' · ' + best.totalTime.toFixed(1) + ' s' : '') : 'not raced')
    row.append(val)
    rs.append(row)
    const sub = (['gold', 'silver', 'bronze'] as const).filter((m) => fewest[m] !== undefined).map((m) => m + ' in ' + fewest[m] + ' rounds').join(' · ')
    if (best) rs.append(h('div', 'psmall', (best.name ? best.name + ' · ' : '') + (sub || 'No medal yet')))
  }

  // track medals (car) and laps by hand
  const ts = section('Track records', 'car (dry) · you (dry)')
  const wet = false
  d.trackNames.forEach((name, id) => {
    const row = h('div', 'prow')
    const car = bestOn(medals, id, wet)
    const hand = handBest(id, wet)
    row.append(dot(car?.medal), h('span', 'pl', name), h('span', 'pv', (car ? car.time.toFixed(1) + ' s' : '–') + '  ·  '))
    const mine = h('span', 'pv hand', hand !== null ? hand.toFixed(1) + ' s' : '–')
    row.lastElementChild!.append(dot(handMedal(id, wet)), mine)
    ts.append(row)
  })
  const wetCount = Object.keys(medals).filter((k) => k.endsWith(':wet')).length
  ts.append(h('div', 'psmall', 'Medals on ' + Object.keys(medals).length + ' track and road combinations' + (wetCount ? ', ' + wetCount + ' of them wet' : '') + '.'))

  // streak and perks
  const ps = section('Streak and perks', s.days ? s.days + (s.days === 1 ? ' day' : ' days') + ' in a row' : 'start one today')
  for (const p of PERKS) {
    const got = s.best >= p.days
    const row = h('div', 'perk' + (got ? ' got' : ''))
    row.append(h('span', 'pd', got ? '✓' : String(p.days)), h('b', '', p.name), h('small', '', got ? p.does : 'Play on ' + p.days + ' days in a row · ' + p.does))
    ps.append(row)
  }
  ps.append(h('div', 'psmall', 'A perk stays yours once you have it, even if the streak ends. Best streak so far: ' + s.best + (s.best === 1 ? ' day.' : ' days.')))

  root.replaceChildren(top, bs, rs, ts, ps)
}
