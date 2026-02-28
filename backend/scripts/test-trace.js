#!/usr/bin/env node
'use strict';

/**
 * test-trace.js — Unit tests for the trace.service.js engine.
 *
 * Tests (8 total):
 *  1. startRun creates TraceRun in DB with status RUNNING
 *  2. step() inside bindRun() creates TraceEvent — verifies sequence, domain, replay_safe, status
 *  3. step() with thrown error creates error TraceEvent with error_json.message
 *  4. endRun('SUCCESS') sets ended_at and status on TraceRun
 *  5. safeSanitize redacts password, token, api_key, access_token recursively (including arrays)
 *  6. safeTruncate truncates objects > 10KB — verifies _truncated, preview, originalSize
 *  7. safeTruncate passes small objects through unchanged
 *  8. current() returns null outside bindRun context
 *
 * Usage:
 *   node scripts/test-trace.js
 *
 * Exit code: 0 = all PASS, 1 = one or more FAIL
 */

require('dotenv').config();

// Use DATABASE_URL_PUBLIC for local dev (railway.internal is unreachable locally)
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('railway.internal')) {
  if (process.env.DATABASE_URL_PUBLIC) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PUBLIC;
  }
}

const { v4: uuidv4 } = require('uuid');
const { getPrisma } = require('../src/services/prisma.service');

// Require trace module — safeSanitize and safeTruncate are exported for testing
const traceService = require('../src/services/trace.service');
const { startRun, bindRun, current, step, endRun, safeSanitize, safeTruncate } = traceService;

// ─── Test runner ────────────────────────────────────────────────────────────

const results = [];

async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('\x1b[32mPASS\x1b[0m');
    results.push({ name, pass: true });
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m — ${err.message}`);
    results.push({ name, pass: false, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1mtest-trace.js — Trace Service Tests\x1b[0m\n');

  const prisma = getPrisma();
  const testPrefix = `test-${uuidv4().slice(0, 8)}`;

  // Track all run IDs created so we can clean them up
  const createdRunIds = [];

  // ── Test 1: startRun creates TraceRun with status RUNNING ─────────────────
  await test('startRun creates TraceRun in DB with status RUNNING', async () => {
    const corrId = `${testPrefix}-t1`;
    const ctx = await startRun(`${testPrefix}-session`, `${testPrefix}-chat`, 'test-tenant', corrId);
    assert(ctx && ctx.traceRunId, 'ctx.traceRunId should be set');
    createdRunIds.push(ctx.traceRunId);

    const run = await prisma.traceRun.findUnique({ where: { id: ctx.traceRunId } });
    assert(run, 'TraceRun should exist in DB');
    assert(run.status === 'RUNNING', `Expected status=RUNNING, got "${run.status}"`);
    assert(run.correlation_id === corrId, `correlation_id mismatch: got "${run.correlation_id}"`);
    assert(run.session_id === `${testPrefix}-session`, `session_id mismatch`);
    assert(run.chat_id === `${testPrefix}-chat`, `chat_id mismatch`);
    assert(run.ended_at === null, 'ended_at should be null for RUNNING run');
  });

  // ── Test 2: step() creates TraceEvent with correct fields ─────────────────
  await test('step() inside bindRun() creates TraceEvent with correct fields', async () => {
    const corrId = `${testPrefix}-t2`;
    const ctx = await startRun(`${testPrefix}-s2`, `${testPrefix}-c2`, null, corrId);
    createdRunIds.push(ctx.traceRunId);

    await bindRun(ctx, async () => {
      const result = await step('test_step_alpha', async () => ({ outcome: 'ok' }), {
        domain: 'general',
        input: { foo: 'bar' },
        replaySafe: true,
      });
      assert(result && result.outcome === 'ok', 'step() should return fn() result');
    });

    // Small delay to let fire-and-forget DB writes complete
    await new Promise(r => setTimeout(r, 200));

    const events = await prisma.traceEvent.findMany({
      where: { trace_run_id: ctx.traceRunId },
      orderBy: { sequence: 'asc' },
    });
    assert(events.length >= 1, `Expected >= 1 event, got ${events.length}`);
    const ev = events.find(e => e.step_name === 'test_step_alpha');
    assert(ev, 'TraceEvent for test_step_alpha should exist');
    assert(ev.domain === 'general', `Expected domain=general, got "${ev.domain}"`);
    assert(ev.replay_safe === true, `Expected replay_safe=true, got ${ev.replay_safe}`);
    assert(ev.status === 'success', `Expected status=success, got "${ev.status}"`);
    assert(typeof ev.sequence === 'number', 'sequence should be a number');
    assert(ev.duration_ms !== null && ev.duration_ms >= 0, `duration_ms should be >= 0, got ${ev.duration_ms}`);
  });

  // ── Test 3: step() with thrown error creates error TraceEvent ─────────────
  await test('step() with thrown error creates error TraceEvent with error_json.message', async () => {
    const corrId = `${testPrefix}-t3`;
    const ctx = await startRun(`${testPrefix}-s3`, `${testPrefix}-c3`, null, corrId);
    createdRunIds.push(ctx.traceRunId);

    await bindRun(ctx, async () => {
      try {
        await step('test_error_step', async () => {
          throw new Error('deliberate test failure');
        }, { domain: 'general', replaySafe: false });
      } catch {
        // Expected — step() re-throws
      }
    });

    await new Promise(r => setTimeout(r, 200));

    const events = await prisma.traceEvent.findMany({ where: { trace_run_id: ctx.traceRunId } });
    const errEv = events.find(e => e.step_name === 'test_error_step');
    assert(errEv, 'Error TraceEvent should exist in DB');
    assert(errEv.status === 'error', `Expected status=error, got "${errEv.status}"`);
    assert(
      errEv.error_json && errEv.error_json.message === 'deliberate test failure',
      `error_json.message mismatch: got ${JSON.stringify(errEv.error_json)}`
    );
  });

  // ── Test 4: endRun sets ended_at and status ────────────────────────────────
  await test('endRun sets ended_at and status=SUCCESS on TraceRun', async () => {
    const corrId = `${testPrefix}-t4`;
    const ctx = await startRun(`${testPrefix}-s4`, `${testPrefix}-c4`, null, corrId);
    createdRunIds.push(ctx.traceRunId);

    await bindRun(ctx, async () => {
      await endRun('SUCCESS');
    });

    await new Promise(r => setTimeout(r, 200));

    const run = await prisma.traceRun.findUnique({ where: { id: ctx.traceRunId } });
    assert(run, 'TraceRun should still exist');
    assert(run.status === 'SUCCESS', `Expected status=SUCCESS, got "${run.status}"`);
    assert(run.ended_at !== null, 'ended_at should be set after endRun');
  });

  // ── Test 5: safeSanitize redacts sensitive keys recursively ───────────────
  await test('safeSanitize redacts password, token, api_key, access_token recursively', async () => {
    const input = {
      username: 'alice',
      password: 'super-secret-123',
      nested: {
        api_key: 'sk-abc-123',
        data: [{ access_token: 'tok-xyz', value: 99 }],
        normal: 'keep-me',
      },
      authorization: 'Bearer eyJhbGci...',
      client_secret: 'cs-secret',
    };
    const out = safeSanitize(input);

    assert(out.username === 'alice', 'username should be preserved');
    assert(out.password === '[REDACTED]', `password should be REDACTED, got "${out.password}"`);
    assert(out.nested.api_key === '[REDACTED]', `api_key should be REDACTED, got "${out.nested.api_key}"`);
    assert(
      out.nested.data[0].access_token === '[REDACTED]',
      `access_token in array should be REDACTED, got "${out.nested.data[0].access_token}"`
    );
    assert(out.nested.data[0].value === 99, `non-sensitive value in array should be preserved`);
    assert(out.nested.normal === 'keep-me', `non-sensitive nested key should be preserved`);
    assert(out.authorization === '[REDACTED]', `authorization should be REDACTED`);
    assert(out.client_secret === '[REDACTED]', `client_secret should be REDACTED`);
  });

  // ── Test 6: safeTruncate truncates large payloads ─────────────────────────
  await test('safeTruncate truncates objects > 10KB — verifies _truncated, preview, originalSize', async () => {
    const largeObj = { data: 'A'.repeat(12000) };
    const out = safeTruncate(largeObj);

    assert(out._truncated === true, `_truncated should be true, got ${out._truncated}`);
    assert(typeof out.preview === 'string', `preview should be a string`);
    assert(out.preview.length > 0, `preview should not be empty`);
    assert(typeof out.originalSize === 'number', `originalSize should be a number`);
    assert(out.originalSize > 10240, `originalSize should be > 10240, got ${out.originalSize}`);
  });

  // ── Test 7: safeTruncate passes small payloads unchanged ──────────────────
  await test('safeTruncate passes small objects through unchanged', async () => {
    const smallObj = { hello: 'world', count: 42, flag: true };
    const out = safeTruncate(smallObj);

    assert(out.hello === 'world', `hello should be "world", got "${out.hello}"`);
    assert(out.count === 42, `count should be 42, got ${out.count}`);
    assert(out.flag === true, `flag should be true`);
    assert(out._truncated === undefined, `_truncated should not exist on small object`);
  });

  // ── Test 8: current() returns null outside bindRun ────────────────────────
  await test('current() returns null outside bindRun context', async () => {
    // We are NOT inside a bindRun call here
    const ctx = current();
    assert(ctx === null, `current() should return null outside bindRun, got: ${JSON.stringify(ctx)}`);
  });

  // ─── Cleanup: delete all test TraceRuns (cascades to TraceEvents) ─────────
  if (createdRunIds.length > 0) {
    try {
      await prisma.traceRun.deleteMany({ where: { id: { in: createdRunIds } } });
    } catch (err) {
      console.warn('\n  [cleanup] Failed to delete test runs:', err.message);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);

  if (failed > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  • ${r.name}`);
      console.log(`    ${r.error}`);
    });
    console.log('');
    process.exit(1);
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n\x1b[31mFatal error:\x1b[0m', err.message);
  console.error(err.stack);
  process.exit(1);
});
