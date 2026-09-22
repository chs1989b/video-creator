import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFromSegment } from '../src/pipeline/generate.js';

test('generateFromSegment mutes the segment, calls the Higgsfield CLI model, then downloads result_url', async () => {
  const calls = [];
  const fakeExecFile = async (command, args, options) => {
    calls.push({ command, args, options });
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

  assert.equal(calls.length, 3);

  assert.equal(calls[0].command, 'ffmpeg');
  assert.deepEqual(calls[0].args, [
    '-y', '-i', '/tmp/job1/segment-000.mp4', '-an', '-c:v', 'copy', '/tmp/job1/muted-segment-000.mp4',
  ]);

  assert.equal(calls[1].command, 'higgsfield');
  const [promptFlagIndex] = [calls[1].args.indexOf('--prompt')];
  const prompt = calls[1].args[promptFlagIndex + 1];
  // Higgsfield's backend rejects an empty prompt ("String should have at
  // least 1 character"), so the exact wording is free to change but it must
  // never be blank.
  assert.ok(prompt.trim().length > 0, 'prompt must be non-empty');
  assert.deepEqual(calls[1].args, [
    'generate', 'create', 'ad_multiplier',
    '--mode', 'video_edit',
    '--prompt', prompt,
    '--video-references', '/tmp/job1/muted-segment-000.mp4',
    '--image-references', '/tmp/job1/char1.png',
    '--wait', '--json',
  ]);
  // The Higgsfield CLI's --wait has been observed to hang indefinitely in
  // real use; the call must be bounded so a hung generation fails the
  // segment instead of blocking the worker forever.
  assert.ok(calls[1].options.timeout > 0, 'higgsfield call must have a positive timeout');

  assert.equal(calls[2].command, 'curl');
  assert.deepEqual(calls[2].args, [
    '-fsSL', '-o', '/tmp/job1/generated-0.mp4', 'https://example.com/result.mp4',
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

test('generateFromSegment recovers a completed job after the CLI is killed by our timeout', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'create') {
      const error = new Error('command timed out');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    }
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'list') {
      return {
        stdout: JSON.stringify([
          {
            id: 'job-recovered',
            created_at: new Date().toISOString(),
            status: 'completed',
            result_url: 'https://example.com/recovered.mp4',
          },
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

  assert.equal(calls.length, 4);
  assert.equal(calls[0].command, 'ffmpeg');
  assert.deepEqual(calls[2].args, ['generate', 'list', '--json']);
  assert.equal(calls[3].command, 'curl');
  assert.deepEqual(calls[3].args, [
    '-fsSL', '-o', '/tmp/job1/generated-0.mp4', 'https://example.com/recovered.mp4',
  ]);
  assert.equal(result.outputPath, '/tmp/job1/generated-0.mp4');
});

test('generateFromSegment recovers an nsfw job after the CLI\'s own internal wait times out (not our execFile timeout)', async () => {
  // Observed 2026-09-17: the CLI can give up on its own ("Error: timed out
  // waiting for job ...") well before our execFile timeout — a plain
  // non-zero exit, so error.killed is false. Recovery must not depend on
  // error.killed to catch this case too.
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'create') {
      throw new Error('Error: timed out waiting for job abc-123');
    }
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'list') {
      return {
        stdout: JSON.stringify([
          { id: 'abc-123', created_at: new Date().toISOString(), status: 'nsfw', result_url: null },
        ]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  await assert.rejects(
    generateFromSegment('/tmp/a.mp4', '/tmp/char.png', '/tmp/out.mp4', { execFile: fakeExecFile }),
    /abc-123.*nsfw/,
  );
  assert.equal(calls.length, 3, 'must have queried `generate list` to recover the real status');
});

test('generateFromSegment gives up when a timed-out job is still waiting/generating on Higgsfield', async () => {
  const fakeExecFile = async (command, args) => {
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'create') {
      const error = new Error('command timed out');
      error.killed = true;
      error.signal = 'SIGTERM';
      throw error;
    }
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'list') {
      return {
        stdout: JSON.stringify([
          { id: 'job-still-going', created_at: new Date().toISOString(), status: 'waiting', result_url: null },
        ]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  await assert.rejects(
    generateFromSegment('/tmp/a.mp4', '/tmp/char.png', '/tmp/out.mp4', { execFile: fakeExecFile }),
    /command timed out/,
  );
});

test('generateFromSegment falls back to the original error when no matching job is found', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'create') {
      throw new Error('Error: Unknown params: duration');
    }
    if (command === 'higgsfield' && args[0] === 'generate' && args[1] === 'list') {
      return { stdout: JSON.stringify([]), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };

  await assert.rejects(
    generateFromSegment('/tmp/a.mp4', '/tmp/char.png', '/tmp/out.mp4', { execFile: fakeExecFile }),
    /Unknown params/,
  );
  assert.equal(calls.length, 3, 'recovery is attempted even for non-timeout errors, but finds nothing');
});
