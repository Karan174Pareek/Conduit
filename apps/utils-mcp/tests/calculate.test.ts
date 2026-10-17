import { describe, expect, it } from 'vitest';
import { safeEvaluateMath } from '../src/server.js';

describe('utils-mcp safeEvaluateMath', () => {
  it('correctly calculates basic arithmetic expressions', () => {
    expect(safeEvaluateMath('2 + 2')).toBe(4);
    expect(safeEvaluateMath('10 - 4')).toBe(6);
    expect(safeEvaluateMath('3 * 7')).toBe(21);
    expect(safeEvaluateMath('20 / 4')).toBe(5);
  });

  it('respects operator precedence and parentheses', () => {
    expect(safeEvaluateMath('2 + 3 * 4')).toBe(14);
    expect(safeEvaluateMath('(2 + 3) * 4')).toBe(20);
    expect(safeEvaluateMath('2 ^ 3')).toBe(8);
    expect(safeEvaluateMath('2 ^ 3 + 1')).toBe(9);
    expect(safeEvaluateMath('10 + (2 * (3 + 4))')).toBe(24);
  });

  it('handles negative numbers and floating point decimals', () => {
    expect(safeEvaluateMath('-5 + 3')).toBe(-2);
    expect(safeEvaluateMath('10.5 * 2')).toBe(21);
    expect(safeEvaluateMath('(-2.5) * 4')).toBe(-10);
  });

  it('strictly rejects code injection attempts without executing eval or Function', () => {
    const maliciousPayloads = [
      'process.exit(1)',
      'eval("2+2")',
      'Function("return 42")()',
      'console.log("pwned")',
      '__proto__',
      'globalThis',
      'import("fs")',
      'require("child_process")',
      'window',
      'alert(1)',
      '<script>alert(1)</script>',
      '${7*7}',
      '; rm -rf /',
    ];

    for (const payload of maliciousPayloads) {
      expect(() => safeEvaluateMath(payload)).toThrow(/Invalid mathematical expression/);
    }
  });

  it('fails safely on division by zero', () => {
    expect(() => safeEvaluateMath('10 / 0')).toThrow(/Division by zero/);
  });

  it('fails on mismatched parentheses and syntax errors', () => {
    expect(() => safeEvaluateMath('(2 + 3')).toThrow(/Mismatched parentheses/);
    expect(() => safeEvaluateMath('2 + + +')).toThrow();
  });
});
