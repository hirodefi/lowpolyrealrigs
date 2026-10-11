// Browser-side image loading shared by the app and the tests: decode any image
// the browser supports and scale it to the analysis resolution.

/** Longest side of an analysed view, in pixels. Thin details (heel posts, hair
 *  strands, gaps between arm and torso) survive at this size; cost stays ~ms. */
export const ANALYSIS_PX = 640;

/** ImageBitmap / ImageData-like / Blob -> RGBA ImageData at analysis resolution. */
export async function toAnalysisImage(src, maxPx = ANALYSIS_PX) {
  let bmp = src;
  if (src instanceof Blob) bmp = await createImageBitmap(src);
  else if (src.data && src.width) { // ImageData-like: draw through a canvas
    const c = new OffscreenCanvas(src.width, src.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), 0, 0);
    bmp = c;
  }
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Fetch a URL and return it at analysis resolution. */
export async function loadAnalysisImage(url, maxPx = ANALYSIS_PX) {
  return toAnalysisImage(await (await fetch(url)).blob(), maxPx);
}
