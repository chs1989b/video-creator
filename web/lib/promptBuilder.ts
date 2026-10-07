// Template prompt builder: the free fallback when no Claude API key is set (or
// the call fails). It cannot translate free Korean, so it recognises common
// words, builds the tested "change this + keep that" structure, and reports
// anything it did not understand instead of sending Korean to the model.

export type RefineStage = 'face' | 'restyle' | 'edit';

export type RefineResult = {
  /** English prompt to send to Higgsfield. */
  prompt: string;
  /** What the prompt does, in Korean, for the user to check. */
  explanation_ko: string;
  changed: string[];
  kept: string[];
  source: 'claude' | 'template';
  /** Shown to the user when something could not be handled. */
  notice?: string;
};

export type RefineInput = { stage: RefineStage; request: string; rejectReasons?: string[] };

/** Same wording as the worker's FACE_SWAP_PROMPT. */
export const FACE_SWAP_BASE =
  'Replace the person in the video with the person from the reference image. '
  + 'Keep the original motion, framing, lighting, and background unchanged.';

export const KEEP_CLAUSE =
  'Keep the face, hair, the product in the hand, the motion and the framing exactly the same.';

const KEPT_KO = ['얼굴', '머리', '손에 든 제품', '동작', '구도'];

export const REASON_FIXES: Record<string, string> = {
  얼굴: 'Match the reference face closely: face shape, eyes, nose and skin tone.',
  제품: 'Keep the product fully visible in the hand, at the same size and angle as in the reference image.',
  동작: 'Follow the original hand and head movements exactly.',
  배경: 'Do not change the background or the lighting.',
};

type Word = [korean: string[], english: string];

const COLORS: Word[] = [
  [['베이지'], 'beige'], [['화이트', '흰', '하얀'], 'white'], [['블랙', '검정', '검은'], 'black'],
  [['네이비', '남색'], 'navy'], [['그레이', '회색'], 'grey'], [['레드', '빨간'], 'red'],
  [['블루', '파란'], 'blue'], [['핑크', '분홍'], 'pink'], [['그린', '초록'], 'green'],
];
const MATERIALS: Word[] = [[['린넨'], 'linen'], [['데님', '청'], 'denim'], [['실크'], 'silk']];
const OUTFITS: Word[] = [
  [['셔츠'], 'shirt'], [['니트'], 'knit sweater'], [['원피스'], 'dress'], [['운동복'], 'athletic zip-up jacket'],
  [['정장'], 'tailored suit'], [['재킷', '자켓'], 'jacket'], [['블라우스'], 'blouse'], [['티셔츠'], 't-shirt'],
];
const PLACES: Word[] = [
  [['스튜디오'], 'studio'], [['욕실', '화장실'], 'bathroom vanity'], [['침실'], 'bedroom'], [['카페'], 'cafe'],
  [['야외', '공원'], 'outdoor park in daylight'], [['거실'], 'living room'], [['주방', '부엌'], 'kitchen'],
];
const LIGHT: Array<[string, string, string]> = [
  ['따뜻', 'warmer', '따뜻하게'], ['차갑', 'cooler', '차갑게'], ['시원', 'cooler', '시원하게'],
  ['밝', 'brighter', '밝게'], ['어둡', 'darker', '어둡게'], ['부드럽', 'softer', '부드럽게'], ['선명', 'sharper', '선명하게'],
];

const HANGUL = /[가-힣]/;

function find(clause: string, words: Word[]): Array<{ ko: string; en: string; at: number }> {
  const hits: Array<{ ko: string; en: string; at: number }> = [];
  for (const [kos, en] of words) {
    for (const ko of kos) {
      const at = clause.indexOf(ko);
      if (at >= 0) { hits.push({ ko, en, at }); break; }
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

const joinEnglish = (parts: string[]) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

function restyle(request: string) {
  const sentences: string[] = [];
  const changed: string[] = [];
  const unknown: string[] = [];
  for (const raw of request.split(/[,，、.\n]|그리고/)) {
    const clause = raw.trim();
    if (!clause) continue;
    const colors = find(clause, COLORS);
    const materials = find(clause, MATERIALS);
    const outfit = find(clause, OUTFITS)[0];
    const place = find(clause, PLACES)[0];
    const label = (head: { ko: string }) => [...colors, ...materials].map((w) => w.ko).concat(head.ko).join(' ');
    if (outfit) {
      const desc = [...colors, ...materials].map((w) => w.en).concat(outfit.en).join(' ');
      sentences.push(`Change the outfit to a ${desc}.`);
      changed.push(`의상: ${label(outfit)}`);
    } else if (place) {
      const white = colors.some((c) => c.en === 'white');
      const desc = place.en === 'studio' && white ? 'clean white studio' : [...colors.map((c) => c.en), place.en].join(' ');
      sentences.push(`Change the background to a ${desc}.`);
      changed.push(`배경: ${label(place)}`);
    } else {
      unknown.push(clause);
    }
  }
  return { sentences, changed, unknown };
}

function lighting(request: string) {
  const hits = LIGHT.filter(([ko]) => request.includes(ko));
  const unique = hits.filter(([, en], i) => hits.findIndex(([, e]) => e === en) === i);
  if (unique.length === 0) return { sentences: [], changed: [], unknown: [request.trim()] };
  return {
    sentences: [`Make the lighting ${joinEnglish(unique.map(([, en]) => en))}.`],
    changed: [`조명: ${unique.map(([, , ko]) => ko).join(', ')}`],
    unknown: [],
  };
}

export function buildTemplatePrompt({ stage, request, rejectReasons = [] }: RefineInput): RefineResult {
  const text = request.trim();
  const english = text && !HANGUL.test(text);
  let sentences: string[] = [];
  let changed: string[] = [];
  let unknown: string[] = [];

  if (stage === 'face') {
    sentences = [FACE_SWAP_BASE, ...rejectReasons.map((r) => REASON_FIXES[r]).filter(Boolean)];
    changed = rejectReasons.filter((r) => REASON_FIXES[r]).map((r) => `보완: ${r}`);
    if (english) sentences.push(text);
    else if (text) unknown = [text];
  } else if (english) {
    sentences = [text, KEEP_CLAUSE];
  } else {
    ({ sentences, changed, unknown } = stage === 'restyle' ? restyle(text) : lighting(text));
    sentences.push(KEEP_CLAUSE);
  }

  const kept = stage === 'face' ? ['동작', '구도', '조명', '배경'] : KEPT_KO;
  const result: RefineResult = {
    prompt: sentences.join(' '),
    explanation_ko: changed.length
      ? `바꾸는 것 — ${changed.join(', ')}. 그대로 두는 것 — ${kept.join('·')}.`
      : '알아들은 변경이 없어 그대로 둘 것만 적었습니다.',
    changed,
    kept,
    source: 'template',
  };
  if (unknown.length) {
    result.notice = `간단 변환이 알아듣지 못한 표현: "${unknown.join('", "')}". 영어로 직접 고치거나, Claude API 키를 설정하면 자연스럽게 다듬어 줍니다.`;
  }
  return result;
}
