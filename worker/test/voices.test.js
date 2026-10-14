import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, DEFAULT_VOICE_KEY, voiceFor, isVoiceKey } from '../src/pipeline/voices.js';

test('there are two female and two male voices, and the default is the original Brielle', () => {
  assert.deepEqual(VOICES.map((v) => v.key), ['female-1', 'female-2', 'male-1', 'male-2']);
  assert.equal(VOICES.filter((v) => v.gender === 'female').length, 2);
  assert.equal(VOICES.filter((v) => v.gender === 'male').length, 2);
  assert.equal(DEFAULT_VOICE_KEY, 'female-1');
  assert.deepEqual(voiceFor('female-1'), { variant: 'elevenlabs', voiceId: 'a00bc7f3-0236-5e76-ac65-90137ce0f5a4', voiceType: 'preset' });
});

test('voiceFor falls back to the default for a missing key and rejects an unknown one', () => {
  assert.deepEqual(voiceFor(undefined), voiceFor('female-1'));
  assert.deepEqual(voiceFor(null), voiceFor('female-1'));
  assert.throws(() => voiceFor('robot'), /Unknown voice/);
  assert.equal(isVoiceKey('male-2'), true);
  assert.equal(isVoiceKey('robot'), false);
});
