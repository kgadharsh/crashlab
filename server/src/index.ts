// The CrashLab server: it takes a car, runs the Grand Prix itself with the same simulation the game
// uses, and ranks the result. The score a player sees in the browser is never trusted.
import { carFromJson } from '../../src/carFile'
import { GRAND_PRIXES, medalFor, raceCar } from '../../src/race'

export interface Env {
  DB: D1Database
  DEV_PLAYER_HEADER?: string
}

const DAILY_LIMIT = 10 // ranked entries per player per day (retraining is never limited, only entering the board)
const BOARD_SIZE = 50
const MAX_BODY = 60000
const ORIGINS = ['https://kgadharsh.github.io', 'http://localhost:5173']

const cors = (req: Request): Record<string, string> => {
  const o = req.headers.get('Origin') ?? ''
  return ORIGINS.includes(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Content-Type, X-Dev-Player', 'Vary': 'Origin' } : {}
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } })

// Who is asking. Sign-in will replace this; until then only the local dev header names a player.
function playerOf(req: Request, env: Env): { id: string; display: string } | null {
  const dev = env.DEV_PLAYER_HEADER === '1' ? req.headers.get('X-Dev-Player') : null
  if (dev && /^[\w .-]{1,30}$/.test(dev)) return { id: 'dev:' + dev, display: dev }
  return null
}

async function submit(req: Request, env: Env): Promise<Response> {
  const player = playerOf(req, env)
  if (!player) return json(req, { error: 'Sign in to enter the board.' }, 401)
  const text = await req.text()
  if (text.length > MAX_BODY) return json(req, { error: 'That is too big to be a car.' }, 413)
  let body: { gp?: unknown; car?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return json(req, { error: 'That is not valid JSON.' }, 400)
  }
  const gp = GRAND_PRIXES.find((g) => g.id === body.gp)
  if (!gp) return json(req, { error: 'Unknown Grand Prix.' }, 400)
  const car = carFromJson(typeof body.car === 'string' ? body.car : '')
  if ('error' in car) return json(req, { error: car.error }, 400)

  const day = new Date().toISOString().slice(0, 10)
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE player = ? AND day = ?').bind(player.id, day).first<{ n: number }>()
  if ((used?.n ?? 0) >= DAILY_LIMIT) return json(req, { error: 'You have used all ' + DAILY_LIMIT + ' board entries for today. Try again tomorrow.' }, 429)

  const result = raceCar(car, gp) // the server's own run
  const medal = medalFor(result, gp)
  await env.DB.prepare('INSERT INTO entries (player, display, gp, finished, total_time, medal, car, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(player.id, player.display, gp.id, result.finished, result.totalTime, medal, JSON.stringify(car), day, Date.now())
    .run()
  // the player's place on the board: one more than the number of players whose best entry is better than their own best
  const score = 'finished * 100000 - total_time'
  const rank = await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS rank FROM (SELECT MAX(${score}) AS s FROM entries WHERE gp = ? GROUP BY player)
       WHERE s > (SELECT MAX(${score}) FROM entries WHERE gp = ? AND player = ?)`,
  ).bind(gp.id, gp.id, player.id).first<{ rank: number }>()
  return json(req, { finished: result.finished, totalTime: result.totalTime, medal, rank: rank?.rank ?? 1, left: DAILY_LIMIT - (used?.n ?? 0) - 1 })
}

// Each player's best entry for a Grand Prix, best first
async function board(req: Request, env: Env, gpId: string): Promise<Response> {
  if (!GRAND_PRIXES.some((g) => g.id === gpId)) return json(req, { error: 'Unknown Grand Prix.' }, 400)
  const { results } = await env.DB.prepare(
    `SELECT id, display, finished, total_time AS totalTime, medal FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY player ORDER BY finished DESC, total_time ASC, id ASC) AS r FROM entries WHERE gp = ?
     ) WHERE r = 1 ORDER BY finished DESC, total_time ASC, id ASC LIMIT ?`,
  ).bind(gpId, BOARD_SIZE).all<{ id: number; display: string; finished: number; totalTime: number; medal: string | null }>()
  return json(req, { gp: gpId, entries: results.map((e, i) => ({ rank: i + 1, ...e })) })
}

async function entry(req: Request, env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, display, gp, finished, total_time AS totalTime, medal, car FROM entries WHERE id = ?').bind(id).first<{ car: string }>()
  return row ? json(req, { ...row, car: JSON.parse(row.car) }) : json(req, { error: 'No such entry.' }, 404)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Allow-Methods': 'GET, POST' } })
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/entries\/(\d+)$/)
    if (req.method === 'POST' && url.pathname === '/entries') return submit(req, env)
    if (req.method === 'GET' && url.pathname === '/board') return board(req, env, url.searchParams.get('gp') ?? 'gp1')
    if (req.method === 'GET' && m) return entry(req, env, Number(m[1]))
    return json(req, { error: 'Not found.' }, 404)
  },
}
