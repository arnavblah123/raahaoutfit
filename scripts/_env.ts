/** Load .env.local (or .env) for command-line scripts. Import this first. */
import { existsSync } from 'fs';
for (const f of ['.env.local', '.env']) if (existsSync(f)) { process.loadEnvFile(f); break; }

export function args() {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [k, v] = argv[i].slice(2).split('=');
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return out;
}
export function bar(done: number, total: number, extra = '') {
  const w = 30, f = total ? Math.round((done / total) * w) : 0;
  process.stdout.write(`\r[${'#'.repeat(f)}${'.'.repeat(w - f)}] ${done}/${total} ${extra}   `);
}
export const usd = (n: number) => `$${n.toFixed(4)}`;
