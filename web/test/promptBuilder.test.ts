import { test, expect } from 'vitest';
import { buildTemplatePrompt, KEEP_CLAUSE, FACE_SWAP_BASE } from '../lib/promptBuilder';

test('restyle: known Korean words become an English change, always followed by what to keep', () => {
  const r = buildTemplatePrompt({ stage: 'restyle', request: '옷은 베이지 셔츠로, 배경은 화이트 스튜디오' });
  expect(r.prompt).toBe(`Change the outfit to a beige shirt. Change the background to a clean white studio. ${KEEP_CLAUSE}`);
  expect(r.changed).toEqual(['의상: 베이지 셔츠', '배경: 화이트 스튜디오']);
  expect(r.kept).toEqual(['얼굴', '머리', '손에 든 제품', '동작', '구도']);
  expect(r.source).toBe('template');
});

test('edit: lighting and tone words', () => {
  const r = buildTemplatePrompt({ stage: 'edit', request: '조명을 좀 더 따뜻하고 밝게' });
  expect(r.prompt).toBe(`Make the lighting warmer and brighter. ${KEEP_CLAUSE}`);
  expect(r.changed).toEqual(['조명: 따뜻하게, 밝게']);
});

test('face: the base swap prompt plus a fix for each reject reason, and an English note passes through', () => {
  const r = buildTemplatePrompt({ stage: 'face', request: 'Keep her smile natural.', rejectReasons: ['얼굴', '제품'] });
  expect(r.prompt).toBe(
    `${FACE_SWAP_BASE} Match the reference face closely: face shape, eyes, nose and skin tone. `
    + 'Keep the product fully visible in the hand, at the same size and angle as in the reference image. Keep her smile natural.',
  );
});

test('words it cannot translate are reported instead of being sent as Korean', () => {
  const r = buildTemplatePrompt({ stage: 'restyle', request: '고양이 귀 머리띠' });
  expect(r.prompt).toBe(KEEP_CLAUSE);
  expect(r.notice).toMatch(/알아듣지 못한 표현/);
  expect(r.notice).toMatch(/고양이 귀 머리띠/);
});
