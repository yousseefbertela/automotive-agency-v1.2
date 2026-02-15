'use strict';

const { routeScenario, normalizeVin } = require('../src/orchestration/router');

describe('routeScenario', () => {
  test('routes "vin" correctly', () => {
    expect(routeScenario({ scenario: 'vin' })).toBe('vin');
  });

  test('routes "part" correctly', () => {
    expect(routeScenario({ scenario: 'part' })).toBe('part');
  });

  test('routes "kit" correctly', () => {
    expect(routeScenario({ scenario: 'kit' })).toBe('kit');
  });

  test('routes "finalize" correctly', () => {
    expect(routeScenario({ scenario: 'finalize' })).toBe('finalize');
  });

  test('routes "unrecognized" correctly', () => {
    expect(routeScenario({ scenario: 'unrecognized' })).toBe('unrecognized');
  });

  test('routes unknown scenarios to "unrecognized"', () => {
    expect(routeScenario({ scenario: 'foo' })).toBe('unrecognized');
    expect(routeScenario({ scenario: '' })).toBe('unrecognized');
    expect(routeScenario({})).toBe('unrecognized');
  });

  test('handles case-insensitive scenarios', () => {
    expect(routeScenario({ scenario: 'VIN' })).toBe('vin');
    expect(routeScenario({ scenario: 'Part' })).toBe('part');
    expect(routeScenario({ scenario: 'KIT' })).toBe('kit');
    expect(routeScenario({ scenario: 'FINALIZE' })).toBe('finalize');
  });

  test('trims whitespace in scenario', () => {
    expect(routeScenario({ scenario: '  vin  ' })).toBe('vin');
    expect(routeScenario({ scenario: ' part ' })).toBe('part');
  });
});

describe('normalizeVin', () => {
  test('extracts last 7 chars from 17-char VIN', () => {
    // WBAPH5C55BA123456 → last 7 = A123456
    // After cleanup: O→0, I→1, Q→0
    expect(normalizeVin('WBAPH5C55BA123456')).toBe('A123456');
  });

  test('returns 7-char VIN as-is', () => {
    expect(normalizeVin('D978816')).toBe('D978816');
  });

  test('cleans up special characters', () => {
    expect(normalizeVin('D-978-816')).toBe('D978816');
    expect(normalizeVin('D 978 816')).toBe('D978816');
  });

  test('replaces O→0, I→1, Q→0', () => {
    // 'D97881O' → O becomes 0 → 'D978810'
    expect(normalizeVin('D97881O')).toBe('D978810');
    // 'D97881I' → I becomes 1 → 'D978811'
    expect(normalizeVin('D97881I')).toBe('D978811');
  });

  test('returns null for invalid input', () => {
    expect(normalizeVin('')).toBeNull();
    expect(normalizeVin(null)).toBeNull();
    expect(normalizeVin(undefined)).toBeNull();
    expect(normalizeVin('abc')).toBeNull(); // too short and no valid match
  });

  test('handles VIN already extracted by AI (17-char)', () => {
    // AI agent extracts the VIN before passing to normalizeVin
    expect(normalizeVin('WBAPH5C55BA123456')).toBe('A123456');
  });

  test('handles lowercase input', () => {
    expect(normalizeVin('d978816')).toBe('D978816');
  });

  test('prefers 17-char match over 7-char', () => {
    // Full VIN that also contains a valid 7-char sequence
    const vin17 = 'WBAPH5C55BA654321';
    expect(normalizeVin(vin17)).toBe('A654321');
  });
});
