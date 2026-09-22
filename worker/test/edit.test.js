import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editVideo } from '../src/pipeline/edit.js';

test('editVideo runs flux_3_video_edit with the prompt and downloads the result', async () => {
  const calls = [];
  const fakeExecFile = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'higgsfield') {
      return {
        stdout: JSON.stringify([{ id: 'edit-1', status: 'completed', result_url: 'https://example.com/e.mp4' }]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  const result = await editVideo('/tmp/job/final.mp4', 'Warmer lighting.', '/tmp/job/final-edited.mp4', {
    execFile: fakeExecFile,
  });

  assert.deepEqual(calls[0].args, [
    'generate', 'create', 'flux_3_video_edit',
    '--prompt', 'Warmer lighting.',
    '--video-references', '/tmp/job/final.mp4',
    '--wait', '--json',
  ]);
  assert.ok(calls[0].options.timeout > 0);
  assert.deepEqual(calls[1].args, ['-fsSL', '-o', '/tmp/job/final-edited.mp4', 'https://example.com/e.mp4']);
  assert.equal(result.outputPath, '/tmp/job/final-edited.mp4');
});

test('editVideo recovers a job that completed server-side after the CLI gave up', async () => {
  const fakeExecFile = async (command, args) => {
    if (command === 'higgsfield' && args[1] === 'create') {
      throw new Error('Error: timed out waiting for job x');
    }
    if (command === 'higgsfield' && args[1] === 'list') {
      return {
        stdout: JSON.stringify([
          { id: 'edit-2', created_at: new Date().toISOString(), status: 'completed', result_url: 'https://example.com/r.mp4' },
        ]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  const result = await editVideo('/tmp/a.mp4', 'p', '/tmp/out.mp4', { execFile: fakeExecFile });
  assert.equal(result.outputPath, '/tmp/out.mp4');
});

test('editVideo throws when the edit job has no result_url', async () => {
  const fakeExecFile = async () => ({
    stdout: JSON.stringify([{ id: 'edit-3', status: 'failed', result_url: null }]),
    stderr: '',
  });
  await assert.rejects(editVideo('/tmp/a.mp4', 'p', '/tmp/out.mp4', { execFile: fakeExecFile }), /edit-3.*failed/);
});
