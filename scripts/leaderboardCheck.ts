import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchBoardEntries } from '../src/boardData'
import { carToJson, type CarFile } from '../src/carFile'
import { entryCarForSelection, isCurrentDailyBoard } from '../src/challengeEntry'
import { DEFAULT_BUILD } from '../src/setup'

const current: CarFile = { name: 'Current', build: DEFAULT_BUILD, genome: [] }
const shelfCar: CarFile = { name: 'Shelf car', build: DEFAULT_BUILD, genome: [1] }

test('identifies only the current daily board for result comparison', () => {
  assert.equal(isCurrentDailyBoard('d:42', 42), true)
  assert.equal(isCurrentDailyBoard('d:41', 42), false)
  assert.equal(isCurrentDailyBoard('w:42', 42), false)
  assert.equal(isCurrentDailyBoard('d:today', 42), false)
})

test('resolves a selected current or shelf car and rejects stale selections', () => {
  assert.equal(entryCarForSelection('current', current, [shelfCar]), current)
  assert.equal(entryCarForSelection('shelf:' + carToJson(shelfCar), current, [shelfCar]), shelfCar)
  assert.equal(entryCarForSelection('shelf:missing', current, [shelfCar]), null)
  assert.equal(entryCarForSelection('', current, [shelfCar]), null)
})

test('reads daily and weekly leaderboard rows from successful board responses', async () => {
  const rows = [{ rank: 1, display: 'Racer' }]
  for (const gp of ['d:1', 'w:1']) {
    const url = '/board?gp=' + gp
    const entries = await fetchBoardEntries<typeof rows[number]>(url, async (request) => {
      assert.equal(request, url)
      return new Response(JSON.stringify({ entries: rows }), { status: 200 })
    })
    assert.deepEqual(entries, rows)
  }
})

test('rejects unsuccessful or malformed board responses', async () => {
  await assert.rejects(
    fetchBoardEntries('/board?gp=w:1', async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })),
    /unavailable/,
  )
  await assert.rejects(
    fetchBoardEntries('/board?gp=w:1', async () => new Response(JSON.stringify({ entries: null }), { status: 200 })),
    /bad reply/,
  )
  await assert.rejects(
    fetchBoardEntries('/board?gp=d:1', async () => new Response('null', { status: 200 })),
    /bad reply/,
  )
})
