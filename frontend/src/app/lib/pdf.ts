// Kutubxonasiz minimal PDF: har bir sahifa — A4 o'lchamdagi JPEG rasm (canvas'dan).
// Matn rasm sifatida chiziladi, shuning uchun o'zbek (oʻ, gʻ) va kirill harflari har qanday
// qurilmada aynan ko'ringanidek chiqadi (PDF shriftlarini joylash shart emas).
const A4_W = 595.28, A4_H = 841.89; // pt

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function canvasesToPdf(pages: HTMLCanvasElement[], quality = 0.9): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); pos += u.length; };
  const obj = (n: number) => { offsets[n] = pos; };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // 1 — Catalog, 2 — Pages; har sahifa uchun: page, image, content (3 ta obyekt)
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1); push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  obj(2); push(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach((c, i) => {
    const pId = 3 + i * 3, imgId = pId + 1, cId = pId + 2;
    const jpg = dataUrlToBytes(c.toDataURL('image/jpeg', quality));
    const content = `q ${A4_W} 0 0 ${A4_H} 0 0 cm /Im0 Do Q`;
    obj(pId); push(`${pId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${cId} 0 R >>\nendobj\n`);
    obj(imgId); push(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    push(jpg); push('\nendstream\nendobj\n');
    obj(cId); push(`${cId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });
  const count = 3 + pages.length * 3;
  const xrefPos = pos;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}
