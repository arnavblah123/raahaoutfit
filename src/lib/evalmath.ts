/** Top-k retrieval maths for the evaluation script. Vectors are unit length, so dot = cosine. */
export const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export function topKReport(items: { set: string; file: string; v: number[] }[], k: number) {
  let hit1 = 0, hitK = 0, queries = 0, same = 0, sameN = 0, diff = 0, diffN = 0, minSame = 1;
  const misses: { file: string; nearest: string }[] = [];
  for (const q of items) {
    const others = items.filter((x) => x !== q).map((x) => ({ x, s: dot(q.v, x.v) })).sort((a, b) => b.s - a.s);
    for (const o of others) {
      if (o.x.set === q.set) { same += o.s; sameN++; minSame = Math.min(minSame, o.s); } else { diff += o.s; diffN++; }
    }
    if (!others.some((o) => o.x.set === q.set)) continue;      // a set with one photo cannot be a query
    queries++;
    if (others[0].x.set === q.set) hit1++;
    if (others.slice(0, k).some((o) => o.x.set === q.set)) hitK++; else misses.push({ file: q.file, nearest: others[0].x.file });
  }
  return {
    sets: new Set(items.map((i) => i.set)).size, queries,
    hitAt1: queries ? hit1 / queries : 0, hitAtK: queries ? hitK / queries : 0,
    meanSame: sameN ? same / sameN : 0, meanDifferent: diffN ? diff / diffN : 0, minSame: sameN ? minSame : 0, misses,
  };
}
