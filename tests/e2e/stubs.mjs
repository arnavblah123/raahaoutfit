// Local stand-ins for the two outside services, so the whole app can be exercised without keys:
//   :4801  Anthropic Messages API (Read and Judge answers are canned; POST /_set changes them)
//   :4802  embedding server (vector = the photo's mean colour, so similar photos get similar vectors)
//   :4803  Google sign-in (always signs in as state.googleUser)
//   :4804  SMS sender for one-time codes (remembers the last code per number in state.otp)
import { createServer } from 'http';
import sharp from 'sharp';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

const state = {
  notOutfit: false,
  googleUser: { sub: 'g-1', email: 'zoya@example.com', given_name: 'Zoya' },
  judge: { verdict: 'same_outfit', confidence: 'high', reason: 'Same floral jaal layout and gota border in the same red family.', missing_evidence: '', limiting_side: 'none' },
  calls: { read: 0, judge: 0, vocab: 0 },
  otp: {},
};
const body = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

createServer(async (req, res) => {
  if (req.url === '/_set') { Object.assign(state, JSON.parse((await body(req)).toString())); return send(res, 200, state); }
  if (req.url === '/_state') return send(res, 200, state);
  const reqBody = JSON.parse((await body(req)).toString());
  const system = typeof reqBody.system === 'string' ? reqBody.system : JSON.stringify(reqBody.system);
  let out;
  if (system.startsWith('You read photos')) {
    state.calls.read++;
    const images = reqBody.messages[0].content.filter((b) => b.type === 'image').length;
    const groups = reqBody.output_config.format.schema.properties.attributes.items.properties.group.enum;
    const known = {
      garment_type: [['lehenga choli'], 'high'], colour: [['red'], 'medium'], embellishment: [['zari', 'Gota Patti', 'tilla work'], 'medium'],
      motif: [['floral'], 'high'], fabric: [['velvet'], 'low'], silhouette: [['A-line flare'], 'medium'],
    };
    out = {
      not_an_outfit: state.notOutfit, not_an_outfit_reason: state.notOutfit ? 'a screenshot' : '',
      attributes: groups.map((g) => ({ group: g, values: known[g]?.[0] ?? [], confidence: known[g]?.[1] ?? 'low' })),
      proposed_new_values: [{ group: 'print_weave', value: 'shibori' }],
      photos: Array.from({ length: images }, () => ({ bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.7 }, face_visible: true })),
    };
  } else if (system.startsWith('You compare two outfits')) {
    state.calls.judge++;
    out = state.judge;
  } else {
    state.calls.vocab++;
    out = { merges: [] };
  }
  send(res, 200, {
    id: 'msg_stub', type: 'message', role: 'assistant', model: reqBody.model, stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 2000, output_tokens: 300 },
  });
}).listen(4801);

createServer(async (req, res) => {
  const { channels } = await sharp(await body(req)).stats();
  const v = Array(768).fill(0);
  channels.slice(0, 3).forEach((c, i) => { v[i] = c.mean / 255 + 0.001; });
  send(res, 200, { embedding: v });
}).listen(4802);
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'stub', alg: 'RS256', use: 'sig' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:4803');
  if (url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
  if (url.pathname === '/auth') {
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'stub-code'); back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: back.toString() }); return res.end();
  }
  if (url.pathname === '/token') {
    const form = new URLSearchParams((await body(req)).toString());
    const id_token = await new SignJWT({ ...state.googleUser, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'stub' }).setIssuer('http://localhost:4803').setAudience(form.get('client_id'))
      .setSubject(state.googleUser.sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    return send(res, 200, { id_token, access_token: 'x' });
  }
  send(res, 404, {});
}).listen(4803);
createServer(async (req, res) => {
  const { phone, code } = JSON.parse((await body(req)).toString());
  state.otp[phone] = code;
  send(res, 200, { ok: true });
}).listen(4804);
console.log('stubs ready');
