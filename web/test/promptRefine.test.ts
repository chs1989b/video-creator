import { describe, expect, it } from 'vitest';
import { RefineInputError, parseRefineInput, refinePrompt } from '../lib/promptRefine';
import { KEEP_CLAUSE } from '../lib/promptBuilder';

const claudeAnswer = {
  prompt: 'Change the outfit to a beige linen shirt. ' + KEEP_CLAUSE,
  explanation_ko: '의상을 베이지 린넨 셔츠로 바꾸고 나머지는 유지합니다.',
  changed: ['의상: 베이지 린넨 셔츠'],
  kept: ['얼굴', '머리', '손에 든 제품', '동작', '구도'],
};

describe('parseRefineInput', () => {
  it('accepts a stage with a request', () => {
    expect(parseRefineInput({ stage: 'edit', request: ' 따뜻하게 ' }))
      .toEqual({ stage: 'edit', request: '따뜻하게', rejectReasons: [] });
  });

  it('rejects an unknown stage, an empty request and an overlong one', () => {
    expect(() => parseRefineInput({ stage: 'music', request: 'x' })).toThrow(RefineInputError);
    expect(() => parseRefineInput({ stage: 'restyle', request: '  ' })).toThrow(/입력/);
    expect(() => parseRefineInput({ stage: 'restyle', request: 'a'.repeat(501) })).toThrow(/500/);
  });

  it('lets a face prompt start from reject reasons alone, keeping only known reasons', () => {
    expect(parseRefineInput({ stage: 'face', request: '', rejectReasons: ['얼굴', '해킹'] }))
      .toEqual({ stage: 'face', request: '', rejectReasons: ['얼굴'] });
  });
});

describe('refinePrompt', () => {
  const input = { stage: 'restyle' as const, request: '베이지 린넨 셔츠', rejectReasons: [] };

  it('uses the template when no Claude caller is configured', async () => {
    const result = await refinePrompt(input);
    expect(result.source).toBe('template');
    expect(result.prompt).toBe(`Change the outfit to a beige linen shirt. ${KEEP_CLAUSE}`);
  });

  it('returns the Claude answer when the call succeeds', async () => {
    const result = await refinePrompt(input, { callClaude: async () => claudeAnswer });
    expect(result).toEqual({ ...claudeAnswer, source: 'claude' });
  });

  it('falls back to the template with a notice when Claude refuses or fails', async () => {
    const refused = await refinePrompt(input, { callClaude: async () => null });
    expect(refused.source).toBe('template');
    expect(refused.notice).toMatch(/간단 변환/);

    const failed = await refinePrompt(input, { callClaude: async () => { throw new Error('timeout'); } });
    expect(failed.source).toBe('template');
    expect(failed.notice).toMatch(/간단 변환/);
  });
});
