import { BookBuilder, escapeHtml, imageSize, mimeFromName } from './builder';
import { chooseChapterLevels, dataUrlToBlob, feedHtml, resolveImages } from './sanitize';

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inlineMd(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw)) {
        out.push(`<pre>${escapeHtml(code.join('\n'))}</pre>`);
        code = null;
      } else code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (/^```/.test(line)) {
      flush();
      closeList();
      code = [];
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      closeList();
      out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`);
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flush();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) {
        closeList();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inlineMd(m[1])}</li>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      closeList();
      out.push(`<blockquote><p>${inlineMd(m[1])}</p></blockquote>`);
    } else if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      flush();
      closeList();
      out.push('<hr>');
    } else if (!line.trim()) {
      flush();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flush();
  closeList();
  return out.join('\n');
}

export function plainTextToHtml(txt: string): string {
  const text = txt.replace(/\r\n?/g, '\n');
  const blankSeparated = /\n\s*\n/.test(text);
  const paras = blankSeparated ? text.split(/\n\s*\n/) : text.split('\n');
  return paras
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((p) => {
      if (p.length < 70 && /^(chapter|part|book|section|prologue|epilogue|introduction)\b/i.test(p)) return `<h1>${escapeHtml(p)}</h1>`;
      return `<p>${escapeHtml(p)}</p>`;
    })
    .join('\n');
}

export async function convertText(file: File, builder: BookBuilder, onProgress: (p: number, msg: string) => void) {
  onProgress(0.1, 'Reading text…');
  const txt = await readText(file);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const html = ext === 'md' || ext === 'markdown' ? markdownToHtml(txt) : plainTextToHtml(txt);
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  builder.title = builder.title || doc.querySelector('h1')?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
  onProgress(0.6, 'Laying out chapters…');
  feedHtml(doc.body, builder, { chapterLevels: chooseChapterLevels(doc), firstTitle: 'Beginning' });
}

export async function convertHtml(file: File, builder: BookBuilder, onProgress: (p: number, msg: string) => void) {
  onProgress(0.1, 'Reading web page…');
  const src = await readText(file);
  const doc = new DOMParser().parseFromString(src, 'text/html');
  builder.title = doc.title?.trim() || doc.querySelector('h1')?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
  builder.author = doc.querySelector('meta[name="author"]')?.getAttribute('content') || '';
  await resolveImages(doc, async (s) => {
    if (!s.startsWith('data:image/')) return null;
    const blob = await dataUrlToBlob(s);
    const size = await imageSize(blob);
    return size ? { id: builder.addResource(blob, size.width, size.height), ...size } : null;
  });
  onProgress(0.6, 'Laying out chapters…');
  feedHtml(doc.body, builder, { chapterLevels: chooseChapterLevels(doc.body), firstTitle: 'Beginning' });
}

export async function convertImage(file: File, builder: BookBuilder) {
  const blob = new Blob([await file.arrayBuffer()], { type: file.type || mimeFromName(file.name) });
  const size = await imageSize(blob);
  if (!size) throw new Error('This picture could not be opened.');
  builder.title = file.name.replace(/\.[^.]+$/, '');
  const id = builder.addResource(blob, size.width, size.height);
  builder.setCover(id);
  builder.startChapter(builder.title, 0);
  builder.addBlock(`<figure class="page-image"><img data-res="${id}" width="${size.width}" height="${size.height}" alt=""></figure>`, 100);
}
