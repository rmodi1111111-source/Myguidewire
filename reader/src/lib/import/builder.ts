import type { ConvertedBook } from '../types';

/**
 * Collects block-level HTML into chapters. Long chapters are cut into
 * sections of at most MAX_SECTION_CHARS so each one lays out in a few
 * milliseconds; this is the main reason page turns never stall.
 */
const MAX_SECTION_CHARS = 24000;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let counter = 0;
export const newId = (prefix = 'r') =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface Section {
  title: string;
  level: number;
  blocks: string[];
  chars: number;
  continued: boolean;
}

export class BookBuilder {
  title = '';
  author = '';
  private sections: Section[] = [];
  private resources: ConvertedBook['resources'] = [];
  private coverResId?: string;

  startChapter(title: string, level = 0, mergeTinyIntro = false) {
    const cur = this.current();
    const tinyIntro = mergeTinyIntro && cur && this.sections.length === 1 && cur.chars < 240 && !cur.blocks.some((b) => b.includes('<img'));
    if (cur && ((cur.blocks.length === 0 && !cur.continued) || tinyIntro)) {
      // An empty chapter (e.g. a heading followed directly by another heading): rename it.
      cur.title = title;
      cur.level = level;
      return;
    }
    this.sections.push({ title, level, blocks: [], chars: 0, continued: false });
  }

  addBlock(html: string, chars: number) {
    if (!html) return;
    let cur = this.current();
    if (!cur) {
      this.sections.push({ title: this.title || 'Beginning', level: 0, blocks: [], chars: 0, continued: false });
      cur = this.current()!;
    } else if (cur.chars > 0 && cur.chars + chars > MAX_SECTION_CHARS) {
      this.sections.push({ title: cur.title, level: cur.level, blocks: [], chars: 0, continued: true });
      cur = this.current()!;
    }
    cur.blocks.push(html);
    // Images count as some "reading length" so progress moves through image-heavy books.
    cur.chars += Math.max(chars, 1);
  }

  addResource(blob: Blob, width?: number, height?: number): string {
    const id = newId('img');
    this.resources.push({ id, blob, width, height });
    if (!this.coverResId && width && height && width >= 200 && height >= 200) this.coverResId = id;
    return id;
  }

  setCover(id: string) {
    this.coverResId = id;
  }

  hasContent() {
    return this.sections.some((s) => s.blocks.length > 0);
  }

  private current(): Section | undefined {
    return this.sections[this.sections.length - 1];
  }

  build(): ConvertedBook {
    const sections = this.sections.filter((s) => s.blocks.length > 0);
    return {
      title: this.title || 'Untitled',
      author: this.author,
      chapters: sections.map((s) => ({
        title: s.continued ? `${s.title} (cont.)` : s.title,
        level: s.continued ? -1 : s.level,
        html: s.blocks.join('\n'),
      })),
      resources: this.resources,
      coverResId: this.coverResId,
    };
  }
}

export const imgTag = (id: string, w?: number, h?: number, alt = '') =>
  `<img data-res="${id}"${w ? ` width="${Math.round(w)}"` : ''}${h ? ` height="${Math.round(h)}"` : ''} alt="${escapeHtml(alt)}">`;

export const figure = (id: string, w?: number, h?: number, caption = '') =>
  `<figure>${imgTag(id, w, h, caption)}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;

/** Read an image blob's natural size without decoding it on the main thread when possible. */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    if ('createImageBitmap' in self) {
      const bmp = await createImageBitmap(blob);
      const r = { width: bmp.width, height: bmp.height };
      bmp.close();
      return r;
    }
  } catch {
    /* fall through */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Give the UI thread a chance to paint between heavy conversion steps. */
export const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export const mimeFromName = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      avif: 'image/avif',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
};
