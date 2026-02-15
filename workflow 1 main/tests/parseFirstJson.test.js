'use strict';

const { parseFirstJson, extractFirstJson, stripCodeFences } = require('../src/ai/parseFirstJson');

describe('stripCodeFences', () => {
  test('removes ```json ... ``` fences', () => {
    const input = '```json\n{"scenario":"vin"}\n```';
    expect(stripCodeFences(input)).toBe('{"scenario":"vin"}');
  });

  test('removes ``` ... ``` fences', () => {
    const input = '```\n[{"scenario":"part"}]\n```';
    expect(stripCodeFences(input)).toBe('[{"scenario":"part"}]');
  });

  test('returns plain text as-is', () => {
    const input = '{"scenario":"vin"}';
    expect(stripCodeFences(input)).toBe('{"scenario":"vin"}');
  });
});

describe('extractFirstJson', () => {
  test('extracts object from mixed text', () => {
    const input = 'Some text before {"scenario":"vin","vin":"ABC1234"} and after';
    const result = extractFirstJson(input);
    expect(result).toBe('{"scenario":"vin","vin":"ABC1234"}');
  });

  test('extracts array from mixed text', () => {
    const input = 'Here is [{"scenario":"part"},{"scenario":"vin"}] done';
    const result = extractFirstJson(input);
    expect(result).toBe('[{"scenario":"part"},{"scenario":"vin"}]');
  });

  test('handles nested objects', () => {
    const input = '{"a":{"b":"c"},"d":[1,2]}';
    const result = extractFirstJson(input);
    expect(JSON.parse(result)).toEqual({ a: { b: 'c' }, d: [1, 2] });
  });

  test('returns empty string if no JSON', () => {
    expect(extractFirstJson('no json here')).toBe('');
  });

  test('handles strings with braces inside', () => {
    const input = '{"msg":"open { and close }","val":1}';
    const result = extractFirstJson(input);
    expect(JSON.parse(result)).toEqual({ msg: 'open { and close }', val: 1 });
  });
});

describe('parseFirstJson', () => {
  test('parses single object', () => {
    const raw = '{"scenario":"vin","vin":"D978816","part_name":[],"human_text":"جاري البحث"}';
    const items = parseFirstJson(raw);
    expect(items).toHaveLength(1);
    expect(items[0].scenario).toBe('vin');
    expect(items[0].vin).toBe('D978816');
    expect(items[0].part_name).toEqual([]);
    expect(items[0].human_text).toBe('جاري البحث');
  });

  test('parses array of items', () => {
    const raw = '[{"scenario":"part","vin":"","part_name":["oil filter"],"human_text":"a"},{"scenario":"unrecognized","vin":"","part_name":[],"human_text":"b"}]';
    const items = parseFirstJson(raw);
    expect(items).toHaveLength(2);
    expect(items[0].scenario).toBe('part');
    expect(items[0].part_name).toEqual(['oil filter']);
    expect(items[1].scenario).toBe('unrecognized');
  });

  test('handles code fences around JSON', () => {
    const raw = '```json\n{"scenario":"kit","vin":"","part_name":["طقم فرامل"],"human_text":"تم"}\n```';
    const items = parseFirstJson(raw);
    expect(items).toHaveLength(1);
    expect(items[0].scenario).toBe('kit');
  });

  test('handles extra text around JSON', () => {
    const raw = 'Here is my analysis:\n{"scenario":"finalize","vin":"","part_name":[],"human_text":"خلاص"}\nDone.';
    const items = parseFirstJson(raw);
    expect(items).toHaveLength(1);
    expect(items[0].scenario).toBe('finalize');
  });

  test('throws on empty input', () => {
    expect(() => parseFirstJson('')).toThrow();
    expect(() => parseFirstJson(null)).toThrow();
  });

  test('throws on non-JSON input', () => {
    expect(() => parseFirstJson('no json here at all')).toThrow();
  });

  test('defaults missing fields', () => {
    const raw = '{"scenario":"part"}';
    const items = parseFirstJson(raw);
    expect(items[0].vin).toBe('');
    expect(items[0].part_name).toEqual([]);
    expect(items[0].human_text).toBe('');
  });

  test('converts null values to defaults', () => {
    const raw = '{"scenario":"vin","vin":null,"part_name":null,"human_text":null}';
    const items = parseFirstJson(raw);
    expect(items[0].vin).toBe('');
    expect(items[0].part_name).toEqual([]);
    expect(items[0].human_text).toBe('');
  });
});
