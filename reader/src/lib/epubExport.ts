import JSZip from 'jszip';
import type { BookMeta } from './types';
import { getBookResources, getChapter } from './db';
import { escapeHtml } from './import/builder';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' };

const CSS = `body{font-family:serif;line-height:1.5;margin:0 4%}
h1,h2,h3{line-height:1.25;page-break-after:avoid}
img{max-width:100%;height:auto}
figure{margin:1em 0;text-align:center;page-break-inside:avoid}
figcaption{font-size:.85em;font-style:italic}
p.center{text-align:center}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:.2em .4em}
aside.notes{border-left:3px solid #999;padding-left:.8em;font-size:.9em}`;

/** Package a library book as a standard EPUB 3 file (readable by Kindle, Apple Books, etc.). */
export async function exportEpub(book: BookMeta): Promise<Blob> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/style.css', CSS);

  const resources = await getBookResources(book.id);
  const resPath = new Map<string, { path: string; type: string }>();
  resources.forEach((r, i) => {
    const type = r.blob.type || 'image/jpeg';
    const path = `images/i${i}.${EXT[type] ?? 'bin'}`;
    resPath.set(r.id, { path, type });
    zip.file(`OEBPS/${path}`, r.blob);
  });

  const items: string[] = [];
  const spine: string[] = [];
  const navLis: string[] = [];
  const serializer = new XMLSerializer();
  for (let i = 0; i < book.chapters.length; i++) {
    const html = await getChapter(book.id, i);
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.querySelectorAll('img[data-res]').forEach((img) => {
      const r = resPath.get(img.getAttribute('data-res') || '');
      if (r) img.setAttribute('src', r.path);
      img.removeAttribute('data-res');
    });
    const bodyXml = Array.from(doc.body.childNodes).map((n) => serializer.serializeToString(n)).join('\n');
    const title = escapeHtml(book.chapters[i].title);
    zip.file(`OEBPS/c${i}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>
${bodyXml}
</body></html>`);
    items.push(`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${i}"/>`);
    if (book.chapters[i].toc) navLis.push(`<li><a href="c${i}.xhtml">${title}</a></li>`);
  }
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navLis.join('')}</ol></nav></body></html>`);
  const uid = `urn:uuid:${crypto.randomUUID?.() ?? book.id}`;
  const cover = book.coverResId ? resPath.get(book.coverResId) : undefined;
  const imgItems = [...resPath.entries()].map(([id, r], i) => `<item id="img${i}" href="${r.path}" media-type="${r.type}"${cover && id === book.coverResId ? ' properties="cover-image"' : ''}/>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${escapeHtml(book.title)}</dc:title>
${book.author ? `<dc:creator>${escapeHtml(book.author)}</dc:creator>` : ''}
<dc:language>en</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${items.join('\n')}
${imgItems.join('\n')}
</manifest>
<spine>${spine.join('')}</spine>
</package>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}
