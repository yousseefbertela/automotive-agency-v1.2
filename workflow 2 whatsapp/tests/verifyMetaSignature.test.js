'use strict';

const crypto = require('crypto');
const { verifyMetaSignature } = require('../src/utils/verifyMetaSignature');

describe('verifyMetaSignature', () => {
  const SECRET = 'test-app-secret-123';
  const BODY = JSON.stringify({ entry: [{ changes: [] }] });

  function makeSignature(body, secret) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  afterEach(() => {
    delete process.env.META_APP_SECRET;
  });

  test('returns true when META_APP_SECRET is not set', () => {
    expect(verifyMetaSignature(Buffer.from(BODY), 'sha256=fake')).toBe(true);
  });

  test('returns false when signature header is missing', () => {
    process.env.META_APP_SECRET = SECRET;
    expect(verifyMetaSignature(Buffer.from(BODY), undefined)).toBe(false);
  });

  test('returns true for valid signature', () => {
    process.env.META_APP_SECRET = SECRET;
    const sig = makeSignature(BODY, SECRET);
    expect(verifyMetaSignature(Buffer.from(BODY), sig)).toBe(true);
  });

  test('returns false for invalid signature', () => {
    process.env.META_APP_SECRET = SECRET;
    const sig = makeSignature(BODY, 'wrong-secret');
    expect(verifyMetaSignature(Buffer.from(BODY), sig)).toBe(false);
  });
});
