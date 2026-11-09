import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchBoardEntries } from '../src/boardData'

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
