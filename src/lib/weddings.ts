export const FUNCTION_KINDS = ['haldi', 'mehendi', 'sangeet', 'cocktail', 'engagement', 'wedding', 'reception', 'custom'] as const;
export type FunctionKind = (typeof FUNCTION_KINDS)[number];
export const functionName = (f: { kind: string; custom_name?: string | null }) =>
  f.kind === 'custom' ? (f.custom_name || 'Function') : f.kind[0].toUpperCase() + f.kind.slice(1);

export const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function parseFunctions(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 12).map((f: any, i) => ({
    kind: FUNCTION_KINDS.includes(f?.kind) ? (f.kind as FunctionKind) : 'custom',
    custom_name: clean(f?.custom_name, 40) || null,
    sort: i,
  })).filter((f) => f.kind !== 'custom' || f.custom_name);
}

export const VERDICT_LABEL: Record<string, string> = {
  same_outfit: 'Same outfit',
  same_design_diff_colour: 'Same design, different colour',
  similar_look: 'Similar look',
  possible_clash: 'Possible clash',
  no_clash: 'No clash',
};
