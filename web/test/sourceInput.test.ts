import { expect, it } from 'vitest';
import { sourceInputError, formatBytes, MAX_SOURCE_BYTES } from '../lib/sourceInput';
import { config } from '../middleware';

const file = (name: string, size = 1000) => ({ name, size });

it('needs exactly one source: a link or an allowed video file', () => {
  expect(sourceInputError({ url: '', file: null })).toMatch(/링크나 파일/);
  expect(sourceInputError({ url: 'https://e.com/v.mp4', file: null })).toBeNull();
  expect(sourceInputError({ url: '', file: file('review.MOV') })).toBeNull();
  expect(sourceInputError({ url: '', file: file('notes.pdf') })).toMatch(/mp4, mov, m4v, webm/);
  expect(sourceInputError({ url: '', file: file('big.mp4', MAX_SOURCE_BYTES + 1) })).toMatch(/200MB/);
});

it('formats file sizes for the card', () => {
  expect(formatBytes(2_138_852)).toBe('2.0MB');
  expect(formatBytes(900)).toBe('1KB');
});

it('leaves the worker proxy out of the middleware so large uploads are not cut at 10MB', () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);
  expect(pattern.test('/')).toBe(true);
  expect(pattern.test('/api/auth/me')).toBe(true);
  expect(pattern.test('/api/prompt/refine')).toBe(true);
  expect(pattern.test('/api/worker/jobs')).toBe(false);
});
