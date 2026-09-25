import { describe, expect, it } from 'vitest';
import { loadExtensionScripts } from './load-scripts.js';

loadExtensionScripts('lib/gemini-vision.js');

describe('Gemini card prompt', () => {
  it('no longer carries a hard-coded JP to EN set mapping list', () => {
    expect(GEMINI_CARD_CODE_PROMPT).not.toContain('Common JP→EN set mappings');
    expect(GEMINI_CARD_CODE_PROMPT).not.toContain('SV8a→PRZ');
    expect(GEMINI_CARD_CODE_PROMPT).not.toContain('basep→BPR');
  });

  it('still asks for the counterpart fields as a fallback', () => {
    expect(GEMINI_CARD_CODE_PROMPT).toContain('crossSetCode');
    expect(GEMINI_CARD_CODE_PROMPT).toContain('crossCardNumber to null');
    expect(GEMINI_CARD_CODE_PROMPT).toContain('"cardNumber": "017/193"');
  });

  it('tells the model that the app resolves set mappings itself', () => {
    expect(GEMINI_CARD_CODE_PROMPT).toContain('resolves JP↔EN set mappings from its own bundled card data');
  });
});

describe('repairJsonEscapes', () => {
  it('leaves valid escapes alone', () => {
    const valid = '{"a": "line\\nbreak \\u30b9 \\\\ quote\\" "}';
    expect(repairJsonEscapes(valid)).toBe(valid);
  });

  it('drops the backslash of a truncated unicode escape', () => {
    expect(repairJsonEscapes('{"cardNameJp": "\\u30b"}')).toBe('{"cardNameJp": "u30b"}');
  });

  it('drops a lone backslash before a normal character', () => {
    expect(repairJsonEscapes('{"a": "x\\y"}')).toBe('{"a": "xy"}');
  });

  it('keeps an escaped backslash even when a plain character follows it', () => {
    // "\\\\ " is a valid escaped backslash; the second backslash must not be
    // mistaken for a lone escape just because a space follows.
    expect(repairJsonEscapes('{"a": "c:\\\\ dir"}')).toBe('{"a": "c:\\\\ dir"}');
  });
});

describe('parseGeminiTextOutput', () => {
  it('parses a plain JSON object', () => {
    const outcome = parseGeminiTextOutput('{"setCode": "XY", "cardNumber": "5/146", "cardName": "Beedrill"}');
    expect(outcome.error).toBeUndefined();
    expect(outcome.data).toMatchObject({ setCode: 'XY', cardNumber: '5/146', cardName: 'Beedrill' });
  });

  it('parses JSON wrapped in markdown fences', () => {
    const outcome = parseGeminiTextOutput('```json\n{"setCode": "MEW", "isPromo": false}\n```');
    expect(outcome.data).toMatchObject({ setCode: 'MEW', isPromo: false });
  });

  it('recovers from a bad unicode escape instead of failing the scan', () => {
    // The reported failure: a truncated \u30b inside the Japanese name.
    const outcome = parseGeminiTextOutput('{"setCode": "XY", "cardNumber": "5/146", "cardNameJp": "\\u30b"}');
    expect(outcome.error).toBeUndefined();
    expect(outcome.data).toMatchObject({ setCode: 'XY', cardNumber: '5/146' });
  });

  it('reports an error when there is no JSON object', () => {
    expect(parseGeminiTextOutput('sorry, I cannot read this').error).toContain('Could not parse');
  });

  it('reports the parse error when even the repaired text is invalid', () => {
    const outcome = parseGeminiTextOutput('{"setCode": "XY",,}');
    expect(outcome.error).toContain('JSON parse error');
  });
});
