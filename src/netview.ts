import { type Brain, type Thought } from './brain'

const INPUT_LABELS = ['ray -60°', 'ray -30°', 'ray 0°', 'ray +30°', 'ray +60°', 'speed']
const OUTPUT_LABELS = ['steer', 'throttle']

const COLUMN_X = { input: 100, hidden: 220, output: 330 }
const NODE_RADIUS = 17

type Node = { x: number; y: number }

// Evenly spaced nodes down one column
function column(x: number, count: number): Node[] {
  const top = 90
  const bottom = 410
  const step = (bottom - top) / count
  return Array.from({ length: count }, (_, i) => ({ x, y: top + step * (i + 0.5) }))
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

export function drawNetwork(
  ctx: CanvasRenderingContext2D,
  brain: Brain,
  inputs: number[],
  thought: Thought,
  title: string,
) {
  ctx.fillStyle = '#14161c'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const inNodes = column(COLUMN_X.input, inputs.length)
  const hidNodes = column(COLUMN_X.hidden, thought.hidden.length)
  const outNodes = column(COLUMN_X.output, thought.outputs.length)

  drawEdges(ctx, inNodes, hidNodes, brain.w1, inputs)
  drawEdges(ctx, hidNodes, outNodes, brain.w2, thought.hidden)

  drawNodes(ctx, inNodes, inputs)
  drawNodes(ctx, hidNodes, thought.hidden)
  drawNodes(ctx, outNodes, thought.outputs)

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

  ctx.font = '11px sans-serif'
  ctx.fillText('blue = pushes up, red = pushes down, brighter = stronger', ctx.canvas.width / 2, 470)
}