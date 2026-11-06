// The CrashLab server: it takes a car, runs the Grand Prix itself with the same simulation the game
// uses, and ranks the result. The score a player sees in the browser is never trusted.
import { carFromJson } from '../../src/carFile'
import { sign, verify } from './auth'
import { GRAND_PRIXES, medalFor, raceCar } from '../../src/race'

export interface Env {
  DB: D1Database
  DEV_PLAYER_HEADER?: string // local development only, set in .dev.vars
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
}

const DAILY_LIMIT = 3 // ranked entries per player per day. Training cannot be limited (it runs in the browser), so this is what makes retrying for a lucky car cost something
const BOARD_SIZE = 50
const MAX_BODY = 60000
const ORIGINS = ['https://kgadharsh.github.io', 'http://localhost:5173']

const cors = (req: Request): Record<string, string> => {
  const o = req.headers.get('Origin') ?? ''
  return ORIGINS.includes(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-Player', 'Vary': 'Origin' } : {}
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } })

type Session = { id: string; display: string; exp: number }
const SESSION_DAYS = 30

// Who is asking: the player in a genuine, unexpired sign-in token. Only a local development server,
// which has DEV_PLAYER_HEADER in .dev.vars, also accepts a bare name in X-Dev-Player.
async function playerOf(req: Request, env: Env): Promise<{ id: string; display: string } | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  if (token) {
    const s = await verify<Session>(env.SESSION_SECRET, token)
    if (s && s.id.startsWith('google:')) return { id: s.id, display: s.display }
  }
  const dev = env.DEV_PLAYER_HEADER === '1' ? req.headers.get('X-Dev-Player') : null
  if (dev && /^[\w .-]{1,30}$/.test(dev)) return { id: 'dev:' + dev, display: dev }
  return null
}

// ---------- SIGN IN WITH GOOGLE ----------
// The game sends the player here with where to come back to (ret) and a nonce it keeps. The provider asks them to
// approve, then sends them back with a code; the Worker swaps it for who they are and returns them to the game
// with a signed token in the part of the address after #, which never reaches any server.
// Nothing from the provider is shown: players choose their own board name (see /me), because the board is public.
type State = { ret: string; nonce: string; exp: number }
const page = (text: string, status: number) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

type Provider = {
  authorize: string
  token: string
  scope: string
  clientId: (env: Env) => string
  secret: (env: Env) => string
  // who the player is, from the access token: a stable id and a name that is safe to show
  who: (access: string) => Promise<{ id: string; display: string } | null>
}
const PROVIDERS: Record<string, Provider> = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid profile',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    secret: (env) => env.GOOGLE_CLIENT_SECRET,
    async who(access) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + access } })
      const u = (await r.json().catch(() => ({}))) as { sub?: string }
      if (!u.sub) return null
      return { id: 'google:' + u.sub, display: 'Player' }
    },
  },
}

async function startSignIn(name: string, url: URL, env: Env): Promise<Response> {
  const p = PROVIDERS[name]
  if (!p.clientId(env)) return page('Sign in with ' + name + ' is not set up yet.', 503)
  const nonce = url.searchParams.get('nonce') ?? ''
  let ret: URL
  try {
    ret = new URL(url.searchParams.get('ret') ?? '')
  } catch {
    return page('Missing return address.', 400)
  }
  if (!ORIGINS.includes(ret.origin) || !/^[\w-]{8,64}$/.test(nonce)) return page('That sign-in request is not allowed.', 400)
  ret.hash = ''
  const state = await sign(env.SESSION_SECRET, { ret: ret.href, nonce, exp: Date.now() + 10 * 60 * 1000 } satisfies State)
  const to = new URL(p.authorize)
  to.searchParams.set('client_id', p.clientId(env))
  to.searchParams.set('redirect_uri', url.origin + '/auth/' + name + '/callback')
  to.searchParams.set('state', state)
  if (name === 'google') to.searchParams.set('response_type', 'code')
  if (p.scope) to.searchParams.set('scope', p.scope)
  return Response.redirect(to.href, 302)
}

async function finishSignIn(name: string, url: URL, env: Env): Promise<Response> {
  const p = PROVIDERS[name]
  const state = await verify<State>(env.SESSION_SECRET, url.searchParams.get('state') ?? '')
  const code = url.searchParams.get('code')
  if (!state || !code) return page('That sign-in did not check out. Go back to the game and try again.', 400)
  const form = new URLSearchParams({ client_id: p.clientId(env), client_secret: p.secret(env), code, redirect_uri: url.origin + '/auth/' + name + '/callback', grant_type: 'authorization_code' })
  const tokenRes = await fetch(p.token, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  const access = ((await tokenRes.json().catch(() => ({}))) as { access_token?: string }).access_token
  if (!access) return page('The sign-in was not accepted. Go back to the game and try again.', 400)
  const who = await p.who(access)
  if (!who) return page('Could not read who you are. Go back to the game and try again.', 400)
  const token = await sign(env.SESSION_SECRET, { id: who.id, display: who.display, exp: Date.now() + SESSION_DAYS * 86400000 } satisfies Session)
  return Response.redirect(state.ret + '#signin=' + token + '&nonce=' + state.nonce, 302)
}

async function submit(req: Request, env: Env): Promise<Response> {
  const player = await playerOf(req, env)
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

  // a signed-in player must have chosen a board name (a local dev-header player is named by the header)
  let display = player.display
  if (!player.id.startsWith('dev:')) {
    const me = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(player.id).first<{ name: string }>()
    if (!me) return json(req, { error: 'Choose a board name first.', needName: true }, 409)
    display = me.name
  }
  const day = new Date().toISOString().slice(0, 10)
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE player = ? AND day = ?').bind(player.id, day).first<{ n: number }>()
  if ((used?.n ?? 0) >= DAILY_LIMIT) return json(req, { error: 'You have used all ' + DAILY_LIMIT + ' board entries for today. Try again tomorrow.' }, 429)

  const result = raceCar(car, gp) // the server's own run
  const medal = medalFor(result, gp)
  await env.DB.prepare('INSERT INTO entries (player, display, gp, finished, total_time, medal, car, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(player.id, display, gp.id, result.finished, result.totalTime, medal, JSON.stringify(car), day, Date.now())
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
    `SELECT e.id, COALESCE(p.name, e.display) AS display, e.finished, e.total_time AS totalTime, e.medal FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY player ORDER BY finished DESC, total_time ASC, id ASC) AS r FROM entries WHERE gp = ?
     ) e LEFT JOIN players p ON p.id = e.player WHERE e.r = 1 ORDER BY e.finished DESC, e.total_time ASC, e.id ASC LIMIT ?`,
  ).bind(gpId, BOARD_SIZE).all<{ id: number; display: string; finished: number; totalTime: number; medal: string | null }>()
  return json(req, { gp: gpId, entries: results.map((e, i) => ({ rank: i + 1, ...e })) })
}

// A player's place on a Grand Prix's board: one more than the number of players whose best entry beats their best (null if not on it)
const SCORE = 'finished * 100000 - total_time'
async function rankOf(env: Env, gpId: string, playerId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT (SELECT MAX(${SCORE}) FROM entries WHERE gp = ?1 AND player = ?2) AS mine,
            (SELECT COUNT(*) FROM (SELECT MAX(${SCORE}) AS s FROM entries WHERE gp = ?1 GROUP BY player)
              WHERE s > (SELECT MAX(${SCORE}) FROM entries WHERE gp = ?1 AND player = ?2)) AS ahead`,
  ).bind(gpId, playerId).first<{ mine: number | null; ahead: number }>()
  return row && row.mine !== null ? row.ahead + 1 : null
}

// The signed-in player's board name (null until they choose one) and their place on each board
async function getMe(req: Request, env: Env): Promise<Response> {
  const player = await playerOf(req, env)
  if (!player) return json(req, { error: 'Sign in first.' }, 401)
  const me = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(player.id).first<{ name: string }>()
  const ranks: Record<string, number | null> = {}
  for (const gp of GRAND_PRIXES) ranks[gp.id] = await rankOf(env, gp.id, player.id)
  return json(req, { name: me?.name ?? null, ranks })
}

const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}]$/u // 3 to 20 characters: letters, numbers, and inside the name spaces . _ -
async function setMe(req: Request, env: Env): Promise<Response> {
  const player = await playerOf(req, env)
  if (!player || player.id.startsWith('dev:')) return json(req, { error: 'Sign in first.' }, 401)
  let body: { name?: unknown }
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(req, { error: 'That is not valid JSON.' }, 400)
  }
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
  if (!NAME_RULE.test(name)) return json(req, { error: 'Use 3 to 20 letters, numbers, spaces, dots, dashes or underscores.' }, 400)
  try {
    await env.DB.prepare('INSERT INTO players (id, name, name_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key')
      .bind(player.id, name, name.toLowerCase(), Date.now()).run()
  } catch (e) {
    if (String(e).includes('UNIQUE')) return json(req, { error: 'That name is taken. Try another.' }, 409)
    throw e
  }
  return json(req, { name })
}

async function entry(req: Request, env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare('SELECT e.id, COALESCE(p.name, e.display) AS display, e.gp, e.finished, e.total_time AS totalTime, e.medal, e.car FROM entries e LEFT JOIN players p ON p.id = e.player WHERE e.id = ?').bind(id).first<{ car: string }>()
  return row ? json(req, { ...row, car: JSON.parse(row.car) }) : json(req, { error: 'No such entry.' }, 404)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Allow-Methods': 'GET, POST, PUT' } })
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/entries\/(\d+)$/)
    const auth = url.pathname.match(/^\/auth\/(google)(\/callback)?$/)
    if (req.method === 'GET' && auth) return auth[2] ? finishSignIn(auth[1], url, env) : startSignIn(auth[1], url, env)
    if (req.method === 'POST' && url.pathname === '/entries') return submit(req, env)
    if (req.method === 'GET' && url.pathname === '/board') return board(req, env, url.searchParams.get('gp') ?? 'gp1')
    if (url.pathname === '/me' && req.method === 'GET') return getMe(req, env)
    if (url.pathname === '/me' && req.method === 'PUT') return setMe(req, env)
    if (req.method === 'GET' && m) return entry(req, env, Number(m[1]))
    return json(req, { error: 'Not found.' }, 404)
  },
}
