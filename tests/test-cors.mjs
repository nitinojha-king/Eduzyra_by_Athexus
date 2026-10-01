import assert from 'node:assert/strict'

// Smoke test: CORS preflight on auth routes.
const TEST_ORIGIN = 'https://frontend-final.onrender.com'
process.env.NODE_ENV = 'production'
process.env.CLIENT_ORIGIN = TEST_ORIGIN

const { default: app } = await import('../src/app.js')
const server = app.listen(0)

try {
  await new Promise((resolve) => server.once('listening', resolve))
  const port = server.address().port

  // 1. Check signup preflight with frontend-final.onrender.com
  {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://frontend-final.onrender.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
      },
    })
    const headers = res.headers
    assert.equal(res.status, 204)
    assert.equal(headers.get('access-control-allow-origin'), 'https://frontend-final.onrender.com')
    assert.match(headers.get('access-control-allow-methods') || '', /POST/i)
    assert.match(headers.get('access-control-allow-headers') || '', /Content-Type/i)
    assert.equal(headers.get('access-control-allow-credentials'), 'true')
    console.log('1. Signup preflight with frontend-final passed.')
  }

  // 2. Check resend-otp preflight with fontend-final.onrender.com
  {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/resend-otp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://fontend-final.onrender.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    const headers = res.headers
    assert.equal(res.status, 204)
    assert.equal(headers.get('access-control-allow-origin'), 'https://fontend-final.onrender.com')
    assert.equal(headers.get('access-control-allow-credentials'), 'true')
    console.log('2. Resend-otp preflight with fontend-final passed.')
  }

  // 3. Check any onrender.com origin (e.g. preview deployment)
  {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://eduzyra-preview-app.onrender.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    const headers = res.headers
    assert.equal(res.status, 204)
    assert.equal(headers.get('access-control-allow-origin'), 'https://eduzyra-preview-app.onrender.com')
    assert.equal(headers.get('access-control-allow-credentials'), 'true')
    console.log('3. Login preflight with arbitrary onrender.com preview passed.')
  }

  // 4. Check disallowed origin does NOT crash the server (returns 204 without allow-origin)
  {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://unauthorized-domain.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    assert.notEqual(res.status, 500)
    assert.equal(res.headers.get('access-control-allow-origin'), null)
    console.log('4. Disallowed origin handled cleanly without 500 error.')
  }

  console.log('All CORS tests passed!')
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
