import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFromSegment } from '../src/pipeline/generate.js';

test('generateFromSegment calls the Higgsfield CLI workflow, then downloads result_url', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield') {
      return {
        stdout: JSON.stringify([
          { id: 'job-123', status: 'succeeded', result_url: 'https://example.com/result.mp4' },
        ]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  const result = await generateFromSegment(
    '/tmp/job1/segment-000.mp4',
    '/tmp/job1/char1.png',
    '/tmp/job1/generated-0.mp4',
    { execFile: fakeExecFile },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'higgsfield');
  assert.deepEqual(calls[0].args, [
    'generate', 'workflow', 'kling3_0_motion_control',
    '--video-references', '/tmp/job1/segment-000.mp4',
    '--image-references', '/tmp/job1/char1.png',
    '--mode', 'std',
    '--wait', '--json',
  ]);

  assert.equal(calls[1].command, 'curl');
  assert.deepEqual(calls[1].args, [
    '-sS', '-o', '/tmp/job1/generated-0.mp4', 'https://example.com/result.mp4',
  ]);

  assert.equal(result.outputPath, '/tmp/job1/generated-0.mp4');
});

test('generateFromSegment throws a clear error when the job has no result_url', async () => {
  const fakeExecFile = async (command) => {
    if (command === 'higgsfield') {
      return {
        stdout: JSON.stringify([{ id: 'job-456', status: 'failed', result_url: null }]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  await assert.rejects(
    generateFromSegment('/tmp/a.mp4', '/tmp/char.png', '/tmp/out.mp4', { execFile: fakeExecFile }),
    /job-456/,
  );
});
