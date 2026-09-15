import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getDuration, splitIntoSegments } from '../src/pipeline/segment.js';

test('getDuration parses ffprobe stdout as a float', async () => {
  const fakeExecFile = async () => ({ stdout: '35.500000\n', stderr: '' });
  const duration = await getDuration('/tmp/source.mp4', { execFile: fakeExecFile });
  assert.equal(duration, 35.5);
});

test('splitIntoSegments creates contiguous 10-second segments covering the full duration', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const segments = await splitIntoSegments('/tmp/source.mp4', '/tmp/job1', 10, {
    execFile: fakeExecFile,
    duration: 25,
  });

  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], {
    index: 0,
    path: path.join('/tmp/job1', 'segment-000.mp4'),
    startSeconds: 0,
    endSeconds: 10,
  });
  assert.deepEqual(segments[1], {
    index: 1,
    path: path.join('/tmp/job1', 'segment-001.mp4'),
    startSeconds: 10,
    endSeconds: 20,
  });
  assert.deepEqual(segments[2], {
    index: 2,
    path: path.join('/tmp/job1', 'segment-002.mp4'),
    startSeconds: 20,
    endSeconds: 25,
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].args, [
    '-y',
    '-ss', '20',
    '-i', '/tmp/source.mp4',
    '-t', '5',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    path.join('/tmp/job1', 'segment-002.mp4'),
  ]);
});
