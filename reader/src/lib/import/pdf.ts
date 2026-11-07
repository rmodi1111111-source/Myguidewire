import { BookBuilder, escapeHtml, figure, imgTag, yieldToUI } from './builder';

/**
 * PDF -> reflowable book.
 *
 * Text is rebuilt into paragraphs (lines joined, hyphenation removed, running
 * headers/footers and page numbers dropped, headings detected by font size,
 * two-column pages read column by column). Pictures are cut out of a rendered
 * copy of the page at the exact place they are drawn, so they stay next to the
 * text that refers to them. Scanned PDFs (no text layer) or the "exact pages"
 * option keep every page as a high-resolution image.
 */

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

interface Seg {
  x0: number;
  x1: number;
  y: number; // baseline (PDF space, bottom-up)
  size: number;
  text: string;
  bold: boolean;
}

interface Line extends Seg {
  page: number;
}

interface Img {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PageData {
  width: number;
  height: number;
  lines: Line[];
  images: { box: Img; id: string; w: number; h: number }[];
  snapshot?: { id: string; w: number; h: number };
  chars: number;
}

const BULLET = /^([•●○◦▪■□►▸‣⁃–—-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[ivxlcdm]{1,5}[.)])\s/i;

function median(values: number[], weights: number[]): number {
  const idx = values.map((v, i) => [v, weights[i]] as const).sort((a, b) => a[0] - b[0]);
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const [v, w] of idx) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return idx.length ? idx[idx.length - 1][0] : 12;
}

function mul(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function unitBox(m: number[]): Img {
  const pts = [
    [m[4], m[5]],
    [m[0] + m[4], m[1] + m[5]],
    [m[2] + m[4], m[3] + m[5]],
    [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const overlaps = (a: Img, b: Img, pad = 2) => a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', q = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, q),
  );
}

export interface PdfOptions {
  mode: 'auto' | 'reflow' | 'pages';
}

export async function convertPdf(
  file: File,
  builder: BookBuilder,
  onProgress: (p: number, msg: string) => void,
  opts: PdfOptions = { mode: 'auto' },
) {
  onProgress(0.02, 'Opening PDF…');
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const OPS = pdfjs.OPS;

  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, string>;
    builder.title = (info.Title && info.Title.trim().length > 2 && !/^untitled|\.(docx?|pdf)$/i.test(info.Title.trim()) ? info.Title.trim() : '') || file.name.replace(/\.[^.]+$/, '');
    builder.author = info.Author?.trim() || '';

    // ---- Outline (bookmarks) -> chapter starts
    const chapterStarts = new Map<number, { title: string; level: number }[]>();
    try {
      const outline = await doc.getOutline();
      const walk = async (items: any[], level: number) => {
        for (const it of items ?? []) {
          if (level > 1) continue;
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (Array.isArray(dest) && dest[0]) {
              const idx = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
              const list = chapterStarts.get(idx) ?? [];
              list.push({ title: String(it.title || '').trim().slice(0, 120), level });
              chapterStarts.set(idx, list);
            }
          } catch {
            /* broken destination */
          }
          if (it.items?.length) await walk(it.items, level + 1);
        }
      };
      if (outline) await walk(outline, 0);
    } catch {
      /* no outline */
    }

    const n = doc.numPages;
    const pages: PageData[] = [];
    let totalChars = 0;

    // ---- Pass 1: extract text lines and images from every page
    for (let p = 1; p <= n; p++) {
      onProgress(0.05 + 0.8 * ((p - 1) / n), `Reading page ${p} of ${n}…`);
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const styles = (tc as any).styles ?? {};
      const segs: Seg[] = [];
      for (const it of tc.items as any[]) {
        if (typeof it.str !== 'string') continue;
        const str: string = it.str;
        if (!str) continue;
        const t = it.transform as number[];
        // Skip rotated text (watermarks, vertical margin notes).
        if (Math.abs(t[1]) > 0.01 * Math.abs(t[0]) + 0.01) continue;
        const size = Math.abs(t[3]) || Math.hypot(t[2], t[3]) || it.height || 10;
        const fam = String(styles[it.fontName]?.fontFamily ?? '') + ' ' + String(it.fontName ?? '');
        segs.push({ x0: t[4], x1: t[4] + (it.width || str.length * size * 0.5), y: t[5], size, text: str, bold: /bold|black|heavy|semibold/i.test(fam) });
      }

      // Group segments into lines by baseline.
      segs.sort((a, b) => b.y - a.y || a.x0 - b.x0);
      const rawLines: Seg[][] = [];
      for (const s of segs) {
        const last = rawLines[rawLines.length - 1];
        if (last && Math.abs(last[0].y - s.y) < Math.max(2, Math.min(last[0].size, s.size) * 0.45)) last.push(s);
        else rawLines.push([s]);
      }

      // Split lines at wide gaps (columns, table cells). A gap that straddles the
      // middle of the page is treated as a column gutter even when it is narrow.
      const mid = vp1.viewBox ? (vp1.viewBox[0] + vp1.viewBox[2]) / 2 : vp1.width / 2;
      const linePieces: Seg[][] = [];
      for (const ln of rawLines) {
        ln.sort((a, b) => a.x0 - b.x0);
        const out: Seg[] = [];
        let cur: Seg | null = null;
        for (const s of ln) {
          const gap = cur ? s.x0 - cur.x1 : 0;
          const size = cur ? Math.min(cur.size, s.size) : s.size;
          const gutter = cur && gap > size * 0.9 && cur.x1 < mid + size && s.x0 > mid - size;
          if (cur && !gutter && gap < Math.max(cur.size, s.size) * 2.2) {
            const needsSpace = gap > size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(s.text);
            cur.text += (needsSpace ? ' ' : '') + s.text;
            cur.x1 = Math.max(cur.x1, s.x1);
            cur.size = Math.max(cur.size, s.size);
            cur.bold = cur.bold && s.bold;
          } else {
            if (cur) out.push(cur);
            cur = { ...s };
          }
        }
        if (cur) out.push(cur);
        linePieces.push(out);
      }

      // Column detection per region: runs of lines where nothing crosses the
      // middle and several lines have text on both sides are read left column
      // first, then right column. Full-width lines (titles, single-column text)
      // keep their place.
      const crosses = (ps: Seg[]) => ps.some((x) => x.x0 < mid - 4 && x.x1 > mid + 4);
      const ordered: Seg[] = [];
      let band: Seg[][] = [];
      const flushBand = () => {
        const both = band.filter((ps) => ps.some((x) => x.x1 <= mid + 4) && ps.some((x) => x.x0 >= mid - 4)).length;
        if (band.length >= 3 && both >= 2) {
          const all = band.flat();
          ordered.push(...all.filter((x) => x.x1 <= mid + 4), ...all.filter((x) => x.x1 > mid + 4));
        } else for (const ps of band) ordered.push(...ps);
        band = [];
      };
      for (const ps of linePieces) {
        if (crosses(ps)) {
          flushBand();
          ordered.push(...ps);
        } else band.push(ps);
      }
      flushBand();
      const lines: Line[] = ordered.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim(), page: p - 1 })).filter((l) => l.text);
      const chars = lines.reduce((s, l) => s + l.text.length, 0);
      totalChars += chars;

      // ---- Images via the operator list
      const pd: PageData = { width: vp1.width, height: vp1.height, lines, images: [], chars };
      const forcePages = opts.mode === 'pages';
      let boxes: Img[] = [];
      let pathOps = 0;
      if (!forcePages) {
        try {
          const ol = await page.getOperatorList();
          let ctm = [1, 0, 0, 1, 0, 0];
          const stack: number[][] = [];
          for (let i = 0; i < ol.fnArray.length; i++) {
            const fn = ol.fnArray[i];
            const args = ol.argsArray[i];
            if (fn === OPS.save) stack.push(ctm);
            else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
            else if (fn === OPS.transform) ctm = mul(ctm, args as number[]);
            else if (fn === OPS.paintFormXObjectBegin) {
              stack.push(ctm);
              const m = args?.[0];
              if (Array.isArray(m) || ArrayBuffer.isView(m)) ctm = mul(ctm, Array.from(m as ArrayLike<number>));
            } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
            else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat || fn === (OPS as any).paintImageMaskXObject) {
              const b = unitBox(ctm);
              if (b.x1 - b.x0 > 36 && b.y1 - b.y0 > 36) boxes.push(b);
            } else if (fn === OPS.constructPath) pathOps++;
          }
        } catch {
          /* operator list unavailable */
        }
      }

      // Merge touching boxes, clip to page.
      const vb = vp1.viewBox ?? [0, 0, vp1.width, vp1.height];
      boxes = boxes
        .map((b) => ({ x0: Math.max(b.x0, vb[0]), y0: Math.max(b.y0, vb[1]), x1: Math.min(b.x1, vb[2]), y1: Math.min(b.y1, vb[3]) }))
        .filter((b) => b.x1 - b.x0 > 36 && b.y1 - b.y0 > 36);
      let merged = true;
      while (merged) {
        merged = false;
        outer: for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++)
            if (overlaps(boxes[i], boxes[j])) {
              const a = boxes[i], b = boxes[j];
              boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
              boxes.splice(j, 1);
              merged = true;
              break outer;
            }
      }
      const pageArea = (vb[2] - vb[0]) * (vb[3] - vb[1]);
      const imgArea = boxes.reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
      const scanned = chars < 40 && (imgArea > pageArea * 0.5 || boxes.length === 0);
      const drawing = chars < 400 && pathOps > 150;
      const wantSnapshot = forcePages || scanned || drawing || (opts.mode === 'auto' && imgArea > pageArea * 0.8 && chars < 200);

      if (wantSnapshot || boxes.length) {
        const targetW = wantSnapshot ? 1500 : 1700;
        const scale = Math.min(targetW / vp1.width, 4);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { alpha: false })!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas } as any).promise;
        if (wantSnapshot) {
          const blob = await canvasToBlob(canvas, 'image/jpeg', 0.84);
          pd.snapshot = { id: builder.addResource(blob, canvas.width, canvas.height), w: canvas.width, h: canvas.height };
        } else {
          for (const b of boxes) {
            const r = vp.convertToViewportRectangle([b.x0, b.y0, b.x1, b.y1]);
            const x = Math.max(0, Math.floor(Math.min(r[0], r[2])));
            const y = Math.max(0, Math.floor(Math.min(r[1], r[3])));
            const w = Math.min(canvas.width - x, Math.ceil(Math.abs(r[2] - r[0])));
            const h = Math.min(canvas.height - y, Math.ceil(Math.abs(r[3] - r[1])));
            if (w < 40 || h < 40) continue;
            const c2 = document.createElement('canvas');
            c2.width = w;
            c2.height = h;
            c2.getContext('2d', { alpha: false })!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
            const blob = await canvasToBlob(c2, 'image/jpeg', 0.88);
            pd.images.push({ box: b, id: builder.addResource(blob, w, h), w, h });
            c2.width = c2.height = 0;
          }
        }
        canvas.width = canvas.height = 0;
      }
      pages.push(pd);
      page.cleanup();
      if (p % 3 === 0) await yieldToUI();
    }

    onProgress(0.88, 'Building chapters…');

    // Whole document is scanned: give it an exact-pages layout.
    const scannedDoc = totalChars < n * 60;

    // ---- Running headers / footers
    const marginKey = (l: Line, pg: PageData) => {
      const rel = l.y / pg.height;
      if (rel < 0.92 && rel > 0.08) return null;
      return `${rel > 0.5 ? 'T' : 'B'}|${l.text.replace(/\d+/g, '#').toLowerCase()}`;
    };
    const counts = new Map<string, number>();
    pages.forEach((pg) => {
      const seen = new Set<string>();
      pg.lines.forEach((l) => {
        const k = marginKey(l, pg);
        if (k && !seen.has(k)) {
          seen.add(k);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      });
    });
    const repeated = new Set([...counts].filter(([, c]) => c >= Math.max(3, n * 0.3)).map(([k]) => k));
    const isNoise = (l: Line, pg: PageData) => {
      const k = marginKey(l, pg);
      if (!k) return false;
      if (repeated.has(k)) return true;
      return /^(page\s*)?[-–]?\s*\d{1,4}\s*[-–]?(\s*(of|\/)\s*\d+)?$/i.test(l.text) || /^[ivxlc]{1,6}$/i.test(l.text);
    };

    const all = pages.flatMap((pg) => pg.lines.filter((l) => !isNoise(l, pg)));
    const body = median(all.map((l) => Math.round(l.size * 2) / 2), all.map((l) => l.text.length)) || 11;
    const useOutline = chapterStarts.size > 0;

    // Typical line gap for paragraph detection.
    const gaps: number[] = [];
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1], b = all[i];
      if (a.page === b.page && Math.abs(a.size - body) < 1 && Math.abs(b.size - body) < 1) {
        const g = a.y - b.y;
        if (g > 0 && g < body * 3) gaps.push(g);
      }
    }
    const lineGap = gaps.length ? median(gaps, gaps.map(() => 1)) : body * 1.25;

    let para: string[] = [];
    let paraSize = body;
    let paraBold = false;
    const flush = () => {
      if (!para.length) return;
      let text = '';
      for (const piece of para) {
        if (!text) text = piece;
        else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(piece)) text = text.slice(0, -1) + piece;
        else text += ' ' + piece;
      }
      const ratio = paraSize / body;
      const short = text.length < 140;
      if (short && ratio >= 1.6) {
        if (!useOutline) builder.startChapter(text.slice(0, 120), 0, true);
        builder.addBlock(`<h1>${escapeHtml(text)}</h1>`, text.length);
      } else if (short && ratio >= 1.25) {
        builder.addBlock(`<h2>${escapeHtml(text)}</h2>`, text.length);
      } else if (short && (ratio >= 1.1 || (paraBold && text.length < 90 && !/[.,;:]$/.test(text)))) {
        builder.addBlock(`<h3>${escapeHtml(text)}</h3>`, text.length);
      } else if (BULLET.test(text)) {
        builder.addBlock(`<p class="li">${escapeHtml(text)}</p>`, text.length);
      } else {
        builder.addBlock(`<p>${escapeHtml(text)}</p>`, text.length);
      }
      para = [];
    };

    if (!useOutline && !builder.hasContent()) builder.startChapter(scannedDoc ? `Pages 1–${Math.min(20, pages.length)}` : 'Beginning', 0);

    for (let pi = 0; pi < pages.length; pi++) {
      const pg = pages[pi];
      const starts = chapterStarts.get(pi);
      if (starts?.length) {
        flush();
        for (const s of starts) builder.startChapter(s.title || `Page ${pi + 1}`, s.level, true);
      } else if (scannedDoc && !useOutline && pi > 0 && pi % 20 === 0) {
        builder.startChapter(`Pages ${pi + 1}–${Math.min(pi + 20, pages.length)}`, 0);
      }

      if (pg.snapshot) {
        flush();
        builder.addBlock(`<figure class="page-image">${imgTag(pg.snapshot.id, pg.snapshot.w, pg.snapshot.h, `Page ${pi + 1}`)}<figcaption>Page ${pi + 1}</figcaption></figure>`, Math.max(pg.chars, 2000));
        continue;
      }

      // Interleave images with lines by vertical position (per column when two-column).
      const imgs = [...pg.images].sort((a, b) => b.box.y1 - a.box.y1);
      const lines = pg.lines.filter((l) => !isNoise(l, pg));
      let prev: Line | null = null;
      for (const l of lines) {
        while (imgs.length && imgs[0].box.y1 > l.y + l.size) {
          flush();
          const im = imgs.shift()!;
          builder.addBlock(figure(im.id, im.w, im.h), 200);
        }
        const sizeChange = Math.abs(l.size - paraSize) > Math.max(0.8, body * 0.08);
        const boldChange = l.bold !== paraBold && (l.size > body * 1.05 || paraSize > body * 1.05 || l.text.length < 90);
        let newPara = !para.length || sizeChange || boldChange;
        if (!newPara && prev) {
          const gap = prev.page === l.page ? prev.y - l.y : lineGap;
          if (gap < -lineGap) newPara = /[.!?"”)]$/.test(prev.text) && (prev.x1 - prev.x0 < (l.x1 - l.x0) * 0.8 || /^[A-Z“"‘]/.test(l.text)); // jumped to the next column
          else if (gap > lineGap * 1.45) newPara = true; // big vertical gap
          else if (BULLET.test(l.text)) newPara = true;
          else if (/[.!?:"”’)]$/.test(prev.text) && prev.x1 - prev.x0 < (l.x1 - l.x0) * 0.8 && l.x1 - l.x0 > body * 10) newPara = true; // short last line
          else if (l.x0 - prev.x0 > body * 1.2 && l.x0 - prev.x0 < body * 6 && /[.!?:"”]$/.test(prev.text)) newPara = true; // indented first line
        }
        if (newPara) {
          flush();
          paraSize = l.size;
          paraBold = l.bold;
        }
        para.push(l.text);
        prev = l;
      }
      // A paragraph that continues onto the next page stays open, unless an image follows.
      if (imgs.length) {
        flush();
        for (const im of imgs) builder.addBlock(figure(im.id, im.w, im.h), 200);
      }
      if (pi % 20 === 19) await yieldToUI();
    }
    flush();
  } finally {
    await doc.destroy();
  }
}
