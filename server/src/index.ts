// The CrashLab server: it takes a car, runs the Grand Prix itself with the same simulation the game
// uses, and ranks the result. The score a player sees in the browser is never trusted.
import { carFromJson, carToJson } from '../../src/carFile'
import { buildProblem, cleanBuild, type Build } from '../../src/setup'
import { PRACTICE_COUNT } from '../../src/track'
import { sign, verify } from './auth'
import { GRAND_PRIXES, medalFor, raceCar, weekOf, weekStart, weeklyGp, type GrandPrix } from '../../src/race'

export interface Env {
  DB: D1Database
  DEV_PLAYER_HEADER?: string // local development only, set in .dev.vars
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_SECRET: string
  JOBS_TOKEN?: string // shared with the official trainer (a GitHub Actions secret); without it the trainer endpoints are closed
}

const WEEKLY_LIMIT = 3 // entries per player in each Weekly Grand Prix; their best counts
const PAST_WEEKS = 6 // finished weeks listed with their winners
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

// ---------- OFFICIAL TRAINING ----------
// Players enter a setup, not a trained car. The official trainer (scripts/officialTrain.ts, run by a scheduled GitHub job)
// trains every setup once, with the same budget and the same seed, and sends back the brain; the server races it and ranks it.
// So the board measures setup choices only: free time to retrain, and training luck, count for nothing.
const OFFICIAL_SINCE_WEEK = 2965 // weekly boards from this week on rank only officially trained cars
let officialReady = false
async function ensureOfficial(env: Env) {
  if (officialReady) return
  try {
    await env.DB.prepare('ALTER TABLE entries ADD COLUMN official INTEGER NOT NULL DEFAULT 0').run()
  } catch {
    /* the column is already there */
  }
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, display TEXT NOT NULL, gp TEXT NOT NULL,
       name TEXT NOT NULL, build TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
       started_at INTEGER, done_at INTEGER, entry INTEGER, error TEXT)`,
  ).run()
  officialReady = true
}
// entries that count on a board: officially trained ones, plus anything on a weekly board from before official training
const COUNTS = `(official = 1 OR (gp LIKE 'w:%' AND CAST(substr(gp, 3) AS INTEGER) < ${OFFICIAL_SINCE_WEEK}))`

async function submit(req: Request, env: Env): Promise<Response> {
  await ensureOfficial(env)
  const player = await playerOf(req, env)
  if (!player) return json(req, { error: 'Sign in to enter the board.' }, 401)
  const text = await req.text()
  if (text.length > MAX_BODY) return json(req, { error: 'That is too big to be a setup.' }, 413)
  let body: { gp?: unknown; car?: unknown; build?: unknown; name?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return json(req, { error: 'That is not valid JSON.' }, 400)
  }
  const weekly = body.gp === 'weekly' // always this week's: past weeks are closed
  const gp = weekly ? await weekGp(env, weekOf(Date.now())) : GRAND_PRIXES.find((g) => g.id === body.gp)
  if (!gp) return json(req, { error: 'Unknown Grand Prix.' }, 400)
  // the setup: sent on its own, or taken from a whole car (as older pages send it); the car's brain is not used
  let build: Build
  let name: string
  if (typeof body.car === 'string') {
    const car = carFromJson(body.car)
    if ('error' in car) return json(req, { error: car.error }, 400)
    build = car.build
    name = car.name
  } else {
    const problem = buildProblem(body.build, PRACTICE_COUNT)
    if (problem) return json(req, { error: 'That setup is not allowed: ' + problem + '.' }, 400)
    build = cleanBuild(body.build as Build)
    name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : 'Unnamed'
  }

  // a signed-in player must have chosen a board name (a local dev-header player is named by the header)
  let display = player.display
  if (!player.id.startsWith('dev:')) {
    const me = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(player.id).first<{ name: string }>()
    if (!me) return json(req, { error: 'Choose a board name first.', needName: true }, 409)
    display = me.name
  }
  const day = new Date().toISOString().slice(0, 10)
  const used = weekly
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs WHERE player = ? AND gp = ?').bind(player.id, gp.id).first<{ n: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE player = ? AND day = ? AND gp NOT LIKE 'w:%'").bind(player.id, day).first<{ n: number }>()
  const limit = weekly ? WEEKLY_LIMIT : DAILY_LIMIT
  if ((used?.n ?? 0) >= limit) {
    return json(req, { error: weekly ? 'You have used all ' + WEEKLY_LIMIT + ' entries for this week. A new Grand Prix starts on Monday.' : 'You have used all ' + DAILY_LIMIT + ' board entries for today. Try again tomorrow.' }, 429)
  }
  const job = await env.DB.prepare('INSERT INTO jobs (player, display, gp, name, build, day, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(player.id, display, gp.id, name, JSON.stringify(build), day, 'queued', Date.now())
    .first<{ id: number }>()
  const ahead = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'training') AND id < ?").bind(job!.id).first<{ n: number }>()
  return json(req, { queued: true, job: job!.id, ahead: ahead?.n ?? 0, left: limit - (used?.n ?? 0) - 1 })
}

// ---------- THE OFFICIAL TRAINER'S DOOR ----------
const trainerOk = (req: Request, env: Env) => !!env.JOBS_TOKEN && req.headers.get('Authorization') === 'Bearer ' + env.JOBS_TOKEN
// Hand out waiting setups (and take back any the trainer started over an hour ago and never finished)
async function nextJobs(req: Request, env: Env, limit: number): Promise<Response> {
  if (!trainerOk(req, env)) return json(req, { error: 'Not allowed.' }, 403)
  await ensureOfficial(env)
  await env.DB.prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'training' AND started_at < ?").bind(Date.now() - 3600000).run()
  const { results } = await env.DB.prepare("SELECT id, gp, name, build FROM jobs WHERE status = 'queued' ORDER BY id LIMIT ?").bind(limit).all<{ id: number; gp: string; name: string; build: string }>()
  for (const j of results) await env.DB.prepare("UPDATE jobs SET status = 'training', started_at = ? WHERE id = ?").bind(Date.now(), j.id).run()
  return json(req, { jobs: results.map((j) => ({ id: j.id, gp: j.gp, name: j.name, build: JSON.parse(j.build) })) })
}
// The trainer sends back the brain it trained; the server races it itself and puts it on the board
async function finishJob(req: Request, env: Env, id: number): Promise<Response> {
  if (!trainerOk(req, env)) return json(req, { error: 'Not allowed.' }, 403)
  await ensureOfficial(env)
  const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<{ id: number; player: string; display: string; gp: string; name: string; build: string; day: string; status: string }>()
  if (!job || job.status !== 'training') return json(req, { error: 'No such job in training.' }, 404)
  let body: { genome?: unknown; generations?: unknown }
  try {
    body = JSON.parse(await req.text())
  } catch {
    return json(req, { error: 'That is not valid JSON.' }, 400)
  }
  const car = carFromJson(JSON.stringify({ format: 'crashlab-car', version: 3, name: job.name, build: JSON.parse(job.build), genome: body.genome, generations: body.generations }))
  if ('error' in car) {
    await env.DB.prepare("UPDATE jobs SET status = 'failed', error = ?, done_at = ? WHERE id = ?").bind(car.error, Date.now(), id).run()
    return json(req, { error: car.error }, 400)
  }
  const gp = job.gp.startsWith('w:') ? await weekGp(env, Number(job.gp.slice(2))) : GRAND_PRIXES.find((g) => g.id === job.gp)!
  const result = raceCar(car, gp)
  const medal = medalFor(result, gp)
  const entry = await env.DB.prepare('INSERT INTO entries (player, display, gp, finished, total_time, medal, car, day, created_at, official) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1) RETURNING id')
    .bind(job.player, job.display, job.gp, result.finished, result.totalTime, medal, JSON.stringify(car), job.day, Date.now())
    .first<{ id: number }>()
  await env.DB.prepare("UPDATE jobs SET status = 'done', done_at = ?, entry = ? WHERE id = ?").bind(Date.now(), entry!.id, id).run()
  return json(req, { ok: true, entry: entry!.id, finished: result.finished, totalTime: result.totalTime, medal })
}
// Once, when official training starts: queue the setup of every player's best entry on each open board, so they keep a place
async function migrate(req: Request, env: Env): Promise<Response> {
  if (!trainerOk(req, env)) return json(req, { error: 'Not allowed.' }, 403)
  await ensureOfficial(env)
  const boards = [...GRAND_PRIXES.map((g) => g.id), 'w:' + weekOf(Date.now())]
  let queued = 0
  let skipped = 0
  for (const gp of boards) {
    const { results } = await env.DB.prepare(
      `SELECT player, display, car, day FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY player ORDER BY finished DESC, total_time ASC, id ASC) AS r
         FROM entries WHERE gp = ? AND official = 0) WHERE r = 1`,
    ).bind(gp).all<{ player: string; display: string; car: string; day: string }>()
    for (const e of results) {
      let car: { name?: string; build?: unknown }
      try {
        car = JSON.parse(e.car)
      } catch {
        skipped++
        continue
      }
      // a car saved by an older version may hold a setup this version no longer allows: it keeps no place
      if (buildProblem(car.build, PRACTICE_COUNT)) {
        skipped++
        continue
      }
      const build = JSON.stringify(cleanBuild(car.build as Build))
      const done = await env.DB.prepare('SELECT 1 FROM jobs WHERE player = ? AND gp = ? AND build = ?').bind(e.player, gp, build).first()
      if (done) continue // queued already: running this twice changes nothing
      await env.DB.prepare('INSERT INTO jobs (player, display, gp, name, build, day, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(e.player, e.display, gp, typeof car.name === 'string' ? car.name.slice(0, 40) : 'Unnamed', build, e.day, 'queued', Date.now()).run()
      queued++
    }
  }
  return json(req, { queued, skipped })
}

// ---------- THE WEEKLY GRAND PRIX ----------
// A week's Grand Prix, with its seed picked at random and saved the first time anyone asks for that week
async function weekGp(env: Env, week: number): Promise<GrandPrix> {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]
  await env.DB.prepare('INSERT OR IGNORE INTO weeks (week, seed) VALUES (?, ?)').bind(week, seed).run()
  const row = await env.DB.prepare('SELECT seed FROM weeks WHERE week = ?').bind(week).first<{ seed: number }>()
  return weeklyGp(week, row!.seed)
}

// The top 3 players of every finished week (finishing at least one track), best first within each week
type Podium = { gp: string; place: number; id: number; display: string; finished: number; totalTime: number; player: string }
async function podiums(env: Env): Promise<Podium[]> {
  await ensureOfficial(env)
  const { results } = await env.DB.prepare(
    `SELECT gp, place, id, display, finished, totalTime, player FROM (
       SELECT b.gp, b.id, COALESCE(p.name, b.display) AS display, b.finished, b.total_time AS totalTime, b.player,
              ROW_NUMBER() OVER (PARTITION BY b.gp ORDER BY b.finished DESC, b.total_time ASC, b.id ASC) AS place
       FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY gp, player ORDER BY finished DESC, total_time ASC, id ASC) AS r
             FROM entries WHERE gp LIKE 'w:%' AND gp <> ? AND ${COUNTS}) b
       LEFT JOIN players p ON p.id = b.player
       WHERE b.r = 1 AND b.finished > 0
     ) WHERE place <= 3 ORDER BY gp DESC, place ASC`,
  ).bind('w:' + weekOf(Date.now())).all<Podium>()
  return results
}

// This week (its name, road and when it ends, but never its seed) and the finished weeks with their winners.
// A finished week's seed is public, so the game can make its tracks and anyone can race them.
async function weeklyInfo(req: Request, env: Env): Promise<Response> {
  const now = weekOf(Date.now())
  const gp = await weekGp(env, now)
  const { results } = await env.DB.prepare('SELECT week, seed FROM weeks WHERE week < ? ORDER BY week DESC LIMIT ?').bind(now, PAST_WEEKS).all<{ week: number; seed: number }>()
  const all = await podiums(env)
  const past = results.map((w) => ({
    week: w.week,
    seed: w.seed,
    podium: all.filter((p) => p.gp === 'w:' + w.week).map(({ place, id, display, finished, totalTime }) => ({ place, id, display, finished, totalTime })),
  }))
  return json(req, { week: now, name: gp.name, wet: gp.wet, night: gp.night, ice: gp.ice, endsAt: weekStart(now + 1), limit: WEEKLY_LIMIT, past })
}

// Weekly trophies won by each player: [gold, silver, bronze]
async function trophies(env: Env): Promise<Map<string, number[]>> {
  const won = new Map<string, number[]>()
  for (const p of await podiums(env)) {
    const t = won.get(p.player) ?? [0, 0, 0]
    t[p.place - 1]++
    won.set(p.player, t)
  }
  return won
}

// Which boards can be shown: the fixed Grand Prix, and any week up to this one
const boardExists = (gpId: string) => GRAND_PRIXES.some((g) => g.id === gpId) || (/^w:\d+$/.test(gpId) && Number(gpId.slice(2)) <= weekOf(Date.now()))

// Each player's best entry for a Grand Prix, best first
async function board(req: Request, env: Env, gpId: string): Promise<Response> {
  await ensureOfficial(env)
  if (!boardExists(gpId)) return json(req, { error: 'Unknown Grand Prix.' }, 400)
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.player, COALESCE(p.name, e.display) AS display, e.finished, e.total_time AS totalTime, e.medal, json_extract(e.car, '$.runs') AS runs FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY player ORDER BY finished DESC, total_time ASC, id ASC) AS r FROM entries WHERE gp = ? AND ${COUNTS}
     ) e LEFT JOIN players p ON p.id = e.player WHERE e.r = 1 ORDER BY e.finished DESC, e.total_time ASC, e.id ASC LIMIT ?`,
  ).bind(gpId, BOARD_SIZE).all<{ id: number; player: string; display: string; finished: number; totalTime: number; medal: string | null; runs: number | null }>()
  const won = await trophies(env)
  // the player's sign-in id stays on the server
  return json(req, { gp: gpId, entries: results.map(({ player, ...e }, i) => ({ rank: i + 1, ...e, trophies: won.get(player) })) })
}

// A player's place on a Grand Prix's board: one more than the number of players whose best entry beats their best (null if not on it)
const SCORE = 'finished * 100000 - total_time'
async function rankOf(env: Env, gpId: string, playerId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT (SELECT MAX(${SCORE}) FROM entries WHERE gp = ?1 AND player = ?2 AND ${COUNTS}) AS mine,
            (SELECT COUNT(*) FROM (SELECT MAX(${SCORE}) AS s FROM entries WHERE gp = ?1 AND ${COUNTS} GROUP BY player)
              WHERE s > (SELECT MAX(${SCORE}) FROM entries WHERE gp = ?1 AND player = ?2 AND ${COUNTS})) AS ahead`,
  ).bind(gpId, playerId).first<{ mine: number | null; ahead: number }>()
  return row && row.mine !== null ? row.ahead + 1 : null
}

// The signed-in player's board name (null until they choose one) and their place on each board
async function getMe(req: Request, env: Env): Promise<Response> {
  await ensureOfficial(env)
  const player = await playerOf(req, env)
  if (!player) return json(req, { error: 'Sign in first.' }, 401)
  const me = await env.DB.prepare('SELECT name FROM players WHERE id = ?').bind(player.id).first<{ name: string }>()
  const ranks: Record<string, number | null> = {}
  for (const gp of GRAND_PRIXES) ranks[gp.id] = await rankOf(env, gp.id, player.id)
  const week = 'w:' + weekOf(Date.now())
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs WHERE player = ? AND gp = ?').bind(player.id, week).first<{ n: number }>()
  const weekly = { rank: await rankOf(env, week, player.id), left: WEEKLY_LIMIT - (used?.n ?? 0) }
  // the player's latest entries in official training: waiting (and how many are ahead), in training, done or failed
  const { results: mine } = await env.DB.prepare(
    `SELECT j.id, j.gp, j.name, j.status, e.finished, e.total_time AS totalTime, e.medal,
            (SELECT COUNT(*) FROM jobs q WHERE q.status IN ('queued', 'training') AND q.id < j.id) AS ahead
     FROM jobs j LEFT JOIN entries e ON e.id = j.entry WHERE j.player = ? ORDER BY j.id DESC LIMIT 5`,
  ).bind(player.id).all()
  return json(req, { name: me?.name ?? null, ranks, weekly, jobs: mine })
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


// ---------- SHORT CHALLENGE LINKS ----------
// A shared car is kept under a short code made from its own contents, so sharing the same car twice gives the same code
// and nothing piles up. The car is checked like any car file before it is kept. The table is made on first use.
let challengeTable = false
async function ensureChallenges(env: Env) {
  if (challengeTable) return
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS challenges (code TEXT PRIMARY KEY, car TEXT NOT NULL, created_at INTEGER NOT NULL)').run()
  challengeTable = true
}
const CODE = /^[A-Za-z0-9_-]{10}$/
async function codeFor(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return btoa(String.fromCharCode(...hash.slice(0, 8))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 10)
}
async function saveChallenge(req: Request, env: Env): Promise<Response> {
  const text = await req.text()
  if (text.length > MAX_BODY) return json(req, { error: 'That car is too big.' }, 413)
  let body: { car?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return json(req, { error: 'That is not a car.' }, 400)
  }
  const car = typeof body.car === 'string' ? carFromJson(body.car) : { error: 'That is not a car.' }
  if ('error' in car) return json(req, { error: car.error }, 400)
  const canonical = carToJson(car)
  const code = await codeFor(canonical)
  await ensureChallenges(env)
  await env.DB.prepare('INSERT OR IGNORE INTO challenges (code, car, created_at) VALUES (?, ?, ?)').bind(code, canonical, Date.now()).run()
  return json(req, { code })
}
async function loadChallenge(req: Request, env: Env, code: string): Promise<Response> {
  await ensureChallenges(env)
  const row = await env.DB.prepare('SELECT car FROM challenges WHERE code = ?').bind(code).first<{ car: string }>()
  return row ? json(req, { car: row.car }) : json(req, { error: 'That challenge link is not known.' }, 404)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Allow-Methods': 'GET, POST, PUT' } })
    const url = new URL(req.url)
    const m = url.pathname.match(/^\/entries\/(\d+)$/)
    const auth = url.pathname.match(/^\/auth\/(google)(\/callback)?$/)
    const ch = url.pathname.match(/^\/challenges\/([A-Za-z0-9_-]+)$/)
    if (req.method === 'GET' && auth) return auth[2] ? finishSignIn(auth[1], url, env) : startSignIn(auth[1], url, env)
    if (req.method === 'POST' && url.pathname === '/challenges') return saveChallenge(req, env)
    if (req.method === 'GET' && ch) return CODE.test(ch[1]) ? loadChallenge(req, env, ch[1]) : json(req, { error: 'That challenge link is damaged.' }, 400)
    if (req.method === 'POST' && url.pathname === '/entries') return submit(req, env)
    if (req.method === 'GET' && url.pathname === '/jobs/next') return nextJobs(req, env, Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 5)))
    if (req.method === 'POST' && url.pathname === '/jobs/migrate') return migrate(req, env)
    const jm = url.pathname.match(/^\/jobs\/(\d+)$/)
    if (req.method === 'POST' && jm) return finishJob(req, env, Number(jm[1]))
    if (req.method === 'GET' && url.pathname === '/board') return board(req, env, url.searchParams.get('gp') ?? 'gp1')
    if (req.method === 'GET' && url.pathname === '/weekly') return weeklyInfo(req, env)
    if (url.pathname === '/me' && req.method === 'GET') return getMe(req, env)
    if (url.pathname === '/me' && req.method === 'PUT') return setMe(req, env)
    if (req.method === 'GET' && m) return entry(req, env, Number(m[1]))
    return json(req, { error: 'Not found.' }, 404)
  },
}
