import assert from 'node:assert/strict'

// Smoke test: CORS preflight on a protected auth route.
// The allowed origin comes from CLIENT_ORIGIN, so set it explicitly here
// to keep the test hermetic regardless of local .env.
const TEST_ORIGIN = 'https://frontend-final.onrender.com'
process.env.NODE_ENV = 'production'
process.env.CLIENT_ORIGIN = TEST_ORIGIN

const { default: app } = await import('../src/app.js')
const server = app.listen(0)

try {
  await new Promise((resolve) => server.once('listening', resolve))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/signup`, {
    method: 'OPTIONS',
    headers: {
      Origin: TEST_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  })
  const headers = response.headers
  const allowedMethods = headers.get('access-control-allow-methods') || ''
  const allowedHeaders = headers.get('access-control-allow-headers') || ''

  assert.equal(response.status, 204)
  assert.equal(headers.get('access-control-allow-origin'), TEST_ORIGIN)
  assert.match(allowedMethods, /POST/i)
  assert.match(allowedMethods, /DELETE/i)
  assert.match(allowedHeaders, /Content-Type/i)
  assert.match(allowedHeaders, /Authorization/i)
  assert.equal(headers.get('access-control-allow-credentials'), 'true')
  console.log('Signup preflight CORS check passed.')
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
