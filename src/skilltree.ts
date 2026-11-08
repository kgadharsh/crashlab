// The skill tree as a network: the car in the middle, five branches running out from it, and a node at each step. A node
// glows when it is fitted, is plain when it can be fitted, and shows a lock when it has not been earned yet. Tapping a node
// opens its card underneath, where it is fitted or taken off. The rules live in parts.ts and setup.ts; this file only draws.
import { PARTS, type Branch, type Part, type PartId, type Progress } from './parts'
import { POINT_BUDGET, levelOf, pointsUsed, type Build } from './setup'

const NS = 'http://www.w3.org/2000/svg'
const CX = 290
const CY = 306
const BRANCHES: { name: Branch; angle: number; colour: string; blurb: string }[] = [
  { name: 'Eyes', angle: -90, colour: '#3fd0ff', blurb: 'what the car sees' },
  { name: 'Engine', angle: -18, colour: '#ffb31a', blurb: 'how it moves' },
  { name: 'Tyres', angle: 54, colour: '#3ddc84', blurb: 'what it grips' },
  { name: 'Brain', angle: 126, colour: '#b48cff', blurb: 'how it thinks' },
  { name: 'Practice', angle: 198, colour: '#ff7a9c', blurb: 'how it trains' },
]
const ICON: Record<PartId, string> = {
  range: '🔭', focus: '🎯', lens: '👀', lights: '🔦',
  launch: '🚀', quick: '⚡', feather: '🪶', wing: '✈️',
  tyres: '🌧️', steady: '🧭', studs: '❄️',
  brain: '🧠', grip: '🧲', slot: '🏁',
  wide: '↔️', brakes: '🛑', turbo: '🌀', inters: '💧', lean: '🍃', huge: '🐘', slot2: '🗺️',
}
const R0 = 126
const RSTEP = 48

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  parent?.appendChild(e)
  return e
}
const polar = (angle: number, r: number) => ({ x: CX + r * Math.cos((angle * Math.PI) / 180), y: CY + r * Math.sin((angle * Math.PI) / 180) })

export type TreeDeps = {
  svgBox: HTMLElement
  detail: HTMLElement
  getBuild: () => Build
  getProgress: () => Progress
  getName: () => string
  setLevel: (id: PartId, level: number) => void
}

export function createSkillTree(d: TreeDeps) {
  let selected: PartId = 'range'
  const svg = el('svg', { viewBox: '0 0 580 612', role: 'group', 'aria-label': 'Skill tree' })
  svg.classList.add('tree')
  d.svgBox.replaceChildren(svg)

  // Each branch is a small tree: a node hangs from its parent, siblings fan out across the branch's slice of the circle, and
  // depth sets the distance from the car. Leaves get evenly spaced angles and a parent sits at the middle of its children.
  const pos = new Map<PartId, { x: number; y: number; branch: (typeof BRANCHES)[number] }>()
  const kids = (id: PartId | undefined, branch: Branch) => PARTS.filter((p) => p.branch === branch && p.parent === id)
  for (const br of BRANCHES) {
    const nodes = PARTS.filter((p) => p.branch === br.name)
    const leaves = nodes.filter((n) => !nodes.some((m) => m.parent === n.id)).length
    const step = Math.min(24, 64 / Math.max(1, leaves))
    let next = 0
    const place = (part: Part, depth: number): number => {
      const children = kids(part.id, br.name)
      const angle = children.length ? children.map((c) => place(c, depth + 1)).reduce((a, c) => a + c, 0) / children.length : br.angle + (next++ - (leaves - 1) / 2) * step
      pos.set(part.id, { ...polar(angle, R0 + RSTEP * depth), branch: br })
      return angle
    }
    kids(undefined, br.name).forEach((root) => place(root, 0))
  }

  // the picture is built once and then only repainted, so a tap never makes the tree jump
  const links = el('g', {}, svg)
  const ring = el('circle', { cx: CX, cy: CY, r: 60, class: 'hub-ring', fill: 'none' }, svg)
  ring.setAttribute('transform', `rotate(-90 ${CX} ${CY})`)
  ring.setAttribute('stroke-dasharray', String(2 * Math.PI * 60))
  el('circle', { cx: CX, cy: CY, r: 60, class: 'hub-track', fill: 'none' }, svg).setAttribute('transform', `rotate(-90 ${CX} ${CY})`)
  el('circle', { cx: CX, cy: CY, r: 44, class: 'hub' }, svg)
  const hubTop = el('text', { x: CX, y: CY - 4, class: 'hub-t' }, svg)
  const hubSub = el('text', { x: CX, y: CY + 14, class: 'hub-s' }, svg)
  // inner ring joining the first node of each branch, so the tree reads as one network
  const linkEls: { line: SVGElement; b: PartId; branch: (typeof BRANCHES)[number] }[] = []
  for (const part of PARTS) {
    const from = part.parent ? pos.get(part.parent)! : { x: CX, y: CY }
    const to = pos.get(part.id)!
    const line = el('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: 'link' }, links)
    linkEls.push({ line, b: part.id, branch: to.branch })
  }
  BRANCHES.forEach((br, i) => {
    const next = BRANCHES[(i + 1) % BRANCHES.length]
    const a = pos.get(PARTS.find((p) => p.branch === br.name && !p.parent)!.id)!
    const c = pos.get(PARTS.find((p) => p.branch === next.name && !p.parent)!.id)!
    el('line', { x1: a.x, y1: a.y, x2: c.x, y2: c.y, class: 'cross' }, links)
  })
  const nodeEls = new Map<PartId, { g: SVGGElement; disc: SVGElement; icon: SVGElement; lock: SVGElement; pips: SVGElement }>()
  for (const part of PARTS) {
    const p = pos.get(part.id)!
    const g = el('g', { class: 'node', tabindex: 0, role: 'button', transform: `translate(${p.x} ${p.y})` }, svg) as SVGGElement
    g.style.setProperty('--nc', p.branch.colour)
    el('circle', { r: 26, class: 'halo', fill: p.branch.colour }, g)
    const disc = el('circle', { r: 21, class: 'disc', stroke: p.branch.colour }, g)
    const icon = el('text', { y: 6, class: 'icon' }, g)
    icon.textContent = ICON[part.id]
    const lock = el('text', { x: 14, y: 20, class: 'lockmark' }, g)
    lock.textContent = '🔒'
    el('circle', { cx: 16, cy: -16, r: 8, class: 'ptbg' }, g)
    const pips = el('text', { x: 16, y: -12.5, class: 'pts' }, g)
    pips.textContent = String(part.points)
    const pick = () => {
      selected = part.id
      render()
    }
    g.addEventListener('click', pick)
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        pick()
      }
    })
    nodeEls.set(part.id, { g, disc, icon, lock, pips })
  }

  // branch names sit between the car and the first node
  for (const br of BRANCHES) {
    const trunk = pos.get(PARTS.find((q) => q.branch === br.name && !q.parent)!.id)!
    const p = polar((Math.atan2(trunk.y - CY, trunk.x - CX) * 180) / Math.PI, 88)
    const t = el('text', { x: p.x, y: p.y + 3, class: 'branch-t', fill: br.colour }, svg)
    t.textContent = br.name.toUpperCase()
  }
  // ---------- THE CARD UNDER THE TREE ----------
  const card = {
    title: Object.assign(document.createElement('b'), { className: 'nt' }),
    does: document.createElement('p'),
    cost: document.createElement('p'),
    lock: document.createElement('p'),
    btn: Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary' }),
  }
  card.does.className = 'tip nd'
  card.cost.className = 'tip nc'
  card.lock.className = 'tip nl'
  const head = Object.assign(document.createElement('div'), { className: 'nhead' })
  head.append(card.title, card.btn)
  d.detail.replaceChildren(head, card.does, card.cost, card.lock)
  card.btn.addEventListener('click', () => {
    const part = PARTS.find((p) => p.id === selected)!
    const level = levelOf(d.getBuild().parts, part.id)
    d.setLevel(part.id, level > 0 && level >= part.max ? 0 : level + 1)
  })

  function render() {
    const b = d.getBuild()
    const prog = d.getProgress()
    const used = pointsUsed(b.parts)
    let open = 0
    for (const part of PARTS) {
      const n = nodeEls.get(part.id)!
      const unlocked = part.open(prog)
      if (unlocked) open++
      const level = levelOf(b.parts, part.id)
      const fits = used + part.points <= POINT_BUDGET
      n.g.classList.toggle('on', level > 0)
      n.g.classList.toggle('locked', !unlocked)
      n.g.classList.toggle('short', unlocked && level === 0 && !fits) // earned but not enough points left
      n.g.classList.toggle('sel', part.id === selected)
      n.lock.style.display = unlocked ? 'none' : ''
      n.g.setAttribute('aria-label', part.name + ', ' + (level ? 'fitted' : unlocked ? 'not fitted' : 'locked'))
      n.g.setAttribute('aria-pressed', String(part.id === selected))
    }
    // a link is lit when the node beyond it is fitted, so a fitted build shows as a glowing network
    for (const l of linkEls) {
      const lit = levelOf(b.parts, l.b) > 0
      l.line.classList.toggle('lit', lit)
      l.line.style.stroke = lit ? l.branch.colour : ''
    }
    // the ring round the car fills as points are spent
    const full = 2 * Math.PI * 60
    ring.setAttribute('stroke-dashoffset', String(full * (1 - used / POINT_BUDGET)))
    ring.classList.toggle('full', used >= POINT_BUDGET)
    hubTop.textContent = String(POINT_BUDGET - used)
    hubSub.textContent = 'POINTS LEFT'
    // the card
    const part = PARTS.find((p) => p.id === selected)!
    const unlocked = part.open(prog)
    const level = levelOf(b.parts, part.id)
    const br = BRANCHES.find((x) => x.name === part.branch)!
    card.title.textContent = part.name + ' · ' + part.points + (part.points === 1 ? ' point' : ' points')
    card.title.style.color = br.colour
    card.does.textContent = part.does
    card.cost.textContent = 'Cost: ' + part.cost
    card.lock.textContent = unlocked ? '' : 'Locked · ' + part.unlock
    card.btn.hidden = false
    card.btn.disabled = !unlocked && level === 0 ? true : level === 0 && used + part.points > POINT_BUDGET
    card.btn.textContent = !unlocked && level === 0 ? 'Locked' : level >= part.max ? 'Take off' : level ? '+1 level' : used + part.points > POINT_BUDGET ? 'Not enough points' : 'Fit it'
    card.btn.classList.toggle('primary', level < part.max)
    return { used, open }
  }
  return { render, select: (id: PartId) => ((selected = id), render()) }
}

export type { Part }
