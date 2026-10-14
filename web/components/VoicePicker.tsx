'use client';

import { useRef, useState } from 'react';
import { voiceSampleUrl, type Voice } from '../lib/workerApi';
import { narrationLanguage, narrationLengthHint } from '../lib/narration';

export type VoicePickerProps = {
  voices: Voice[];
  value: string;
  onChange: (key: string) => void;
  disabled: boolean;
  /** The current script: decides which sample to play and what the hint says. */
  script: string;
  /** Length of the job's video once known, to warn when the narration will be cut. */
  videoSeconds: number | null;
};

const LANGUAGE_HINT = { ko: '한국어 대본으로 읽습니다', en: '영어 대본으로 읽습니다' } as const;

/** Narration voice: two female, two male, each able to read Korean and English. */
export function VoicePicker({ voices, value, onChange, disabled, script, videoSeconds }: VoicePickerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const language = narrationLanguage(script);
  const length = narrationLengthHint(script, videoSeconds);
  const voice = voices.find((v) => v.key === value);
  // Play the sample in the script's language; with no script yet, Korean first.
  const sampleLang = language ?? (voice?.samples.ko ? 'ko' : 'en');
  const canPlay = Boolean(voice?.samples[sampleLang]);

  const play = () => {
    if (!voice || !canPlay) return;
    audioRef.current?.pause();
    const audio = new Audio(voiceSampleUrl(voice.key, sampleLang));
    audioRef.current = audio;
    setPlaying(true);
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audio.play().catch(() => setPlaying(false));
  };

  if (voices.length === 0) return null;

  return (
    <div className="nodrag mt-2">
      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="voice-select">나레이션 목소리</label>
        <select
          id="voice-select"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--card-border)] bg-[var(--well)] px-2 py-1 text-[12.5px] text-[var(--ink)] disabled:opacity-50"
        >
          {voices.map((v) => (
            <option key={v.key} value={v.key}>{`${v.label} · ${v.name}`}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={play}
          disabled={!canPlay}
          title={canPlay ? `${sampleLang === 'ko' ? '한국어' : '영어'} 샘플 듣기` : '이 컴퓨터에 샘플이 없습니다'}
          className="shrink-0 rounded-md border border-[var(--card-border-strong)] px-2 py-1 text-[12px] text-[var(--ink)] hover:border-[var(--text-edge)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? '재생 중' : '미리 듣기'}
        </button>
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--ink-muted)]">
        {language ? LANGUAGE_HINT[language] : '대본을 쓴 언어(한국어·영어)로 읽습니다'}
      </div>
      {length && (
        <div className={`mt-0.5 text-[11.5px] ${length.tone === 'warn' ? 'text-[var(--danger)]' : 'text-[var(--ink-muted)]'}`}>
          {length.text}
        </div>
      )}
    </div>
  );
}
