import { REASON_FIXES, buildTemplatePrompt, type RefineInput, type RefineResult, type RefineStage } from './promptBuilder';

// Turns a rough request into a prompt the video models follow. Claude does it
// when a caller is configured; otherwise, or when Claude refuses or fails, the
// template builder does, and the user is told which one answered.

export type ClaudeRefinement = Omit<RefineResult, 'source' | 'notice'>;
/** Returns null when Claude declines to answer. */
export type ClaudeCaller = (input: RefineInput) => Promise<ClaudeRefinement | null>;

export const MAX_REQUEST_LENGTH = 500;
const STAGES: RefineStage[] = ['face', 'restyle', 'edit'];

export class RefineInputError extends Error {}

export function parseRefineInput(body: unknown): RefineInput {
  const { stage, request, rejectReasons } = (body ?? {}) as Record<string, unknown>;
  if (!STAGES.includes(stage as RefineStage)) throw new RefineInputError(`알 수 없는 단계: ${String(stage)}`);
  const text = typeof request === 'string' ? request.trim() : '';
  if (text.length > MAX_REQUEST_LENGTH) throw new RefineInputError(`요청은 ${MAX_REQUEST_LENGTH}자 이내로 적어 주세요.`);
  const reasons = Array.isArray(rejectReasons)
    ? rejectReasons.filter((r): r is string => typeof r === 'string' && r in REASON_FIXES)
    : [];
  if (!text && !(stage === 'face' && reasons.length > 0)) throw new RefineInputError('다듬을 내용을 입력해 주세요.');
  return { stage: stage as RefineStage, request: text, rejectReasons: reasons };
}

const FALLBACK_NOTICE = 'Claude가 답하지 않아 간단 변환으로 만들었습니다.';

export async function refinePrompt(
  input: RefineInput,
  { callClaude }: { callClaude?: ClaudeCaller } = {},
): Promise<RefineResult> {
  if (!callClaude) return buildTemplatePrompt(input);
  let answer: ClaudeRefinement | null = null;
  try {
    answer = await callClaude(input);
  } catch (error) {
    console.error('prompt refine: Claude call failed', error);
  }
  if (answer) return { ...answer, source: 'claude' };
  const fallback = buildTemplatePrompt(input);
  return { ...fallback, notice: [FALLBACK_NOTICE, fallback.notice].filter(Boolean).join(' ') };
}
