import { createClaudeCaller } from '@/lib/claudeRefiner';
import { RefineInputError, parseRefineInput, refinePrompt } from '@/lib/promptRefine';

// POST /api/prompt/refine — { stage, request, rejectReasons? } → RefineResult.
// Runs on the web server so the API key never reaches the browser.

export async function POST(request: Request) {
  let input;
  try {
    input = parseRefineInput(await request.json());
  } catch (error) {
    const message = error instanceof RefineInputError ? error.message : '요청 형식이 올바르지 않습니다.';
    return Response.json({ error: message }, { status: 400 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const result = await refinePrompt(input, { callClaude: apiKey ? createClaudeCaller(apiKey) : undefined });
  return Response.json(result);
}
