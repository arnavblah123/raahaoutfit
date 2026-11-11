// Runs Marqo-FashionSigLIP in the guest's browser (transformers.js, WebAssembly).
// The photo it embeds is the guest's own cropped image, loaded with her own cookie from this site.
let ready;
async function load(model, dtype) {
  const t = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2');
  const [processor, vision] = await Promise.all([
    t.AutoProcessor.from_pretrained(model),
    t.SiglipVisionModel.from_pretrained(model, { dtype }),
  ]);
  return { t, processor, vision };
}
self.onmessage = async (e) => {
  const { id, url, model, dtype } = e.data;
  try {
    ready ??= load(model, dtype);
    const { t, processor, vision } = await ready;
    const image = await t.RawImage.fromURL(url);
    const out = await vision(await processor(image));
    const tensor = out.image_embeds ?? out.pooler_output;
    self.postMessage({ id, embedding: Array.from(tensor.data).slice(0, 768) });
  } catch (err) {
    ready = undefined;
    self.postMessage({ id, error: String(err) });
  }
};
