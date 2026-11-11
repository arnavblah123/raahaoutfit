/**
 * IndoFashion open dataset (Rajput and Aneja, 2021). Internal training and testing only:
 * rows are stored with source = 'indofashion', for which guest_visible is always false.
 *
 * Women's garment classes used for the pilot, and the vocabulary garment types that count as
 * agreeing with each dataset label. Men's classes and accessories are skipped.
 */
export const INDOFASHION_CLASSES: Record<string, string[] | null> = {
  saree: ['saree', 'drape saree', 'pre-draped saree', 'half saree'],
  women_kurta: ['kurta set', 'anarkali', 'salwar kameez', 'churidar set', 'angrakha', 'kaftan', 'palazzo set', 'sharara set'],
  leggings_and_salwar: ['salwar kameez', 'churidar set', 'kurta set', 'farshi salwar set'],
  palazzos: ['palazzo set', 'sharara set', 'gharara set', 'co-ord set'],
  lehenga: ['lehenga choli', 'bridal lehenga', 'jacket lehenga', 'crush lehenga', 'half saree'],
  gowns: ['floor-length gown', 'indo-western gown', 'anarkali'],
  dhoti_pants: ['dhoti set'],
  blouse: null,       // a part of an outfit: no garment type in our list, so no mismatch check
  petticoats: null,
};
export const INDOFASHION_SKIPPED = ['dupattas', 'mojaris_women', 'kurta_men', 'nehru_jackets', 'sherwanis', 'mojaris_men'];

/** null = cannot be compared (no mapping, or the AI left garment type blank). */
export function labelMismatch(datasetLabel: string, aiGarmentTypes: string[]): boolean | null {
  const allowed = INDOFASHION_CLASSES[datasetLabel];
  if (!allowed || !aiGarmentTypes.length) return null;
  return !aiGarmentTypes.some((g) => allowed.includes(g.toLowerCase()));
}
