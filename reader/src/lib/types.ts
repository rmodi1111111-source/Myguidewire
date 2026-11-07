export interface ChapterMeta {
  /** Title shown in the table of contents. */
  title: string;
  /** Plain-text length, used to compute whole-book progress. */
  chars: number;
  /** Depth in the table of contents (0 = top level). */
  level: number;
  /** False for continuation sections that were split off a long chapter. */
  toc: boolean;
}

export interface Position {
  chapter: number;
  /** Index of the first block element visible on screen. */
  block: number;
  /** Fallback: fraction (0..1) through the chapter. */
  fraction: number;
}

export interface Bookmark {
  id: string;
  pos: Position;
  label: string;
  createdAt: number;
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  /** Source format: pdf, docx, pptx, epub, html, txt, md */
  format: string;
  sourceName: string;
  addedAt: number;
  openedAt: number;
  chapters: ChapterMeta[];
  totalChars: number;
  /** Bytes stored for this book (chapters + images). */
  size: number;
  coverResId?: string;
  coverColor: string;
  position?: Position;
  progress: number;
  bookmarks: Bookmark[];
  finished?: boolean;
  /** Size of the EPUB file stored in the app for this book. */
  epubSize?: number;
}

export interface Resource {
  id: string;
  bookId: string;
  blob: Blob;
  width?: number;
  height?: number;
}

/** What a converter produces before it is saved. */
export interface ConvertedBook {
  title: string;
  author: string;
  chapters: { title: string; html: string; level?: number }[];
  resources: { id: string; blob: Blob; width?: number; height?: number }[];
  coverResId?: string;
}

export type ThemeName = 'light' | 'sepia' | 'dark' | 'black';
export type PageAnimation = 'curl' | 'slide' | 'flip' | 'fade' | 'none';
export type LayoutMode = 'paged' | 'scroll';

export interface ReaderSettings {
  fontSize: number; // px
  lineHeight: number;
  fontFamily: 'literata' | 'georgia' | 'sans' | 'dyslexic' | 'mono';
  margin: number; // 0..4
  justify: boolean;
  theme: ThemeName;
  animation: PageAnimation;
  layout: LayoutMode;
  spread: 'auto' | 'single';
  brightness: number; // 0.4..1
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 19,
  lineHeight: 1.6,
  fontFamily: 'literata',
  margin: 2,
  justify: true,
  theme: 'light',
  animation: 'curl',
  layout: 'paged',
  spread: 'auto',
  brightness: 1,
};
