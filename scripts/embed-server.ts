/**
 * Tiny embedding server for Marqo-FashionSigLIP on a CPU host (Fly.io, Render, a small VPS, a HF Space).
 *   EMBED_SECRET=... PORT=8080 npm run embed:server
 * Then set EMBED_URL and EMBED_SECRET in the app. POST /embed with image bytes -> { embedding: number[768] }.
 */
import './_env';
import { createServer } from 'http';
import { embedImage } from '../src/lib/embed/server';
import { normalise } from '../src/lib/images';

delete process.env.EMBED_URL;   // this process is the server: always run the model locally
const secret = process.env.EMBED_SECRET;
if (!secret) { console.error('Set EMBED_SECRET'); process.exit(1); }

createServer(async (req, res) => {
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/embed') return send(404, { error: 'Not found' });
  if (req.headers.authorization !== `Bearer ${secret}`) return send(401, { error: 'Unauthorised' });
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 8_000_000) return send(413, { error: 'Too large' }); chunks.push(c); }
  try {
    send(200, { embedding: await embedImage((await normalise(Buffer.concat(chunks))).jpeg) });
  } catch (e: any) { send(400, { error: String(e?.message ?? e) }); }
}).listen(Number(process.env.PORT ?? 8080), () => console.log(`Embedding server on :${process.env.PORT ?? 8080}`));
