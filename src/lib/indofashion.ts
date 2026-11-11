/**
 * IndoFashion open dataset (Rajput and Aneja, CVPR Workshops 2021). Internal training and
 * testing only: rows are stored with source = 'indofashion', for which guest_visible is always false.
 *
 * The 15 dataset classes are: Saree, Women Kurta, Leggings & Salwar, Palazzo, Lehenga, Dupatta,
 * Blouse, Gown, Dhoti Pants, Petticoats, Women Mojari, Men Kurta, Nehru Jacket, Sherwani, Men Mojari.
 * The pilot uses the women's garment classes; men's classes and accessories are skipped.
 */
export const INDOFASHION_CLASSES: Record<string, string[] | null> = {
  saree: ['saree', 'drape saree', 'pre-draped saree', 'half saree'],
  women_kurta: ['kurta set', 'anarkali', 'salwar kameez', 'churidar set', 'angrakha', 'kaftan', 'palazzo set', 'sharara set'],
  leggings_and_salwar: ['salwar kameez', 'churidar set', 'kurta set', 'farshi salwar set'],
  palazzo: ['palazzo set', 'sharara set', 'gharara set', 'co-ord set'],
  lehenga: ['lehenga choli', 'bridal lehenga', 'jacket lehenga', 'crush lehenga', 'half saree'],
  gown: ['floor-length gown', 'indo-western gown', 'anarkali'],
  dhoti_pants: ['dhoti set'],
  blouse: null,       // parts of an outfit: no garment type in our list, so no mismatch check
  petticoats: null,
};

/** Map whatever spelling the dataset files use to one of our keys. null = skipped class. */
export function canonicalClass(raw: string): string | null {
  const l = raw.toLowerCase().replace(/[^a-z]+/g, '_');
  if (/mojari|dupatta|nehru|sherwani/.test(l)) return null;                 // accessories and men's
  if (/(^|_)men(s)?(_|$)/.test(l)) return null;                             // "men_kurta", "kurta_men"
  if (l.includes('saree')) return 'saree';
  if (l.includes('lehenga')) return 'lehenga';
  if (l.includes('legging') || l.includes('salwar')) return 'leggings_and_salwar';
  if (l.includes('palazzo')) return 'palazzo';
  if (l.includes('gown')) return 'gown';
  if (l.includes('dhoti')) return 'dhoti_pants';
  if (l.includes('blouse')) return 'blouse';
  if (l.includes('petticoat')) return 'petticoats';
  if (l.includes('kurta')) return 'women_kurta';
  return null;
}

/** null = cannot be compared (no mapping, or the AI left garment type blank). */
export function labelMismatch(datasetLabel: string, aiGarmentTypes: string[]): boolean | null {
  const allowed = INDOFASHION_CLASSES[canonicalClass(datasetLabel) ?? ''];
  if (!allowed || !aiGarmentTypes.length) return null;
  return !aiGarmentTypes.some((g) => allowed.includes(g.toLowerCase()));
}
