'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? '로그인하지 못했습니다.');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('웹 서버에 연결할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-md border border-[var(--card-border)] bg-[var(--well)] px-3 py-2 text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--media)] focus:outline-none';

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-[14px] border border-[var(--card-border)] bg-[var(--card)] p-7 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
        <div className="text-[12px] font-medium tracking-wide text-[var(--media)]">숏폼 리뷰 영상 서비스</div>
        <h1 className="mt-1 text-[20px] font-semibold text-[var(--ink)]">영상 제작 캔버스 로그인</h1>
        <p className="mt-1 text-[12.5px] text-[var(--ink-muted)]">시연용 데모 계정으로 로그인합니다.</p>
        <label className="mt-6 block text-[12.5px] text-[var(--ink-muted)]" htmlFor="username">아이디</label>
        <input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className={`mt-1 ${field}`} placeholder="예: chris" required />
        <label className="mt-4 block text-[12.5px] text-[var(--ink-muted)]" htmlFor="password">비밀번호</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`mt-1 ${field}`} required />
        {error && <div role="alert" className="mt-3 rounded-md border border-[var(--danger)] px-3 py-2 text-[12.5px] text-[var(--ink)]">{error}</div>}
        <button type="submit" disabled={busy} className="mt-6 w-full rounded-full border border-[var(--media)] bg-[var(--media)] py-2.5 text-[14px] font-medium text-black transition-opacity disabled:opacity-60">
          {busy ? '확인 중…' : '로그인'}
        </button>
        <p className="mt-4 text-center text-[11.5px] text-[var(--ink-faint)]">로컬 시연 전용 · 외부에 공개하지 않습니다</p>
      </form>
    </main>
  );
}
