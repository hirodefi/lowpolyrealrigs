// Minimal dependency-free PNG encoder (RGBA8, stored/uncompressed deflate).
// The palette textures are tiny (<= 32x32), so compression is not worth it.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

export function encodePNG(width, height, rgba) {
  // Raw scanlines with filter byte 0.
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);

  // zlib stream of stored deflate blocks (max 65535 bytes each).
  const blocks = Math.ceil(raw.length / 65535) || 1;
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  z[o++] = 0x78; z[o++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const chunk = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535));
    z[o++] = i === blocks - 1 ? 1 : 0;
    z[o++] = chunk.length & 0xff; z[o++] = chunk.length >> 8;
    z[o++] = ~chunk.length & 0xff; z[o++] = (~chunk.length >> 8) & 0xff;
    z.set(chunk, o); o += chunk.length;
  }
  const ad = adler32(raw);
  z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 0xff; z[o++] = (ad >>> 8) & 0xff; z[o++] = ad & 0xff;

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const out = new Uint8Array(8 + chunks.reduce((a, c) => a + c.length, 0));
  out.set(sig, 0);
  let p = 8;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
