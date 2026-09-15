const encoder = new TextEncoder();

function bytes(value) {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

function join(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export function dataUrlToBytes(dataUrl) {
  const binary = atob(dataUrl.split(',')[1]);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function createPdf(images, { pageSize = 'a4', margin = 24 } = {}) {
  if (!images.length) throw new Error('至少需要一页');
  const objects = [];
  const add = content => { objects.push(bytes(content)); return objects.length; };
  const catalogId = add('');
  const pagesId = add('');
  const pageIds = [];

  images.forEach((image, index) => {
    const jpg = image.bytes || dataUrlToBytes(image.dataUrl);
    const imageId = add(join([
      bytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`),
      jpg,
      bytes('\nendstream')
    ]));
    const a4 = pageSize === 'a4';
    const landscape = image.width > image.height;
    const pageW = a4 ? (landscape ? 842 : 595) : image.width;
    const pageH = a4 ? (landscape ? 595 : 842) : image.height;
    const scale = Math.min((pageW - margin * 2) / image.width, (pageH - margin * 2) / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    const stream = `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${index} Do Q`;
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${index} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[catalogId - 1] = bytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = bytes(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const output = [bytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0];
  let position = output[0].length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const wrapped = join([bytes(`${index + 1} 0 obj\n`), object, bytes('\nendobj\n')]);
    output.push(wrapped);
    position += wrapped.length;
  });
  const xref = position;
  output.push(bytes(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Blob(output, { type: 'application/pdf' });
}
