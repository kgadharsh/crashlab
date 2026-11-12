import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withSecurityHeaders } from '../server/src/securityHeaders'

test('adds defensive headers to API responses without dropping CORS headers', async () => {
  const response = withSecurityHeaders(new Response(JSON.stringify({ error: 'Not found.' }), {
    status: 404,
    headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Content-Type': 'application/json' },
  }))

  assert.equal(response.status, 404)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal(response.headers.get('content-type'), 'application/json')
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'")
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), geolocation=(), microphone=()')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.deepEqual(await response.json(), { error: 'Not found.' })
})

test('adds defensive headers to CORS preflight responses', async () => {
  const response = withSecurityHeaders(new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': 'https://kgadharsh.github.io', 'Access-Control-Allow-Methods': 'GET, POST, PUT' },
  }))

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://kgadharsh.github.io')
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, PUT')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})
