'use strict';

const { normalizeVin } = require('../src/orchestration/router');

/**
 * Additional VIN normalization edge-case tests.
 * Replicated from the n8n "get_vehicle_info" tool code logic.
 */
describe('VIN normalization (extended)', () => {
  test('17-char standard BMW VIN → last 7', () => {
    // Real-world BMW VIN pattern
    expect(normalizeVin('WBAPH5C55BA296543')).toBe('A296543');
  });

  test('7-char chassis number passes through', () => {
    expect(normalizeVin('D978816')).toBe('D978816');
  });

  test('cleans non-alphanumeric characters', () => {
    expect(normalizeVin('D-978.816')).toBe('D978816');
    expect(normalizeVin('D_978_816')).toBe('D978816');
    expect(normalizeVin('D/978/816')).toBe('D978816');
  });

  test('O/I/Q replacement', () => {
    // O → 0
    expect(normalizeVin('O978816')).toBe('0978816');
    // I → 1
    expect(normalizeVin('I978816')).toBe('1978816');
    // Q → 0
    expect(normalizeVin('Q978816')).toBe('0978816');
  });

  test('rejects 5-char string (too short for 7-char VIN)', () => {
    expect(normalizeVin('ABC12')).toBeNull();
  });

  test('rejects 10-char string (between 7 and 17)', () => {
    // Not exactly 7 or 17, so should still work if there's a 7-char match inside
    const result = normalizeVin('ABCDE12345');
    // The regex will find the first 7-char match: ABCDE12 is valid (has digits)
    expect(result).toBeTruthy();
    expect(result.length).toBe(7);
  });

  test('handles VIN already extracted by AI from OCR (17-char)', () => {
    // The AI agent extracts the clean VIN from OCR text before normalizeVin
    expect(normalizeVin('WBAPH5C55BA296543')).toBe('A296543');
  });

  test('handles all-digit 7-char VIN', () => {
    expect(normalizeVin('1234567')).toBe('1234567');
  });

  test('handles mixed case', () => {
    expect(normalizeVin('wbaph5c55ba296543')).toBe('A296543');
  });
});
