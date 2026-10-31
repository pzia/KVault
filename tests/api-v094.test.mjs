import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { koboFetch, parseRetryAfterMs } from '../src/worker.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workerSource = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.2.yaml', import.meta.url), 'utf8');

assert.equal(pkg.version, '0.9.7');
assert.match(workerSource, /APP_RELEASE = "0\.9\.7"/);
assert.match(workerSource, /KOBO_FETCH_TIMEOUT_MS = 10_000/);
assert.match(workerSource, /KOBO_FETCH_MAX_RETRIES = 2/);
assert.match(openapi, /version: 2\.3\.2/); // 0.9.5 intentionally does not revise the Provider contract.

// Retry-After supports both delta-seconds and HTTP-date forms.
assert.equal(parseRetryAfterMs('1.5', 0), 1500);
assert.equal(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:27:59 GMT')), 1000);
assert.equal(parseRetryAfterMs('invalid', 0), null);

// A retryable Kobo response is retried within the configured bound and honors Retry-After.
{
  let calls = 0;
  const delays = [];
  const response = await koboFetch('https://storeapi.kobo.com/test', {}, {
    maxRetries: 2,
    timeoutMs: 1000,
    fetchImpl: async () => {
      calls++;
      if (calls < 3) return new Response('busy', { status: 503, headers: { 'Retry-After': '0' } });
      return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    sleepImpl: async ms => { delays.push(ms); }
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [0, 0]);
}

// The retry count is strictly bounded: the final upstream response is returned after maxRetries + 1 attempts.
{
  let calls = 0;
  const response = await koboFetch('https://storeapi.kobo.com/test', {}, {
    maxRetries: 1,
    timeoutMs: 1000,
    fetchImpl: async () => { calls++; return new Response('still busy', { status: 503 }); },
    sleepImpl: async () => {}
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 2);
}

// Network timeout is normalized instead of leaking an implementation-specific AbortError.
{
  await assert.rejects(
    koboFetch('https://storeapi.kobo.com/test', {}, {
      maxRetries: 0,
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')), { once:true });
      }),
      sleepImpl: async () => {}
    }),
    error => error?.status === 502 && error?.code === 'kobo_upstream_timeout'
  );
}

// 429 is no longer flattened to 502, and Retry-After is preserved on the HTTP response.
{
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"error":"rate"}', { status:429, headers:{ 'Retry-After':'0', 'Content-Type':'application/json' } });
  };
  try {
    const res = await worker.fetch(new Request('https://vault.example/api/kobo/activation/start', { method:'POST' }), {}, { waitUntil(){} });
    const body = await res.json();
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '0');
    assert.equal(body.error, 'kobo_device_auth_failed');
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('api-v095.test.mjs: OK');
