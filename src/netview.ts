import { type Brain, type Thought } from './brain'
import { C } from './theme'

export const INPUT_LABELS = ['ray -60°', 'ray -30°', 'ray 0°', 'ray +30°', 'ray +60°', 'speed']
export const OUTPUT_LABELS = ['steer', 'throttle']

const COLUMN_X = { input: 100, hidden: 220, output: 330 }
const NODE_RADIUS = 17
const EDGE_REACH = 8 // how close a click must land to a connection

type Node = { x: number; y: number }

// What the user has clicked in the panel
export type Selection =
  | { kind: 'node'; layer: 'input' | 'hidden' | 'output'; index: number }
  | { kind: 'edge'; layer: 'first' | 'second'; from: number; to: number }
  | null

export type Edge = { layer: 'first' | 'second'; from: number; to: number }
export const sameEdge = (a: Edge, b: Edge) => a.layer === b.layer && a.from === b.from && a.to === b.to

// Evenly spaced nodes down one column
function column(x: number, count: number): Node[] {
  const top = 90
  const bottom = 410
  const step = (bottom - top) / count
  return Array.from({ length: count }, (_, i) => ({ x, y: top + step * (i + 0.5) }))
}

// The neurons of all three columns
function layout(brain: Brain) {
  return {
    inNodes: column(COLUMN_X.input, brain.w1[0].length),
    hidNodes: column(COLUMN_X.hidden, brain.w1.length),
    outNodes: column(COLUMN_X.output, brain.w2.length),
  }
}

function distToLine(x: number, y: number, a: Node, b: Node): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))
}

// What is at this spot of the panel? Neurons win over the lines that run into them.
export function hitTest(brain: Brain, x: number, y: number, editable: Edge[] = []): Selection {
  const { inNodes, hidNodes, outNodes } = layout(brain)
  const near = (nodes: Node[]) => nodes.findIndex((n) => Math.hypot(x - n.x, y - n.y) <= NODE_RADIUS + 5)
  const input = near(inNodes)
  if (input >= 0) return { kind: 'node', layer: 'input', index: input }
  const hidden = near(hidNodes)
  if (hidden >= 0) return { kind: 'node', layer: 'hidden', index: hidden }
  const output = near(outNodes)
  if (output >= 0) return { kind: 'node', layer: 'output', index: output }

  let best: Selection = null
  let bestDist = EDGE_REACH
  const search = (layer: 'first' | 'second', from: Node[], to: Node[], weights: number[][]) => {
    to.forEach((b, t) =>
      from.forEach((a, f) => {
        const open = editable.some((e) => sameEdge(e, { layer, from: f, to: t }))
        if (Math.abs(weights[t][f]) < 0.01 && !open) return // not drawn, so not clickable
        const d = distToLine(x, y, a, b)
        if (d < bestDist) {
          bestDist = d
          best = { kind: 'edge', layer, from: f, to: t }
        }
      }),
    )
  }
  search('first', inNodes, hidNodes, brain.w1)
  search('second', hidNodes, outNodes, brain.w2)
  return best
}

// Blue = positive, red = negative. Brighter = stronger.
function nodeColor(value: number): string {
  const strength = Math.min(1, Math.abs(value))
  const lightness = 18 + 52 * strength
  return value >= 0 ? `hsl(210, 90%, ${lightness}%)` : `hsl(0, 80%, ${lightness}%)`
}

// Draw the connections between two columns.
// Colour = which way the signal pushes (blue up, red down). Bright = strong signal right now.
function drawEdges(
  ctx: CanvasRenderingContext2D,
  from: Node[],
  to: Node[],
  weights: number[][],
  activations: number[],
) {
  for (let t = 0; t < to.length; t++) {
    for (let f = 0; f < from.length; f++) {
      const w = weights[t][f]
      if (Math.abs(w) < 0.01) continue // skip connections that do nothing
      const signal = w * activations[f]
      const alpha = 0.12 + 0.88 * Math.min(1, Math.abs(signal))
      ctx.strokeStyle = signal >= 0 ? `rgba(80,160,255,${alpha})` : `rgba(255,90,90,${alpha})`
      ctx.lineWidth = 0.5 + Math.min(3, Math.abs(w))
      ctx.beginPath()
      ctx.moveTo(from[f].x, from[f].y)
      ctx.lineTo(to[t].x, to[t].y)
      ctx.stroke()
    }
  }
}

function drawNodes(ctx: CanvasRenderingContext2D, nodes: Node[], values: number[]) {
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < nodes.length; i++) {
    ctx.fillStyle = nodeColor(values[i])
    ctx.beginPath()
    ctx.arc(nodes[i].x, nodes[i].y, NODE_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = 'white'
    ctx.fillText(values[i].toFixed(2), nodes[i].x, nodes[i].y)
  }
}

// The name and current numbers of what is selected, in plain words
export const hiddenName = (i: number) => 'hidden neuron ' + (i + 1)

function describeSelection(sel: NonNullable<Selection>, brain: Brain, inputs: number[], thought: Thought): string {
  if (sel.kind === 'node') {
    if (sel.layer === 'input') return INPUT_LABELS[sel.index] + ': ' + inputs[sel.index].toFixed(2)
    if (sel.layer === 'hidden') return hiddenName(sel.index) + ': ' + thought.hidden[sel.index].toFixed(2)
    return OUTPUT_LABELS[sel.index] + ': ' + thought.outputs[sel.index].toFixed(2)
  }
  if (sel.layer === 'first') {
    const w = brain.w1[sel.to][sel.from]
    return INPUT_LABELS[sel.from] + ' to ' + hiddenName(sel.to) + ': weight ' + w.toFixed(2)
  }
  const w = brain.w2[sel.to][sel.from]
  return hiddenName(sel.from) + ' to ' + OUTPUT_LABELS[sel.to] + ': weight ' + w.toFixed(2)
}

export function drawNetwork(
  ctx: CanvasRenderingContext2D,
  brain: Brain,
  inputs: number[],
  thought: Thought,
  title: string,
  selection: Selection = null,
  editable: Edge[] = [],
  blinded: boolean[] = [],
) {
  ctx.fillStyle = C.ground
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const { inNodes, hidNodes, outNodes } = layout(brain)

  drawEdges(ctx, inNodes, hidNodes, brain.w1, inputs)
  drawEdges(ctx, hidNodes, outNodes, brain.w2, thought.hidden)

  // connections the player may change right now
  ctx.strokeStyle = C.accent
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.beginPath()
  for (const e of editable) {
    const [from, to] = e.layer === 'first' ? [inNodes, hidNodes] : [hidNodes, outNodes]
    ctx.moveTo(from[e.from].x, from[e.from].y)
    ctx.lineTo(to[e.to].x, to[e.to].y)
  }
  ctx.stroke()
  ctx.setLineDash([])

  drawNodes(ctx, inNodes, inputs)
  drawNodes(ctx, hidNodes, thought.hidden)
  drawNodes(ctx, outNodes, thought.outputs)

  // a blinded input gets a red cross
  ctx.strokeStyle = C.negative
  ctx.lineWidth = 3
  ctx.beginPath()
  blinded.forEach((off, i) => {
    if (!off) return
    const n = inNodes[i]
    ctx.moveTo(n.x - 12, n.y - 12)
    ctx.lineTo(n.x + 12, n.y + 12)
    ctx.moveTo(n.x + 12, n.y - 12)
    ctx.lineTo(n.x - 12, n.y + 12)
  })
  ctx.stroke()

  // a white outline marks what is selected
  ctx.strokeStyle = 'white'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  if (selection?.kind === 'node') {
    const nodes = selection.layer === 'input' ? inNodes : selection.layer === 'hidden' ? hidNodes : outNodes
    const n = nodes[selection.index]
    ctx.arc(n.x, n.y, NODE_RADIUS + 3, 0, Math.PI * 2)
  } else if (selection?.kind === 'edge') {
    const [from, to] = selection.layer === 'first' ? [inNodes, hidNodes] : [hidNodes, outNodes]
    ctx.moveTo(from[selection.from].x, from[selection.from].y)
    ctx.lineTo(to[selection.to].x, to[selection.to].y)
  }
  ctx.stroke()

  // Labels
  ctx.fillStyle = '#ccc'
  ctx.font = '12px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (let i = 0; i < inNodes.length; i++) ctx.fillText(INPUT_LABELS[i], 8, inNodes[i].y)
  for (let i = 0; i < outNodes.length; i++) {
    ctx.fillText(OUTPUT_LABELS[i], outNodes[i].x + NODE_RADIUS + 6, outNodes[i].y)
  }

  ctx.textAlign = 'center'
  ctx.fillText('inputs', COLUMN_X.input, 70)
  ctx.fillText('hidden', COLUMN_X.hidden, 70)
  ctx.fillText('outputs', COLUMN_X.output, 70)

  ctx.font = '16px sans-serif'
  ctx.fillText(title, ctx.canvas.width / 2, 28)

  ctx.font = '13px sans-serif'
  ctx.fillStyle = selection ? 'white' : '#999'
  ctx.fillText(selection ? describeSelection(selection, brain, inputs, thought) : 'Click a neuron or a connection', ctx.canvas.width / 2, 442)

  ctx.fillStyle = '#ccc'
  ctx.font = '11px sans-serif'
  ctx.fillText('blue = pushes up, red = pushes down, brighter = stronger', ctx.canvas.width / 2, 470)
}