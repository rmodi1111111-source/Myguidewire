import type { BookMeta, Resource } from '../types';
import { saveBook } from '../db';
import { BookBuilder, newId } from './builder';

export type ImportProgress = (fraction: number, message: string) => void;

export interface ImportOptions {
  pdfMode?: 'auto' | 'reflow' | 'pages';
}

export const ACCEPT = '.pdf,.docx,.pptx,.epub,.txt,.md,.markdown,.html,.htm,.xhtml,.png,.jpg,.jpeg,.webp,.gif';

export function formatOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

const PALETTE = ['#7a3e2b', '#2f4f6b', '#3c5a3a', '#6b4a7a', '#8a5a1f', '#2d5d5c', '#7a2f45', '#44506a', '#5f5a2b', '#3d3f6e'];

export function colorFor(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export async function importFile(file: File, onProgress: ImportProgress, opts: ImportOptions = {}): Promise<BookMeta> {
  const fmt = formatOf(file.name);
  const builder = new BookBuilder();
  switch (fmt) {
    case 'pdf': {
      const { convertPdf } = await import('./pdf');
      await convertPdf(file, builder, onProgress, { mode: opts.pdfMode ?? 'auto' });
      break;
    }
    case 'docx': {
      const { convertDocx } = await import('./docx');
      await convertDocx(file, builder, onProgress);
      break;
    }
    case 'pptx': {
      const { convertPptx } = await import('./pptx');
      await convertPptx(file, builder, onProgress);
      break;
    }
    case 'epub': {
      const { convertEpub } = await import('./epub');
      await convertEpub(file, builder, onProgress);
      break;
    }
    case 'txt':
    case 'md':
    case 'markdown': {
      const { convertText } = await import('./text');
      await convertText(file, builder, onProgress);
      break;
    }
    case 'html':
    case 'htm':
    case 'xhtml': {
      const { convertHtml } = await import('./text');
      await convertHtml(file, builder, onProgress);
      break;
    }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif': {
      const { convertImage } = await import('./text');
      await convertImage(file, builder);
      break;
    }
    case 'doc':
    case 'ppt':
    case 'xls':
      throw new Error(`Old Office “.${fmt}” files can't be read. Open it in Word or PowerPoint and “Save as” .${fmt}x, then import that.`);
    default:
      throw new Error(`“.${fmt}” files aren't supported yet. Try PDF, Word (.docx), PowerPoint (.pptx), EPUB, HTML or text.`);
  }

  const converted = builder.build();
  if (!converted.chapters.length) throw new Error('No readable text or pictures were found in this file.');
  onProgress(0.96, 'Saving to your library…');

  const id = newId('b');
  const chapters = converted.chapters.map((c) => c.html);
  const metaChapters = converted.chapters.map((c) => {
    const text = c.html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');
    const imgs = (c.html.match(/<img /g) || []).length;
    return { title: c.title, chars: Math.max(text.length + imgs * 200, 1), level: Math.max(c.level ?? 0, 0), toc: (c.level ?? 0) >= 0 };
  });
  const resources: Resource[] = converted.resources.map((r) => ({ ...r, bookId: id }));
  const size = chapters.reduce((s, h) => s + h.length * 2, 0) + resources.reduce((s, r) => s + r.blob.size, 0);
  const now = Date.now();
  const book: BookMeta = {
    id,
    title: converted.title,
    author: converted.author,
    format: fmt,
    sourceName: file.name,
    addedAt: now,
    openedAt: 0,
    chapters: metaChapters,
    totalChars: metaChapters.reduce((s, c) => s + c.chars, 0),
    size,
    coverResId: converted.coverResId,
    coverColor: colorFor(converted.title),
    progress: 0,
    bookmarks: [],
  };
  await saveBook(book, chapters, resources);
  onProgress(1, 'Done');
  return book;
}
