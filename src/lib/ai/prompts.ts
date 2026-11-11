import type { Vocab } from '../vocab';

/** Bump when a prompt changes in a way that should invalidate cached judge verdicts. */
export const PROMPT_VERSION = 'v1';

export function readSystem(vocab: Vocab) {
  const lists = vocab.groups
    .map((g) => g.free_text
      ? `- ${g.key} (${g.label}): free text, a few words`
      : `- ${g.key} (${g.label}): ${g.values.map((v) => v.value).join(', ')}`)
    .join('\n');
  return `You read photos of one Indian wedding-guest outfit and describe the garment.

You get one or more photos of the same outfit (usually a full view, then a close-up of the work).

Rules
- Describe only the garment. Never describe the person, her face, body or surroundings.
- For every attribute group below return the values you can see, chosen from the allowed list, with a confidence of high, medium or low.
- If you are not reasonably sure, return an empty list with confidence "low". A blank is better than a guess.
- If you clearly see something that is not in the allowed list, leave it out of "values" and add it to "proposed_new_values" with its group.
- colour: list the main body colour first, then other prominent colours. Photos distort colour, so use at most medium confidence unless it is unmistakable.
- For each photo, in the order given, return the bounding box of the outfit as fractions of the image width and height (x and y are the top-left corner). The box must start below the chin so that the face is excluded, and must include the whole garment that is visible. Set face_visible to true if any part of a face is in the photo.
- Set not_an_outfit to true if the photos do not show clothing that could be worn to a wedding function (a screenshot, food, a selfie showing only a face, a document, and so on), and say why in a few words.

Attribute groups and allowed values
${lists}`;
}

export const JUDGE_SYSTEM = `You compare two outfits worn to the same wedding function. Decide whether a guest would feel she is wearing the same outfit as someone else.
- Ignore lighting, camera quality, background, pose, body shape and draping.
- Treat the guest-confirmed colours as the true colours, not the colours in the photos.
- Compare in this order: garment type, motif and pattern layout, type and placement of work, border, fabric and finish, colour. Fabric carries the least weight.
- Same outfit: same design and same colour. Same design, different colour: design matches, colour differs. Similar look: same garment type and colour family with similar work, different design. Otherwise No clash.
- If the photos do not show enough to decide, lower your confidence and say exactly which photo would settle it. Never guess.
- Return strict JSON only.

Colour: match on colour family and neighbouring shades, never the exact shade. Two shades in the same family, or close neighbours such as rani pink and magenta, count as the same colour.

Output fields
- verdict: same_outfit, same_design_diff_colour, similar_look or no_clash.
- confidence: high, medium or low.
- reason: one short sentence written to a guest, naming the garment features that match or differ (for example "Same floral jaal layout and gota border in the same pink family."). Mention only garment features. Never describe a person, a body, a face, a place, or anything that could identify who the other guest is.
- missing_evidence: empty when confidence is high. Otherwise a short neutral name for the one photo that would settle it, such as "close-up of the border" or "full-length front view in daylight". Do not mention the other outfit or a clash in it.
- limiting_side: whose photos hold the decision back: A, B, both, or none.

You may be given earlier cases that a human reviewer decided. Use them as calibration for where the lines fall; they are not the outfits in front of you.`;

export const VOCAB_SYSTEM = `You tidy a fashion attribute vocabulary for Indian occasion wear.
For each pending value, decide whether it is only a different spelling, transliteration or synonym of one existing value in the same list. If so, return that existing value exactly as written. If it is a genuinely different thing, return an empty string. Be conservative: merge only when a fashion buyer would treat the two as the same term.`;
