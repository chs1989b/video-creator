import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSegments } from '../src/pipeline/merge.js';

test('mergeSegments copies directly when there is only one segment', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  const result = await mergeSegments(['/tmp/a.mp4'], '/tmp/final.mp4', {
    execFile: fakeExecFile,
    getDuration: async () => 10,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['-y', '-i', '/tmp/a.mp4', '-c', 'copy', '/tmp/final.mp4']);
  assert.equal(result.outputPath, '/tmp/final.mp4');
});

test('mergeSegments builds a chained xfade/acrossfade filter for 3 segments', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };
  const durations = { '/tmp/a.mp4': 10, '/tmp/b.mp4': 10, '/tmp/c.mp4': 5 };
  const fakeGetDuration = async (filePath) => durations[filePath];

  await mergeSegments(['/tmp/a.mp4', '/tmp/b.mp4', '/tmp/c.mp4'], '/tmp/final.mp4', {
    execFile: fakeExecFile,
    crossfadeSeconds: 0.5,
    getDuration: fakeGetDuration,
    hasAudioStream: async () => true,
  });

  assert.equal(calls.length, 1);
  const [command, args] = [calls[0].command, calls[0].args];
  assert.equal(command, 'ffmpeg');
  assert.deepEqual(args.slice(0, 7), [
    '-y',
    '-i', '/tmp/a.mp4',
    '-i', '/tmp/b.mp4',
    '-i', '/tmp/c.mp4',
  ]);
  const filterComplexIndex = args.indexOf('-filter_complex');
  assert.ok(filterComplexIndex >= 0);
  const filterComplex = args[filterComplexIndex + 1];
  assert.equal(
    filterComplex,
    '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[v1];' +
      '[0:a][1:a]acrossfade=d=0.5[a1];' +
      '[v1][2:v]xfade=transition=fade:duration=0.5:offset=19[v2];' +
      '[a1][2:a]acrossfade=d=0.5[a2]',
  );
  assert.deepEqual(args.slice(-5), ['-map', '[v2]', '-map', '[a2]', '/tmp/final.mp4']);
});

test('mergeSegments builds a video-only xfade filter when the source has no audio stream', async () => {
  // Confirmed 2026-09-17 against real Higgsfield output: generated segments
  // are video-only (h264, single stream, no audio track).
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };
  const durations = { '/tmp/a.mp4': 10, '/tmp/b.mp4': 10 };
  const fakeGetDuration = async (filePath) => durations[filePath];

  await mergeSegments(['/tmp/a.mp4', '/tmp/b.mp4'], '/tmp/final.mp4', {
    execFile: fakeExecFile,
    crossfadeSeconds: 0.5,
    getDuration: fakeGetDuration,
    hasAudioStream: async () => false,
  });

  assert.equal(calls.length, 1);
  const [command, args] = [calls[0].command, calls[0].args];
  assert.equal(command, 'ffmpeg');
  const filterComplexIndex = args.indexOf('-filter_complex');
  const filterComplex = args[filterComplexIndex + 1];
  assert.equal(filterComplex, '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=9.5[v1]');
  assert.deepEqual(args.slice(-3), ['-map', '[v1]', '/tmp/final.mp4']);
});

test('mergeSegments\'s default hasAudioStream probes with ffprobe', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    if (command === 'ffprobe' && args.includes('-select_streams')) {
      return { stdout: '', stderr: '' }; // no audio stream index printed
    }
    return { stdout: '', stderr: '' };
  };

  await mergeSegments(['/tmp/a.mp4', '/tmp/b.mp4'], '/tmp/final.mp4', {
    execFile: fakeExecFile,
    getDuration: async () => 10,
  });

  const probeCall = calls.find((c) => c.command === 'ffprobe' && c.args.includes('-select_streams'));
  assert.ok(probeCall, 'must probe for an audio stream via ffprobe');
  assert.deepEqual(probeCall.args, [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0',
    '/tmp/a.mp4',
  ]);
});
