'use client';

import { useState } from 'react';

/**
 * "내 Higgsfield 연결" — a preview of letting each user bring their own
 * Higgsfield API key. NOT wired up: the values live only in this component's
 * state, are never stored or sent anywhere, and are cleared on close. Real
 * keys may be typed here, so keep it that way until the feature is built.
 */
export function HiggsfieldConnect() {
  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const close = () => {
    setKeyId('');
    setSecret('');
    setNotice(null);
    setOpen(false);
  };

  const field = 'mt-1 w-full rounded-md border border-[var(--card-border)] bg-[var(--well)] px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--text-edge)] focus:outline-none';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-dashed border-[var(--text-edge)] bg-[var(--card)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-[var(--well)]"
      >
        내 Higgsfield 연결 <span className="ml-1 text-[10.5px] text-[var(--text-edge)]">준비 중</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="내 Higgsfield 연결"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-[14px] border border-[var(--card-border-strong)] bg-[var(--card)] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--ink)]">내 Higgsfield 연결</h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-muted)]">
                  내 Higgsfield API 키를 연결해 <b className="text-[var(--ink)]">내 API 잔액으로</b> 영상을 만드는 기능입니다.
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--text-edge)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--text-edge)]">준비 중</span>
            </div>

            <div role="note" className="mt-4 rounded-md border border-[var(--text-edge)] bg-[var(--well)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--ink)]">
              이 버전에서는 연결되지 않습니다. 입력한 키는 <b>저장하거나 전송하지 않고</b>, 창을 닫으면 지워집니다.
              지금 영상은 계속 이 서비스의 Higgsfield 계정(또는 테스트 모드)으로 만들어집니다.
            </div>

            <div className="mt-5 grid gap-3">
              <label className="block text-[12.5px] text-[var(--ink-muted)]">
                API 키 ID
                <input value={keyId} onChange={(e) => setKeyId(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Higgsfield 콘솔에서 발급" className={field} />
              </label>
              <label className="block text-[12.5px] text-[var(--ink-muted)]">
                API 시크릿
                <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} placeholder="한 번만 표시되는 값" className={field} />
              </label>
            </div>
            {notice && <div role="status" className="mt-3 text-[12.5px] text-[var(--ink)]">{notice}</div>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setKeyId(''); setSecret(''); setNotice('아직 지원하지 않습니다. 입력한 키는 저장하지 않고 지웠습니다.'); }}
                className="flex-1 rounded-md border border-[var(--card-border-strong)] py-2 text-[13px] text-[var(--ink)] hover:border-[var(--text-edge)]"
              >
                연결하기 (준비 중)
              </button>
              <button type="button" onClick={close} className="flex-1 rounded-md border border-[var(--card-border-strong)] py-2 text-[13px] text-[var(--ink)]">
                닫기
              </button>
            </div>

            <h3 className="mt-6 text-[13px] font-medium text-[var(--ink)]">연결하면 무엇이 달라지나</h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] leading-relaxed">
              <div className="rounded-md border border-[var(--card-border)] p-3">
                <div className="font-medium text-[var(--ink)]">지금</div>
                <ul className="mt-1 list-disc pl-4 text-[var(--ink-muted)]">
                  <li>서비스의 Higgsfield 계정으로 생성</li>
                  <li>웹 요금제(Plus) <b>크레딧</b>에서 차감</li>
                  <li>비용은 서비스가 부담</li>
                </ul>
              </div>
              <div className="rounded-md border border-[var(--text-edge)] p-3">
                <div className="font-medium text-[var(--ink)]">연결 후 (예정)</div>
                <ul className="mt-1 list-disc pl-4 text-[var(--ink-muted)]">
                  <li>내 API 키로 생성</li>
                  <li>내 <b>API 달러 잔액</b>에서 차감 (쓴 만큼)</li>
                  <li>비용은 내가 부담</li>
                </ul>
              </div>
            </div>
            <ul className="mt-3 list-disc pl-4 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">
              <li>Higgsfield API는 웹 요금제와 <b>별개 상품</b>입니다. 요금제 크레딧으로는 쓸 수 없고, 달러 잔액을 따로 충전합니다.</li>
              <li>지금 인물 교체에 쓰는 모델(Ad Multiplier)이 API에서도 제공되는지 확인하고 있습니다.</li>
            </ul>

            <h3 className="mt-5 text-[13px] font-medium text-[var(--ink)]">연결된 모습 <span className="ml-1 text-[11px] font-normal text-[var(--ink-faint)]">예시 화면 · 실제 값 아님</span></h3>
            <div className="mt-2 rounded-md border border-dashed border-[var(--card-border-strong)] bg-[var(--well)] p-3 text-[12px] text-[var(--ink-muted)]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[var(--ink)]"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--media)]" />Higgsfield API 연결됨</span>
                <span className="font-mono">hf_key_••••3f9a</span>
              </div>
              <div className="mt-1.5 flex justify-between"><span>API 잔액</span><span className="text-[var(--ink)]">$12.40</span></div>
              <div className="flex justify-between"><span>30초 영상 예상 (Seedance 2.5 기준)</span><span className="text-[var(--ink)]">$4.32 ~ $6.18</span></div>
            </div>
            <p className="mt-3 text-[11px] text-[var(--ink-faint)]">
              API 안내: <a href="https://higgsfield.ai/higgsfield-api" target="_blank" rel="noreferrer" className="underline">higgsfield.ai/higgsfield-api</a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
