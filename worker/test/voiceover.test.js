import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeSpeech, muxVoiceover, DEFAULT_VOICE } from '../src/pipeline/voiceover.js';

test('synthesizeSpeech runs text2speech_v2 with the script and downloads the mp3', async () => {
  const calls = [];
  const fakeExecFile = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'higgsfield') {
      return {
        stdout: JSON.stringify([{ id: 'tts-1', status: 'completed', result_url: 'https://example.com/v.mp3' }]),
        stderr: '',
      };
    }
    return { stdout: '', stderr: '' };
  };

  const result = await synthesizeSpeech('Hello there.', '/tmp/job1/voiceover.mp3', { execFile: fakeExecFile });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [
    'generate', 'create', 'text2speech_v2',
    '--prompt', 'Hello there.',
    '--variant', DEFAULT_VOICE.variant,
    '--voice-id', DEFAULT_VOICE.voiceId,
    '--voice-type', DEFAULT_VOICE.voiceType,
    '--wait', '--json',
  ]);
  assert.ok(calls[0].options.timeout > 0);
  assert.deepEqual(calls[1].args, ['-fsSL', '-o', '/tmp/job1/voiceover.mp3', 'https://example.com/v.mp3']);
  assert.equal(result.outputPath, '/tmp/job1/voiceover.mp3');
});

test('synthesizeSpeech throws when the TTS job has no result_url', async () => {
  const fakeExecFile = async () => ({
    stdout: JSON.stringify([{ id: 'tts-2', status: 'failed', result_url: null }]),
    stderr: '',
  });
  await assert.rejects(
    synthesizeSpeech('x', '/tmp/v.mp3', { execFile: fakeExecFile }),
    /tts-2.*failed/,
  );
});

test('muxVoiceover maps the video stream and the narration, padding or trimming audio to the video length', async () => {
  const calls = [];
  const fakeExecFile = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: '' };
  };

  await muxVoiceover('/tmp/final.mp4', '/tmp/voiceover.mp3', '/tmp/final-voiced.mp4', { execFile: fakeExecFile });

  assert.equal(calls[0].command, 'ffmpeg');
  const args = calls[0].args;
  assert.deepEqual(args.slice(0, 5), ['-y', '-i', '/tmp/final.mp4', '-i', '/tmp/voiceover.mp3']);
  assert.ok(args.includes('-shortest'));
  assert.equal(args[args.indexOf('-af') + 1], 'apad');
  assert.equal(args[args.indexOf('-map') + 1], '0:v');
  assert.equal(args[args.length - 1], '/tmp/final-voiced.mp4');
});
