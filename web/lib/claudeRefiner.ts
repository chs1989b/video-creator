import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { FACE_SWAP_BASE, KEEP_CLAUSE, REASON_FIXES } from './promptBuilder';
import type { ClaudeCaller } from './promptRefine';

// Server-only: the Claude call behind "다듬기". Used only when
// ANTHROPIC_API_KEY is set; without it the route answers with the template.

const MODEL = 'claude-opus-5';

const Refinement = z.object({
  prompt: z.string(),
  explanation_ko: z.string(),
  changed: z.array(z.string()),
  kept: z.array(z.string()),
});

const SYSTEM = `You write prompts for AI video models that edit a short beauty review video
(a person applying a cosmetic product while talking to the camera). The user writes a rough
request, usually in Korean. Return a precise English prompt the model will follow.

Stages:
- face: the person is replaced with a reference photo (and optionally a product photo).
  Start from this base prompt and add only what the request and reject reasons need:
  "${FACE_SWAP_BASE}"
  Fixes for reject reasons: ${JSON.stringify(REASON_FIXES)}
- restyle: change outfit and/or background only.
- edit: final adjustment such as lighting, colour tone or sharpness.

For restyle and edit, say what to change first, then end with exactly:
"${KEEP_CLAUSE}"

Rules: English only in "prompt". One to four short sentences. Never add changes the user
did not ask for. Do not describe a real, named person. "explanation_ko" is one Korean
sentence for the user about what the prompt changes and keeps. "changed" lists the changes
in Korean as "항목: 값"; "kept" lists what stays the same, in Korean.`;

export function createClaudeCaller(apiKey: string): ClaudeCaller {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return async ({ stage, request, rejectReasons }) => {
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(Refinement) },
      messages: [{
        role: 'user',
        content: JSON.stringify({ stage, request, reject_reasons: rejectReasons ?? [] }),
      }],
    });
    if (message.stop_reason === 'refusal') return null;
    return message.parsed_output ?? null;
  };
}
