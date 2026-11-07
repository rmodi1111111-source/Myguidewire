import { BookBuilder, escapeHtml } from './builder';

/**
 * Turns arbitrary (X)HTML into clean, theme-able book HTML and feeds it to a
 * BookBuilder block by block. Publisher styles, scripts and layout wrappers
 * are dropped so every book follows the reader's font, size and theme.
 */

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'del', 'ins', 'font', 'img', 'big', 'tt', 'wbr']);
const KEEP_INLINE: Record<string, string> = {
  b: 'strong', strong: 'strong', i: 'em', em: 'em', cite: 'em', dfn: 'em', var: 'em',
  u: 'u', s: 's', del: 's', ins: 'u', sub: 'sub', sup: 'sup', code: 'code', kbd: 'code',
  samp: 'code', tt: 'code', mark: 'mark', small: 'small', q: 'q', abbr: 'abbr',
};
const BLOCK_KEEP: Record<string, string> = {
  p: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', blockquote: 'blockquote',
  pre: 'pre', ul: 'ul', ol: 'ol', li: 'li', dl: 'dl', dt: 'dt', dd: 'dd', table: 'table',
  thead: 'thead', tbody: 'tbody', tfoot: 'tfoot', tr: 'tr', td: 'td', th: 'th', caption: 'caption',
  figure: 'figure', figcaption: 'figcaption', hr: 'hr', aside: 'aside', address: 'p', center: 'p',
};
const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'video', 'audio', 'canvas', 'form', 'input', 'button', 'select', 'textarea', 'nav', 'head', 'title', 'meta', 'link', 'template', 'svg', 'math']);
const CONTAINERS = new Set(['div', 'section', 'article', 'main', 'body', 'html', 'header', 'footer', 'span', 'font', 'a', 'picture']);

export interface ImgInfo {
  id: string;
  width?: number;
  height?: number;
}

function cleanInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (DROP.has(tag)) return '';
  if (tag === 'br') return '<br>';
  if (tag === 'img' || tag === 'image') return imgOut(el);
  const inner = Array.from(el.childNodes).map(cleanInline).join('');
  const keep = KEEP_INLINE[tag];
  if (keep) return inner.trim() ? `<${keep}>${inner}</${keep}>` : inner;
  if (BLOCK_KEEP[tag] || CONTAINERS.has(tag)) return inner;
  return inner;
}

function imgOut(el: Element): string {
  const id = el.getAttribute('data-res');
  if (!id) return '';
  const w = el.getAttribute('data-w') || el.getAttribute('width');
  const h = el.getAttribute('data-h') || el.getAttribute('height');
  const alt = el.getAttribute('alt') || '';
  return `<img data-res="${id}"${w ? ` width="${parseInt(w)}"` : ''}${h ? ` height="${parseInt(h)}"` : ''} alt="${escapeHtml(alt)}">`;
}

function isInlineOnly(el: Element): boolean {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === Node.ELEMENT_NODE) {
      const t = (c as Element).localName.toLowerCase();
      if (!INLINE.has(t) && t !== 'image') return false;
      if (!isInlineOnly(c as Element)) return false;
    }
  }
  return true;
}

function cleanBlock(el: Element): string {
  const tag = el.localName.toLowerCase();
  const out = BLOCK_KEEP[tag] ?? 'p';
  if (out === 'hr') return '<hr>';
  if (out === 'pre') return `<pre>${escapeHtml(el.textContent ?? '')}</pre>`;
  let inner: string;
  if (['ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'blockquote', 'figure', 'aside', 'li', 'td', 'th', 'dd'].includes(out) && !isInlineOnly(el)) {
    inner = Array.from(el.childNodes)
      .map((c) => {
        if (c.nodeType === Node.ELEMENT_NODE) {
          const t = (c as Element).localName.toLowerCase();
          if (DROP.has(t)) return '';
          if (BLOCK_KEEP[t] || CONTAINERS.has(t)) {
            if (CONTAINERS.has(t) && !isInlineOnly(c as Element)) return flattenToHtml(c as Element);
            return CONTAINERS.has(t) ? `<p>${cleanInline(c)}</p>` : cleanBlock(c as Element);
          }
        }
        return cleanInline(c);
      })
      .join('');
  } else {
    inner = cleanInline(el);
  }
  if (!inner.replace(/<br>/g, '').trim() && !inner.includes('<img')) return '';
  const attrs: string[] = [];
  if ((out === 'td' || out === 'th') && el.getAttribute('colspan')) attrs.push(`colspan="${parseInt(el.getAttribute('colspan')!) || 1}"`);
  if (out === 'ol' && el.getAttribute('start')) attrs.push(`start="${parseInt(el.getAttribute('start')!) || 1}"`);
  const align = alignOf(el);
  if (align && out === 'p') attrs.push(`class="${align}"`);
  return `<${out}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${out}>`;
}

function alignOf(el: Element): string | null {
  const style = (el.getAttribute('style') || '') + ' ' + (el.getAttribute('align') || '') + ' ' + (el.getAttribute('class') || '');
  if (/center/i.test(style) || el.localName === 'center') return 'center';
  if (/text-align:\s*right/i.test(style)) return 'right';
  return null;
}

function flattenToHtml(el: Element): string {
  const parts: string[] = [];
  walkBlocks(el, (html) => parts.push(html));
  return parts.join('');
}

/** Visit every block in document order, unwrapping layout containers. */
function walkBlocks(root: Element, emit: (html: string, el: Element) => void) {
  let inlineRun: Node[] = [];
  const flushInline = () => {
    if (!inlineRun.length) return;
    const html = inlineRun.map(cleanInline).join('').trim();
    if (html.replace(/<br>/g, '').trim()) emit(`<p>${html}</p>`, root);
    inlineRun = [];
  };
  for (const c of Array.from(root.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) {
      if ((c.textContent ?? '').trim()) inlineRun.push(c);
      continue;
    }
    if (c.nodeType !== Node.ELEMENT_NODE) continue;
    const el = c as Element;
    const tag = el.localName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (INLINE.has(tag) && (isInlineOnly(el) || tag === 'img')) {
      inlineRun.push(el);
      continue;
    }
    flushInline();
    if (CONTAINERS.has(tag)) {
      if (isInlineOnly(el)) {
        const html = cleanBlock(el);
        if (html) emit(html, el);
      } else walkBlocks(el, emit);
      continue;
    }
    const html = cleanBlock(el);
    if (html) emit(html, el);
  }
  flushInline();
}

export interface FeedOptions {
  /** Heading levels that start a new chapter. */
  chapterLevels?: number[];
  /** Title for the first chapter if content precedes any heading. */
  firstTitle?: string;
}

/** Pick sensible chapter-splitting headings for a document. */
export function chooseChapterLevels(doc: ParentNode): number[] {
  const h1 = doc.querySelectorAll('h1').length;
  const h2 = doc.querySelectorAll('h2').length;
  if (h1 >= 2) return h2 > 0 && h2 / Math.max(h1, 1) < 12 ? [1, 2] : [1];
  if (h1 <= 1 && h2 >= 2) return [2, 3].filter((l) => l === 2 || doc.querySelectorAll('h3').length < 40);
  if (h1 === 1 && h2 < 2) return [1, 3].slice(0, doc.querySelectorAll('h3').length >= 2 ? 2 : 1);
  return [1, 2];
}

export function feedHtml(root: Element, builder: BookBuilder, opts: FeedOptions = {}) {
  const levels = opts.chapterLevels ?? [1, 2];
  if (opts.firstTitle) builder.startChapter(opts.firstTitle, 0);
  walkBlocks(root, (html, el) => {
    const m = /^h([1-6])$/.exec(el.localName.toLowerCase());
    if (m && levels.includes(+m[1])) {
      const title = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (title) builder.startChapter(title, levels.indexOf(+m[1]));
    }
    const text = html.replace(/<[^>]+>/g, '');
    builder.addBlock(html, text.length);
  });
}

/**
 * Replace every <img>/<image> src with a stored resource id. The resolver
 * returns null to drop the image (e.g. remote URLs that can't work offline).
 */
export async function resolveImages(root: ParentNode, resolver: (src: string) => Promise<ImgInfo | null>) {
  const imgs = Array.from(root.querySelectorAll('img, image'));
  for (const img of imgs) {
    const src =
      img.getAttribute('src') ||
      img.getAttribute('href') ||
      img.getAttribute('xlink:href') ||
      img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      '';
    const info = src ? await resolver(src) : null;
    if (!info) {
      img.remove();
      continue;
    }
    // SVG <image> inside an <svg> cover page: lift it out so it survives.
    let target: Element = img;
    if (img.localName === 'image') {
      const svg = img.closest('svg');
      const replacement = img.ownerDocument.createElement('img');
      if (svg) svg.replaceWith(replacement);
      else img.replaceWith(replacement);
      target = replacement;
    }
    target.setAttribute('data-res', info.id);
    if (info.width) target.setAttribute('data-w', String(info.width));
    if (info.height) target.setAttribute('data-h', String(info.height));
  }
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}
