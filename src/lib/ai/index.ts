/**
 * The only module that talks to a model provider. Model names and keys come from
 * environment variables, so models can be swapped without touching the pipeline.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Vocab } from '../vocab';
import { JUDGE_SYSTEM, PROMPT_VERSION, VOCAB_SYSTEM, readSystem } from './prompts';

export { PROMPT_VERSION };
export const models = {
  get read() { return process.env.AI_READ_MODEL || 'claude-haiku-5-5'; },
  get judge() { return process.env.AI_JUDGE_MODEL || 'claude-sonnet-5-5'; },
  get vocab() { return process.env.AI_VOCAB_MODEL || process.env.AI_READ_MODEL || 'claude-haiku-5-5'; },
};

export type Confidence = 'high' | 'medium' | 'low';
export type Verdict = 'same_outfit' | 'same_design_diff_colour' | 'similar_look' | 'no_clash';
export type Usage = { step: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number };
export class AiError extends Error {
  constructor(message: string, public kind: 'refusal' | 'truncated' | 'invalid' | 'provider') { super(message); }
}

// USD per million tokens [input, output]. Override with AI_PRICES.
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};
export function costOf(model: string, input: number, output: number) {
  let table = PRICES;
  if (process.env.AI_PRICES) {
    try { table = { ...PRICES, ...JSON.parse(process.env.AI_PRICES) }; } catch { /* keep defaults */ }
  }
  const [i, o] = table[model] ?? [0, 0];
  return (input * i + output * o) / 1_000_000;
}

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

type Block = Anthropic.ContentBlockParam;
const image = (jpeg: Buffer): Block => ({
  type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') },
});
const text = (t: string): Block => ({ type: 'text', text: t });

async function callJson<T>(opts: {
  step: string; model: string; system: string; content: Block[]; schema: Record<string, unknown>;
  effort?: string; maxTokens?: number;
}): Promise<{ data: T; usage: Usage }> {
  const effort = opts.effort && opts.effort !== 'none' ? { effort: opts.effort as any } : {};
  let res: Anthropic.Message;
  try {
    res = await client().messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.content }],
      output_config: { ...effort, format: { type: 'json_schema', schema: opts.schema } },
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new AiError(`${opts.step}: ${e.status} ${e.message}`, 'provider');
    throw e;
  }
  const input = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
  const usage: Usage = {
    step: opts.step, model: opts.model, input_tokens: input, output_tokens: res.usage.output_tokens,
    cost_usd: costOf(opts.model, input, res.usage.output_tokens),
  };
  if (res.stop_reason === 'refusal') throw Object.assign(new AiError(`${opts.step}: the model declined`, 'refusal'), { usage });
  if (res.stop_reason === 'max_tokens') throw Object.assign(new AiError(`${opts.step}: output was cut off`, 'truncated'), { usage });
  const raw = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  try {
    return { data: JSON.parse(raw) as T, usage };
  } catch {
    throw Object.assign(new AiError(`${opts.step}: not valid JSON`, 'invalid'), { usage });
  }
}

const obj = (properties: Record<string, unknown>) =>
  ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const CONF = { type: 'string', enum: ['high', 'medium', 'low'] };

// ------------------------------------------------------------------ Step 1: Read
export type ReadOutput = {
  not_an_outfit: boolean;
  not_an_outfit_reason: string;
  attributes: { group: string; values: string[]; confidence: Confidence }[];
  proposed_new_values: { group: string; value: string }[];
  photos: { bbox: { x: number; y: number; w: number; h: number }; face_visible: boolean }[];
};

export async function readOutfit(jpegs: Buffer[], vocab: Vocab, hint?: string) {
  const keys = vocab.groups.map((g) => g.key);
  const schema = obj({
    not_an_outfit: { type: 'boolean' },
    not_an_outfit_reason: { type: 'string' },
    attributes: {
      type: 'array',
      items: obj({ group: { type: 'string', enum: keys }, values: { type: 'array', items: { type: 'string' } }, confidence: CONF }),
    },
    proposed_new_values: { type: 'array', items: obj({ group: { type: 'string', enum: keys }, value: { type: 'string' } }) },
    photos: {
      type: 'array',
      items: obj({
        bbox: obj({ x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }),
        face_visible: { type: 'boolean' },
      }),
    },
  });
  const content: Block[] = [];
  jpegs.forEach((j, i) => { content.push(text(`Photo ${i + 1}:`), image(j)); });
  content.push(text(`${hint ? `Listing text (may help, may be wrong): ${hint}\n` : ''}Return one entry in "photos" per photo, in order, and one entry in "attributes" for every group.`));
  return callJson<ReadOutput>({
    step: 'read', model: models.read, system: readSystem(vocab), content, schema,
    effort: process.env.AI_READ_EFFORT || 'low', maxTokens: 6000,
  });
}

// ------------------------------------------------------------------ Step 3: Judge
export type JudgeSide = { photos: Buffer[]; attributes: Record<string, string[]> };
export type JudgeExample = { a: Record<string, string[]>; b: Record<string, string[]>; label: string };
export type JudgeOutput = {
  verdict: Verdict; confidence: Confidence; reason: string;
  missing_evidence: string; limiting_side: 'A' | 'B' | 'both' | 'none';
};

export async function judgePair(a: JudgeSide, b: JudgeSide, examples: JudgeExample[] = []) {
  const schema = obj({
    verdict: { type: 'string', enum: ['same_outfit', 'same_design_diff_colour', 'similar_look', 'no_clash'] },
    confidence: CONF,
    reason: { type: 'string' },
    missing_evidence: { type: 'string' },
    limiting_side: { type: 'string', enum: ['A', 'B', 'both', 'none'] },
  });
  const side = (name: string, s: JudgeSide): Block[] => [
    text(`OUTFIT ${name}. Confirmed attributes: ${JSON.stringify(s.attributes)}\nPhotos of outfit ${name}:`),
    ...s.photos.map(image),
  ];
  const content: Block[] = [];
  if (examples.length) {
    content.push(text('Earlier cases decided by a human reviewer:\n' + examples.map((e, i) =>
      `Case ${i + 1}: A ${JSON.stringify(e.a)} / B ${JSON.stringify(e.b)} -> ${e.label}`).join('\n')));
  }
  content.push(...side('A', a), ...side('B', b), text('Compare outfit A with outfit B.'));
  return callJson<JudgeOutput>({
    step: 'judge', model: models.judge, system: JUDGE_SYSTEM, content, schema,
    effort: process.env.AI_JUDGE_EFFORT || 'medium', maxTokens: 8000,
  });
}

// ------------------------------------------------------------------ Vocabulary merge
export async function mergeVocabulary(groupLabel: string, existing: string[], pending: string[]) {
  const schema = obj({
    merges: { type: 'array', items: obj({ pending: { type: 'string' }, same_as: { type: 'string' } }) },
  });
  return callJson<{ merges: { pending: string; same_as: string }[] }>({
    step: 'vocab_merge', model: models.vocab, system: VOCAB_SYSTEM, schema, effort: 'low', maxTokens: 4000,
    content: [text(`List: ${groupLabel}\nExisting values: ${existing.join(', ')}\nPending values: ${pending.join(', ')}\nReturn one entry per pending value.`)],
  });
}
