import JSZip from 'jszip';
import { BookBuilder, imageSize, mimeFromName, yieldToUI } from './builder';
import { desc, parseXml, resolvePath } from './ooxml';
import { feedHtml, resolveImages, type ImgInfo } from './sanitize';

export async function convertEpub(file: File, builder: BookBuilder, onProgress: (p: number, msg: string) => void) {
  onProgress(0.05, 'Opening EPUB…');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container ? desc(parseXml(container), 'rootfile')[0]?.getAttribute('full-path') : Object.keys(zip.files).find((f) => f.endsWith('.opf'));
  if (!opfPath) throw new Error('This EPUB is missing its package file.');
  const opf = parseXml((await zip.file(opfPath)!.async('string')) || '');
  builder.title = desc(opf, 'title')[0]?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
  builder.author = desc(opf, 'creator')[0]?.textContent?.trim() || '';

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of desc(opf, 'item')) {
    manifest.set(item.getAttribute('id') || '', {
      href: resolvePath(opfPath, decodeURIComponent(item.getAttribute('href') || '')),
      type: item.getAttribute('media-type') || '',
      props: item.getAttribute('properties') || '',
    });
  }
  const spine = desc(opf, 'itemref')
    .filter((r) => r.getAttribute('linear') !== 'no')
    .map((r) => manifest.get(r.getAttribute('idref') || ''))
    .filter((m): m is { href: string; type: string; props: string } => !!m && /html|xml/.test(m.type));

  // Table of contents titles keyed by file (EPUB 3 nav or EPUB 2 NCX).
  const tocTitles = new Map<string, string>();
  const nav = [...manifest.values()].find((m) => m.props.includes('nav'));
  const ncxId = desc(opf, 'spine')[0]?.getAttribute('toc');
  try {
    if (nav) {
      const nd = parseXml(await zip.file(nav.href)!.async('string'));
      for (const a of desc(nd, 'a')) {
        const href = resolvePath(nav.href, decodeURIComponent((a.getAttribute('href') || '').split('#')[0]));
        if (href && !tocTitles.has(href)) tocTitles.set(href, (a.textContent || '').replace(/\s+/g, ' ').trim());
      }
    } else if (ncxId && manifest.get(ncxId)) {
      const ncxPath = manifest.get(ncxId)!.href;
      const nd = parseXml(await zip.file(ncxPath)!.async('string'));
      for (const np of desc(nd, 'navPoint')) {
        const src = desc(np, 'content')[0]?.getAttribute('src') || '';
        const href = resolvePath(ncxPath, decodeURIComponent(src.split('#')[0]));
        const label = desc(np, 'text')[0]?.textContent?.trim() || '';
        if (href && !tocTitles.has(href)) tocTitles.set(href, label);
      }
    }
  } catch {
    /* ignore broken toc */
  }

  // Cover image
  const coverMetaId = desc(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem = [...manifest.values()].find((m) => m.props.includes('cover-image')) || (coverMetaId ? manifest.get(coverMetaId) : undefined);

  const imgCache = new Map<string, ImgInfo | null>();
  const loadImage = async (path: string): Promise<ImgInfo | null> => {
    if (imgCache.has(path)) return imgCache.get(path)!;
    let info: ImgInfo | null = null;
    const data = await zip.file(path)?.async('arraybuffer');
    if (data) {
      const blob = new Blob([data], { type: mimeFromName(path) });
      const size = await imageSize(blob);
      if (size) info = { id: builder.addResource(blob, size.width, size.height), width: size.width, height: size.height };
    }
    imgCache.set(path, info);
    return info;
  };
  if (coverItem && /image/.test(coverItem.type)) {
    const info = await loadImage(coverItem.href);
    if (info) builder.setCover(info.id);
  }

  for (let i = 0; i < spine.length; i++) {
    onProgress(0.1 + (0.85 * i) / spine.length, `Importing chapter ${i + 1} of ${spine.length}…`);
    const item = spine[i];
    const src = await zip.file(item.href)?.async('string');
    if (!src) continue;
    let doc = new DOMParser().parseFromString(src, item.type.includes('xhtml') ? 'application/xhtml+xml' : 'text/html');
    if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(src, 'text/html');
    await resolveImages(doc, async (s) => (s.startsWith('data:') || /^https?:/.test(s) ? null : loadImage(resolvePath(item.href, decodeURIComponent(s.split('#')[0])))));
    const body = doc.body || doc.documentElement;
    const heading = body.querySelector('h1, h2, h3');
    const title = tocTitles.get(item.href) || heading?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || (i === 0 ? 'Cover' : `Section ${i + 1}`);
    builder.startChapter(title, 0);
    feedHtml(body, builder, { chapterLevels: [] });
    if (i % 4 === 3) await yieldToUI();
  }
}
