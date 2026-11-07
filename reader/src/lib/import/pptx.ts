import JSZip from 'jszip';
import { BookBuilder, escapeHtml, figure, imageSize, mimeFromName, yieldToUI } from './builder';
import { desc, kid, kids, parseXml, readCoreProps, readRels } from './ooxml';

const DISPLAYABLE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

interface Item {
  y: number;
  x: number;
  html: string;
  chars: number;
  title?: string;
}

function offsetOf(el: Element): { x: number; y: number } {
  const off = desc(el, 'off')[0];
  return { x: +(off?.getAttribute('x') || 0), y: +(off?.getAttribute('y') || 0) };
}

function runsHtml(p: Element): string {
  let out = '';
  for (const r of Array.from(p.children)) {
    if (r.localName === 'br') {
      out += '<br>';
      continue;
    }
    if (r.localName !== 'r' && r.localName !== 'fld') continue;
    const t = kid(r, 't')?.textContent ?? '';
    if (!t) continue;
    const rPr = kid(r, 'rPr');
    let s = escapeHtml(t);
    if (rPr?.getAttribute('b') === '1') s = `<strong>${s}</strong>`;
    if (rPr?.getAttribute('i') === '1') s = `<em>${s}</em>`;
    if (rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none') s = `<u>${s}</u>`;
    out += s;
  }
  return out;
}

function textBodyHtml(txBody: Element, isTitle: boolean): { html: string; chars: number; text: string } {
  const paras = kids(txBody, 'p');
  let html = '';
  let chars = 0;
  let text = '';
  let listOpen = 0;
  const closeLists = (to: number) => {
    while (listOpen > to) {
      html += '</ul>';
      listOpen--;
    }
  };
  for (const p of paras) {
    const inner = runsHtml(p);
    const plain = inner.replace(/<[^>]+>/g, '').trim();
    if (!plain) continue;
    chars += plain.length;
    text += (text ? ' ' : '') + plain;
    if (isTitle) continue;
    const pPr = kid(p, 'pPr');
    const lvl = +(pPr?.getAttribute('lvl') || 0);
    const noBullet = pPr && kid(pPr, 'buNone');
    const bulleted = !noBullet && (paras.length > 1 || lvl > 0 || (pPr && (kid(pPr, 'buChar') || kid(pPr, 'buAutoNum'))));
    if (bulleted) {
      closeLists(lvl + 1);
      while (listOpen < lvl + 1) {
        html += '<ul>';
        listOpen++;
      }
      html += `<li>${inner}</li>`;
    } else {
      closeLists(0);
      html += `<p>${inner}</p>`;
    }
  }
  closeLists(0);
  return { html, chars, text };
}

function tableHtml(tbl: Element): { html: string; chars: number } {
  let chars = 0;
  const rows = kids(tbl, 'tr')
    .map((tr, ri) => {
      const cells = kids(tr, 'tc')
        .map((tc) => {
          const body = kid(tc, 'txBody');
          const inner = body ? kids(body, 'p').map(runsHtml).filter(Boolean).join('<br>') : '';
          chars += inner.replace(/<[^>]+>/g, '').length;
          const tag = ri === 0 ? 'th' : 'td';
          const span = tc.getAttribute('gridSpan');
          return tc.getAttribute('hMerge') || tc.getAttribute('vMerge') ? '' : `<${tag}${span ? ` colspan="${+span}"` : ''}>${inner}</${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return { html: `<table><tbody>${rows}</tbody></table>`, chars };
}

async function collect(
  tree: Element,
  rels: Map<string, string>,
  zip: JSZip,
  builder: BookBuilder,
  imgCache: Map<string, { id: string; w: number; h: number } | null>,
  items: Item[],
  base = { x: 0, y: 0 },
) {
  for (const el of Array.from(tree.children)) {
    const name = el.localName;
    if (name === 'grpSp') {
      await collect(el, rels, zip, builder, imgCache, items, offsetOf(el));
      continue;
    }
    const pos = offsetOf(el);
    pos.x += base.x;
    pos.y += base.y;
    if (name === 'sp') {
      const ph = desc(el, 'ph')[0];
      const phType = ph?.getAttribute('type') || '';
      const isTitle = phType === 'title' || phType === 'ctrTitle';
      if (['sldNum', 'dt', 'ftr'].includes(phType)) continue;
      const body = kid(el, 'txBody');
      if (body) {
        const t = textBodyHtml(body, isTitle);
        if (isTitle && t.text) items.push({ ...pos, html: '', chars: t.chars, title: t.text });
        else if (t.html) items.push({ ...pos, html: t.html, chars: t.chars });
      }
      // Shapes filled with a picture.
      const blip = desc(el, 'blip')[0];
      if (blip) await pushImage(blip, pos);
    } else if (name === 'pic') {
      const blip = desc(el, 'blip')[0];
      if (blip) await pushImage(blip, pos);
    } else if (name === 'graphicFrame') {
      const tbl = desc(el, 'tbl')[0];
      if (tbl) items.push({ ...pos, ...tableHtml(tbl) });
    }
  }

  async function pushImage(blip: Element, pos: { x: number; y: number }) {
    const rid = blip.getAttribute('r:embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || '';
    const path = rels.get(rid);
    if (!path || !DISPLAYABLE.test(path)) return;
    let info = imgCache.get(path);
    if (info === undefined) {
      const data = await zip.file(path)?.async('arraybuffer');
      info = null;
      if (data) {
        const blob = new Blob([data], { type: mimeFromName(path) });
        const size = await imageSize(blob);
        if (size && size.width > 24 && size.height > 24) info = { id: builder.addResource(blob, size.width, size.height), w: size.width, h: size.height };
      }
      imgCache.set(path, info);
    }
    if (info) items.push({ ...pos, html: figure(info.id, info.w, info.h), chars: 1 });
  }
}

export async function convertPptx(file: File, builder: BookBuilder, onProgress: (p: number, msg: string) => void) {
  onProgress(0.05, 'Opening presentation…');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const props = await readCoreProps(zip);
  builder.title = props.title || file.name.replace(/\.[^.]+$/, '');
  builder.author = props.author || '';
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXml) throw new Error('This file is not a valid PowerPoint (.pptx) presentation.');
  const presRels = await readRels(zip, 'ppt/presentation.xml');
  const slidePaths = desc(parseXml(presXml), 'sldId')
    .map((s) => presRels.get(s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || ''))
    .filter((p): p is string => !!p);
  const imgCache = new Map<string, { id: string; w: number; h: number } | null>();
  for (let i = 0; i < slidePaths.length; i++) {
    onProgress(0.1 + (0.85 * i) / slidePaths.length, `Converting slide ${i + 1} of ${slidePaths.length}…`);
    const xml = await zip.file(slidePaths[i])?.async('string');
    if (!xml) continue;
    const doc = parseXml(xml);
    const tree = desc(doc, 'spTree')[0];
    if (!tree) continue;
    const rels = await readRels(zip, slidePaths[i]);
    const items: Item[] = [];
    await collect(tree, rels, zip, builder, imgCache, items);
    // Reading order: top to bottom, then left to right (with a tolerance band).
    items.sort((a, b) => (Math.abs(a.y - b.y) > 300000 ? a.y - b.y : a.x - b.x));
    const titleItem = items.find((it) => it.title);
    const title = titleItem?.title?.slice(0, 120) || `Slide ${i + 1}`;
    builder.startChapter(`${i + 1}. ${title}`, 0);
    builder.addBlock(`<h2 class="slide-title"><span class="slide-no">${i + 1}</span> ${escapeHtml(title)}</h2>`, title.length);
    for (const it of items) if (it.html) builder.addBlock(it.html, it.chars);
    // Speaker notes
    const notesPath = [...rels.values()].find((p) => p.includes('notesSlide'));
    if (notesPath) {
      const nx = await zip.file(notesPath)?.async('string');
      if (nx) {
        const nd = parseXml(nx);
        const bodies = desc(nd, 'sp').filter((sp) => desc(sp, 'ph')[0]?.getAttribute('type') === 'body');
        const notes = bodies.map((b) => kid(b, 'txBody')).filter(Boolean).map((b) => textBodyHtml(b!, false));
        const html = notes.map((n) => n.html).join('');
        if (html) builder.addBlock(`<aside class="notes"><p class="notes-label">Speaker notes</p>${html}</aside>`, notes.reduce((s, n) => s + n.chars, 0));
      }
    }
    if (i % 5 === 4) await yieldToUI();
  }
}
