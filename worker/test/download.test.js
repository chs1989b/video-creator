import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { downloadVideo } from '../src/pipeline/download.js';

test('downloadVideo calls yt-dlp with the correct output template and returns the file path', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const result = await downloadVideo('https://youtube.com/watch?v=abc', '/tmp/job1', {
    execFile: fakeExecFile,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'yt-dlp');
  assert.deepEqual(calls[0].args, [
    '-f', 'mp4',
    '-o', path.join('/tmp/job1', 'source.%(ext)s'),
    'https://youtube.com/watch?v=abc',
  ]);
  assert.equal(result.filePath, path.join('/tmp/job1', 'source.mp4'));
});
