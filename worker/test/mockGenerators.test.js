import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  mockGenerateFromSegment, mockEditVideo, mockSynthesizeSpeech, MOCK_DEPS,
} from '../src/pipeline/mockGenerators.js';

const recorder = () => {
  const calls = [];
  const execFile = async (command, args) => { calls.push({ command, args }); return { stdout: '', stderr: '' }; };
  return { calls, execFile };
};

test('mock face swap copies the segment without its audio and never calls Higgsfield', async () => {
  const { calls, execFile } = recorder();

  const result = await mockGenerateFromSegment('/tmp/j/segment-000.mp4', '/tmp/j/char.png', '/tmp/j/preview-1.mp4', {
    execFile, productImagePath: '/tmp/j/p.png', prompt: 'anything',
  });

  assert.deepEqual(calls, [{ command: 'ffmpeg', args: ['-y', '-i', '/tmp/j/segment-000.mp4', '-an', '-c:v', 'copy', '/tmp/j/preview-1.mp4'] }]);
  assert.equal(result.outputPath, '/tmp/j/preview-1.mp4');
});

test('mock edit copies the input video as the edited result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-edit-'));
  const input = path.join(dir, 'final.mp4');
  await fs.writeFile(input, 'video-bytes');

  const result = await mockEditVideo(input, 'Beige shirt.', path.join(dir, 'final-restyled.mp4'));

  assert.equal(await fs.readFile(result.outputPath, 'utf8'), 'video-bytes');
});

test('mock narration makes silence about as long as reading the script', async () => {
  const { calls, execFile } = recorder();

  await mockSynthesizeSpeech('one two three four five six seven eight nine ten eleven twelve', '/tmp/j/voiceover.mp3', { execFile });
  await mockSynthesizeSpeech('Hi.', '/tmp/j/short.mp3', { execFile });

  const duration = (args) => args[args.indexOf('-t') + 1];
  assert.equal(calls[0].command, 'ffmpeg');
  assert.ok(calls[0].args.includes('anullsrc=r=44100:cl=mono'));
  assert.equal(duration(calls[0].args), '5'); // 12 words at 2.5 words per second
  assert.equal(duration(calls[1].args), '2'); // never shorter than 2 seconds
  assert.equal(calls[0].args.at(-1), '/tmp/j/voiceover.mp3');
});

test('MOCK_DEPS replaces exactly the three paid calls', () => {
  assert.deepEqual(Object.keys(MOCK_DEPS).sort(), ['editVideo', 'generateFromSegment', 'synthesizeSpeech']);
});
