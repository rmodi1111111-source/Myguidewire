import { BookBuilder, imageSize } from './builder';
import { chooseChapterLevels, feedHtml } from './sanitize';

const DISPLAYABLE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif)$/i;

export async function convertDocx(file: File, builder: BookBuilder, onProgress: (p: number, msg: string) => void) {
  onProgress(0.05, 'Opening Word document…');
  const mammoth = (await import('mammoth')).default;
  const buf = await file.arrayBuffer();
  onProgress(0.2, 'Reading text and pictures…');
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buf },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
      ],
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!DISPLAYABLE.test(image.contentType)) return { src: '' };
        const blob = new Blob([await image.readAsArrayBuffer()], { type: image.contentType });
        const size = await imageSize(blob);
        if (!size) return { src: '' };
        const id = builder.addResource(blob, size.width, size.height);
        return { src: `res:${id}:${size.width}:${size.height}` };
      }),
    },
  );
  onProgress(0.75, 'Laying out chapters…');
  const doc = new DOMParser().parseFromString(`<body>${result.value}</body>`, 'text/html');
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const m = /^res:([^:]+):(\d+):(\d+)$/.exec(img.getAttribute('src') || '');
    if (!m) {
      img.remove();
      continue;
    }
    img.setAttribute('data-res', m[1]);
    img.setAttribute('data-w', m[2]);
    img.setAttribute('data-h', m[3]);
  }
  const firstHeading = doc.querySelector('h1, h2');
  if (!builder.title) builder.title = firstHeading?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
  feedHtml(doc.body, builder, { chapterLevels: chooseChapterLevels(doc), firstTitle: 'Beginning' });
}
