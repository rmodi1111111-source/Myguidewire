import type { BookMeta, Position, ReaderSettings } from '../lib/types';
import { getChapter, getResource } from '../lib/db';

/**
 * The reading engine. Plain DOM + TypeScript (no framework) so a page turn is
 * nothing more than a GPU transform:
 *
 *  - Each chapter is laid out once with CSS columns inside a "frame". A page
 *    turn moves the column strip with translate3d — no re-layout, no reflow.
 *  - The neighbouring chapters are preloaded and laid out while the reader is
 *    idle, so crossing a chapter boundary is just as instant.
 *  - Animations (slide / 3D page flip / fade) use a pre-built, already laid
 *    out copy of the chapter ("snapshot") and run on the compositor via the
 *    Web Animations API, so they stay at 60fps even while images decode.
 *  - Swipes follow the finger and finish (or cancel) with the swipe velocity.
 */

export interface Location {
  chapter: number;
  page: number;
  pages: number;
  bookFraction: number;
  position: Position;
  approxPage: number;
  approxTotal: number;
}

export interface EngineCallbacks {
  onLocation(loc: Location): void;
  onTapCenter(): void;
  onImage(src: string, alt: string): void;
  onBusy?(busy: boolean): void;
}

interface Frame {
  ch: number;
  el: HTMLElement; // frame (clip box)
  content: HTMLElement; // column strip / scroll section
  end: HTMLElement;
  pages: number;
  snap?: HTMLElement; // pre-laid-out copy for animations
  snapContent?: HTMLElement;
}

interface Geometry {
  W: number;
  H: number;
  padX: number;
  padY: number;
  cols: number;
  colW: number;
  innerW: number;
  innerH: number;
}

type Transition = {
  dir: 1 | -1;
  from: { ch: number; page: number };
  to: { ch: number; page: number };
  kind: 'slide' | 'flip' | 'fade';
  snap: HTMLElement;
  realSwitchedAtStart: boolean;
  progress: number;
  anims: Animation[];
};

const EASE = 'cubic-bezier(0.22, 0.75, 0.25, 1)';
const idle = (fn: () => void) =>
  'requestIdleCallback' in window ? (window as any).requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 120);

export class ReaderEngine {
  private host: HTMLElement;
  private book: BookMeta;
  private settings: ReaderSettings;
  private cb: EngineCallbacks;
  private stage!: HTMLElement;
  private snaps!: HTMLElement;
  private shade!: HTMLElement;
  private scroller?: HTMLElement;
  private frames = new Map<number, Frame>();
  private loading = new Map<number, Promise<Frame>>();
  private urls = new Map<string, string>();
  private urlLoads = new Map<string, Promise<string>>();
  private geo!: Geometry;
  private ch = 0;
  private page = 0;
  private trans: Transition | null = null;
  private destroyed = false;
  private charsBefore: number[] = [];
  private ro?: ResizeObserver;
  private relayoutTimer = 0;
  private lastSize = '';
  private generation = 0;
  private pendingTap = 0;
  private lastImgTap: { el: Element; t: number } | null = null;
  private wheelAcc = 0;
  private wheelLock = 0;
  private scrollRaf = 0;
  private scrollBusy = false;
  private highlight?: { term: string; ch: number };

  constructor(host: HTMLElement, book: BookMeta, settings: ReaderSettings, cb: EngineCallbacks) {
    this.host = host;
    this.book = book;
    this.settings = settings;
    this.cb = cb;
    let acc = 0;
    this.charsBefore = book.chapters.map((c) => {
      const v = acc;
      acc += c.chars;
      return v;
    });
    host.classList.add('rd-host');
    this.applySettingsVars();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.scheduleRelayout());
    this.ro.observe(host);
  }

  // ------------------------------------------------------------------ public

  async open(pos?: Position) {
    await this.build(pos ?? this.book.position ?? { chapter: 0, block: 0, fraction: 0 });
  }

  get isScroll() {
    return this.settings.layout === 'scroll';
  }

  next() {
    if (this.isScroll) return this.scrollByScreen(1);
    this.turn(1);
  }

  prev() {
    if (this.isScroll) return this.scrollByScreen(-1);
    this.turn(-1);
  }

  async goTo(pos: Position) {
    this.finishTransition();
    await this.build(pos);
  }

  async goToFraction(f: number) {
    f = Math.min(Math.max(f, 0), 0.99999);
    const target = f * this.book.totalChars;
    let ch = 0;
    while (ch < this.book.chapters.length - 1 && this.charsBefore[ch + 1] <= target) ch++;
    const within = (target - this.charsBefore[ch]) / this.book.chapters[ch].chars;
    await this.goTo({ chapter: ch, block: -1, fraction: within });
  }

  /** Approximate chapter + title for a book fraction (for the slider preview). */
  describeFraction(f: number): { chapter: number; title: string } {
    const target = f * this.book.totalChars;
    let ch = 0;
    while (ch < this.book.chapters.length - 1 && this.charsBefore[ch + 1] <= target) ch++;
    let t = ch;
    while (t > 0 && !this.book.chapters[t].toc) t--;
    return { chapter: ch, title: this.book.chapters[t].title };
  }

  setSettings(s: ReaderSettings) {
    const prev = this.settings;
    this.settings = s;
    this.applySettingsVars();
    const layoutChanged =
      prev.layout !== s.layout ||
      prev.fontSize !== s.fontSize ||
      prev.lineHeight !== s.lineHeight ||
      prev.fontFamily !== s.fontFamily ||
      prev.margin !== s.margin ||
      prev.justify !== s.justify ||
      prev.spread !== s.spread;
    if (layoutChanged) {
      const pos = this.getPosition();
      clearTimeout(this.relayoutTimer);
      this.relayoutTimer = window.setTimeout(() => this.build(pos), prev.layout !== s.layout ? 0 : 90);
    }
  }

  getPosition(): Position {
    if (this.isScroll) return this.scrollPosition();
    const f = this.frames.get(this.ch);
    if (!f) return { chapter: this.ch, block: 0, fraction: 0 };
    return { chapter: this.ch, block: this.firstBlockOnPage(f, this.page), fraction: f.pages > 1 ? this.page / f.pages : 0 };
  }

  /** Highlight a search term in the current chapter (CSS Custom Highlight API). */
  setHighlight(term: string | null) {
    this.highlight = term ? { term, ch: this.ch } : undefined;
    this.paintHighlight();
  }

  destroy() {
    this.destroyed = true;
    this.ro?.disconnect();
    clearTimeout(this.relayoutTimer);
    clearTimeout(this.pendingTap);
    this.host.replaceChildren();
    this.host.classList.remove('rd-host', 'rd-scroll-mode', 'rd-spread');
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    (CSS as any).highlights?.delete?.('search');
  }

  // ------------------------------------------------------------------ layout

  private applySettingsVars() {
    const s = this.settings;
    const h = this.host;
    const fam: Record<ReaderSettings['fontFamily'], string> = {
      literata: "'Literata Variable', Literata, Georgia, serif",
      georgia: "Georgia, 'Times New Roman', serif",
      sans: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      dyslexic: "'Comic Sans MS', 'Comic Neue', 'Trebuchet MS', sans-serif",
      mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    };
    h.style.setProperty('--rd-font', fam[s.fontFamily]);
    h.style.setProperty('--rd-fs', `${s.fontSize}px`);
    h.style.setProperty('--rd-lh', String(s.lineHeight));
    h.style.setProperty('--rd-align', s.justify ? 'justify' : 'left');
    h.dataset.theme = s.theme;
  }

  private measure(): Geometry {
    const W = Math.max(this.host.clientWidth, 200);
    const H = Math.max(this.host.clientHeight, 200);
    const spread = this.settings.spread === 'auto' && W >= 900 && W > H * 1.15;
    const marginScale = [0.025, 0.045, 0.065, 0.09, 0.12][this.settings.margin] ?? 0.065;
    const padX = Math.round(Math.max(14, Math.min(W * marginScale + (spread ? 16 : 0), 140)));
    const padY = Math.round(Math.max(28, Math.min(H * 0.06, 64)));
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    const cols = spread ? 2 : 1;
    const gap = padX * 2;
    const colW = cols === 2 ? (innerW - gap) / 2 : innerW;
    return { W, H, padX, padY, cols, colW, innerW, innerH };
  }

  private scheduleRelayout() {
    const size = `${this.host.clientWidth}x${this.host.clientHeight}`;
    if (size === this.lastSize || !this.lastSize) {
      this.lastSize = size;
      return;
    }
    this.lastSize = size;
    const pos = this.getPosition();
    clearTimeout(this.relayoutTimer);
    this.relayoutTimer = window.setTimeout(() => this.build(pos), 150);
  }

  /** (Re)build the view around a position. */
  private async build(pos: Position) {
    const gen = ++this.generation;
    this.finishTransition();
    this.cb.onBusy?.(true);
    this.frames.clear();
    this.loading.clear();
    this.geo = this.measure();
    this.host.style.setProperty('--rd-padx', `${this.geo.padX}px`);
    this.lastSize = `${this.host.clientWidth}x${this.host.clientHeight}`;
    this.host.replaceChildren();
    this.host.classList.toggle('rd-scroll-mode', this.isScroll);
    this.host.classList.toggle('rd-spread', !this.isScroll && this.geo.cols === 2);
    const ch = Math.min(Math.max(pos.chapter, 0), this.book.chapters.length - 1);

    if (this.isScroll) {
      this.scroller = document.createElement('div');
      this.scroller.className = 'rd-scroller';
      this.host.append(this.scroller);
      this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
      const f = await this.loadFrame(ch);
      if (gen !== this.generation) return;
      this.scroller.append(f.el);
      this.fitImages(f);
      this.ch = ch;
      const target = this.blockEl(f, pos.block);
      this.scroller.scrollTop = target ? target.offsetTop - 16 : Math.round(pos.fraction * f.el.offsetHeight);
      this.cb.onBusy?.(false);
      this.paintHighlight();
      this.emitLocation();
      await this.ensureScrollNeighbours();
      return;
    }

    this.scroller = undefined;
    this.stage = document.createElement('div');
    this.stage.className = 'rd-stage';
    this.snaps = document.createElement('div');
    this.snaps.className = 'rd-snaps';
    this.shade = document.createElement('div');
    this.shade.className = 'rd-shade';
    this.host.append(this.stage, this.snaps, this.shade);

    const f = await this.loadFrame(ch);
    if (gen !== this.generation) return;
    this.ch = ch;
    let page: number;
    if (pos.block >= 0) {
      const el = this.blockEl(f, pos.block);
      page = el ? this.pageOf(f, el) : Math.round(pos.fraction * f.pages);
    } else page = Math.floor(pos.fraction * f.pages);
    this.page = Math.min(Math.max(page, 0), f.pages - 1);
    this.show(this.ch, this.page);
    this.cb.onBusy?.(false);
    this.paintHighlight();
    this.emitLocation();
    this.preloadNeighbours();
  }

  private loadFrame(ch: number): Promise<Frame> {
    const have = this.frames.get(ch);
    if (have) return Promise.resolve(have);
    const pending = this.loading.get(ch);
    if (pending) return pending;
    const gen = this.generation;
    const p = (async () => {
      const html = await getChapter(this.book.id, ch);
      const el = document.createElement('div');
      const content = document.createElement('div');
      el.className = this.isScroll ? 'rd-sframe' : 'rd-frame';
      content.className = 'rd-content';
      el.dataset.ch = String(ch);
      content.innerHTML = html;
      // Number top-level blocks for position tracking.
      Array.from(content.children).forEach((c, i) => ((c as HTMLElement).dataset.b = String(i)));
      const end = document.createElement('div');
      end.className = 'rd-end';
      content.append(end);
      el.append(content);
      await this.attachImages(content);
      const frame: Frame = { ch, el, content, end, pages: 1 };
      if (gen !== this.generation || this.destroyed) return frame;
      if (!this.isScroll) {
        this.styleColumns(content);
        el.style.visibility = 'hidden';
        this.stage.append(el);
        this.fitImages(frame);
        frame.pages = this.countPages(frame);
      }
      this.frames.set(ch, frame);
      this.loading.delete(ch);
      return frame;
    })();
    this.loading.set(ch, p);
    return p;
  }

  private styleColumns(content: HTMLElement) {
    const g = this.geo;
    const s = content.style;
    s.left = `${g.padX}px`;
    s.top = `${g.padY}px`;
    s.width = `${g.innerW}px`;
    s.height = `${g.innerH}px`;
    s.columnWidth = `${g.colW}px`;
    s.columnGap = `${g.padX * 2}px`;
    s.columnCount = 'auto';
  }

  private countPages(f: Frame): number {
    const cr = f.content.getBoundingClientRect();
    const er = f.end.getBoundingClientRect();
    const x = er.left - cr.left;
    return Math.max(1, Math.floor((x + 1) / this.geo.W) + 1);
  }

  private pageOf(f: Frame, el: Element): number {
    const cr = f.content.getBoundingClientRect();
    const r = el.getBoundingClientRect(); // both rects include the strip's transform
    return Math.min(Math.max(Math.floor((r.left - cr.left + 2) / this.geo.W), 0), f.pages - 1);
  }

  private blockEl(f: Frame, b: number): HTMLElement | null {
    if (b < 0) return null;
    return (f.content.children[Math.min(b, f.content.children.length - 2)] as HTMLElement) ?? null;
  }

  private firstBlockOnPage(f: Frame, page: number): number {
    const kids = f.content.children;
    const n = kids.length - 1; // exclude .rd-end
    if (n <= 0) return 0;
    // Binary search for the first block that starts on/after `page`.
    let lo = 0;
    let hi = n - 1;
    let ans = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.pageOf(f, kids[mid]) >= page) {
        ans = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    // If that block starts on a later page, the page begins inside the previous block.
    if (this.pageOf(f, kids[ans]) > page && ans > 0) return ans - 1;
    return ans;
  }

  private async attachImages(content: HTMLElement) {
    const imgs = Array.from(content.querySelectorAll<HTMLImageElement>('img[data-res]'));
    await Promise.all(
      imgs.map(async (img) => {
        img.decoding = 'async';
        img.draggable = false;
        const url = await this.urlFor(img.dataset.res!);
        if (url) img.src = url;
        else img.remove();
      }),
    );
  }

  private urlFor(id: string): Promise<string> {
    const have = this.urls.get(id);
    if (have) return Promise.resolve(have);
    let p = this.urlLoads.get(id);
    if (!p) {
      p = getResource(id).then((r) => {
        if (!r) return '';
        const u = URL.createObjectURL(r.blob);
        this.urls.set(id, u);
        return u;
      });
      this.urlLoads.set(id, p);
    }
    return p;
  }

  /** Give every picture an explicit size that fits a page, so layout never shifts. */
  private fitImages(f: Frame) {
    const g = this.geo;
    const scroll = this.isScroll;
    const fs = this.settings.fontSize;
    const maxW = scroll ? Math.min(this.host.clientWidth - 2 * g.padX, 900) : g.colW;
    for (const img of Array.from(f.content.querySelectorAll<HTMLImageElement>('img[data-res]'))) {
      const w = +(img.getAttribute('width') || 0);
      const h = +(img.getAttribute('height') || 0);
      if (!w || !h) {
        img.style.maxWidth = '100%';
        continue;
      }
      const fig = img.closest('figure');
      const pageImage = fig?.classList.contains('page-image');
      const caption = fig?.querySelector('figcaption') ? fs * 2.4 : 0;
      const maxH = (scroll ? this.host.clientHeight * 0.92 : g.innerH - fs * 1.2) - caption;
      const allowUp = pageImage ? 4 : w < 64 && h < 64 ? 1 : 1.6;
      const scale = Math.min(allowUp, maxW / w, maxH / h);
      img.style.width = `${Math.floor(w * scale)}px`;
      img.style.height = `${Math.floor(h * scale)}px`;
    }
  }

  // ------------------------------------------------------------------ paging

  private show(ch: number, page: number) {
    for (const [c, f] of this.frames) {
      f.el.style.visibility = c === ch ? 'visible' : 'hidden';
      f.el.style.zIndex = c === ch ? '1' : '0';
    }
    const f = this.frames.get(ch);
    if (f) f.content.style.transform = `translate3d(${-page * this.geo.W}px,0,0)`;
    this.ch = ch;
    this.page = page;
  }

  private preloadNeighbours() {
    const gen = this.generation;
    idle(async () => {
      if (gen !== this.generation || this.destroyed) return;
      const cur = this.frames.get(this.ch);
      if (cur) this.ensureSnap(cur);
      const want = [this.ch + 1, this.ch - 1].filter((c) => c >= 0 && c < this.book.chapters.length);
      for (const c of want) {
        const f = await this.loadFrame(c);
        if (gen !== this.generation || this.destroyed) return;
        await new Promise((r) => idle(() => r(null)));
        if (gen !== this.generation || this.destroyed) return;
        this.ensureSnap(f);
      }
      // Drop frames that are far away to keep memory low.
      for (const [c, f] of this.frames) {
        if (Math.abs(c - this.ch) > 2) {
          f.el.remove();
          f.snap?.remove();
          this.frames.delete(c);
        }
      }
      this.decodeNearbyImages();
    });
  }

  private decodeNearbyImages() {
    const f = this.frames.get(this.ch);
    if (!f) return;
    for (const img of Array.from(f.content.querySelectorAll('img'))) img.decode?.().catch(() => {});
  }

  /** Build the animation copy of a frame (laid out once, kept hidden). */
  private ensureSnap(f: Frame) {
    if (f.snap) return f.snap;
    const snap = document.createElement('div');
    snap.className = 'rd-snap';
    const c = f.content.cloneNode(true) as HTMLElement;
    c.style.transform = '';
    snap.append(c);
    snap.style.visibility = 'hidden';
    this.snaps.append(snap);
    f.snap = snap;
    f.snapContent = c;
    return snap;
  }

  private canTurn(dir: 1 | -1): { ch: number; page: number } | null {
    const f = this.frames.get(this.ch);
    if (!f) return null;
    if (dir === 1) {
      if (this.page < f.pages - 1) return { ch: this.ch, page: this.page + 1 };
      if (this.ch < this.book.chapters.length - 1) return { ch: this.ch + 1, page: 0 };
    } else {
      if (this.page > 0) return { ch: this.ch, page: this.page - 1 };
      if (this.ch > 0) return { ch: this.ch - 1, page: -1 };
    }
    return null;
  }

  private async turn(dir: 1 | -1) {
    if (this.trans) this.finishTransition();
    const to = this.canTurn(dir);
    if (!to) {
      this.bump(dir);
      return;
    }
    if (to.ch !== this.ch && !this.frames.has(to.ch)) {
      this.cb.onBusy?.(true);
      await this.loadFrame(to.ch);
      this.cb.onBusy?.(false);
    }
    const target = this.frames.get(to.ch);
    if (!target) return;
    if (to.page < 0) to.page = target.pages - 1;
    const anim = this.settings.animation;
    if (anim === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.show(to.ch, to.page);
      this.afterTurn();
      return;
    }
    const t = this.beginTransition(dir, to);
    this.animateTransition(t, 1, anim === 'fade' ? 220 : anim === 'flip' ? 420 : 300);
  }

  private bump(dir: 1 | -1) {
    const f = this.frames.get(this.ch);
    if (!f) return;
    f.el.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * 18}px)` }, { transform: 'translateX(0)' }],
      { duration: 260, easing: 'ease-out' },
    );
  }

  private beginTransition(dir: 1 | -1, to: { ch: number; page: number }): Transition {
    const kind = this.settings.animation === 'none' ? 'slide' : this.settings.animation;
    const from = { ch: this.ch, page: this.page };
    // Flip backwards: the previous page swings back in over the current one.
    const snapFrame = kind === 'flip' && dir === -1 ? this.frames.get(to.ch)! : this.frames.get(from.ch)!;
    const snapPage = kind === 'flip' && dir === -1 ? to.page : from.page;
    const snap = this.ensureSnap(snapFrame);
    snapFrame.snapContent!.style.transform = `translate3d(${-snapPage * this.geo.W}px,0,0)`;
    for (const f of this.frames.values()) if (f.snap && f.snap !== snap) f.snap.style.visibility = 'hidden';
    snap.style.visibility = 'visible';
    snap.className = `rd-snap rd-snap-${kind} ${dir === 1 ? 'fwd' : 'back'}`;
    const realSwitchedAtStart = !(kind === 'flip' && dir === -1);
    if (realSwitchedAtStart) this.show(to.ch, to.page);
    const t: Transition = { dir, from, to, kind, snap, realSwitchedAtStart, progress: 0, anims: [] };
    this.trans = t;
    this.applyProgress(t, 0);
    return t;
  }

  /** Visual state of a transition at progress p (0 = start, 1 = done). */
  private styles(t: Transition, p: number) {
    const W = this.geo.W;
    const d = t.dir;
    if (t.kind === 'slide') {
      return {
        snap: { transform: `translate3d(${-d * p * W}px,0,0)`, opacity: '1' },
        stage: { transform: `translate3d(${d * (1 - p) * W}px,0,0)` },
        shade: { opacity: '0' },
      };
    }
    if (t.kind === 'fade') {
      return {
        snap: { transform: 'none', opacity: String(1 - p) },
        stage: { transform: 'none' },
        shade: { opacity: '0' },
      };
    }
    // flip
    const angle = d === 1 ? -92 * p : -92 * (1 - p);
    const lift = d === 1 ? p : 1 - p;
    return {
      snap: { transform: `perspective(${Math.round(W * 2.2)}px) rotateY(${angle}deg)`, opacity: '1' },
      stage: { transform: 'none' },
      shade: { opacity: String(0.28 * (1 - lift)) },
    };
  }

  private applyProgress(t: Transition, p: number) {
    t.progress = p;
    const s = this.styles(t, p);
    t.snap.style.transform = s.snap.transform;
    t.snap.style.opacity = s.snap.opacity;
    this.stage.style.transform = s.stage.transform;
    this.shade.style.opacity = s.shade.opacity;
  }

  private animateTransition(t: Transition, target: 0 | 1, duration: number, easing = EASE) {
    for (const a of t.anims) a.cancel();
    const a = this.styles(t, t.progress);
    const b = this.styles(t, target);
    const opts: KeyframeAnimationOptions = { duration, easing, fill: 'forwards' };
    const snapKf: Keyframe[] = [{ transform: a.snap.transform, opacity: a.snap.opacity }, { transform: b.snap.transform, opacity: b.snap.opacity }];
    t.anims = [
      t.snap.animate(snapKf, opts),
      this.stage.animate([a.stage, b.stage], opts),
      this.shade.animate([a.shade, b.shade], opts),
    ];
    t.anims[0].onfinish = () => {
      if (this.trans !== t) return;
      this.endTransition(t, target === 1);
    };
  }

  private endTransition(t: Transition, committed: boolean) {
    for (const a of t.anims) a.cancel();
    t.anims = [];
    t.snap.style.visibility = 'hidden';
    t.snap.style.transform = '';
    t.snap.style.opacity = '';
    this.stage.style.transform = '';
    this.shade.style.opacity = '0';
    if (committed) {
      if (!t.realSwitchedAtStart) this.show(t.to.ch, t.to.page);
    } else if (t.realSwitchedAtStart) this.show(t.from.ch, t.from.page);
    this.trans = null;
    if (committed) this.afterTurn();
  }

  /** Jump an in-flight animation to its end (rapid taps never queue up). */
  private finishTransition() {
    const t = this.trans;
    if (!t) return;
    this.endTransition(t, true);
  }

  private afterTurn() {
    this.emitLocation();
    const f = this.frames.get(this.ch);
    if (this.highlight && this.highlight.ch !== this.ch) this.setHighlight(null);
    const nearEdge = f && (this.page >= f.pages - 3 || this.page <= 1);
    const missing = [this.ch - 1, this.ch + 1].some((c) => c >= 0 && c < this.book.chapters.length && !this.frames.has(c));
    if (nearEdge || missing) this.preloadNeighbours();
  }

  // ------------------------------------------------------------------ scroll mode

  private async ensureScrollNeighbours() {
    const sc = this.scroller;
    if (!sc || this.scrollBusy) return;
    this.scrollBusy = true;
    const gen = this.generation;
    try {
      const chs = [...this.frames.keys()].sort((a, b) => a - b);
      const first = chs[0];
      const last = chs[chs.length - 1];
      const screen = sc.clientHeight;
      if (sc.scrollTop + screen * 2.5 > sc.scrollHeight && last < this.book.chapters.length - 1) {
        const f = await this.loadFrame(last + 1);
        if (gen !== this.generation) return;
        sc.append(f.el);
        this.fitImages(f);
      }
      if (sc.scrollTop < screen * 1.5 && first > 0) {
        const f = await this.loadFrame(first - 1);
        if (gen !== this.generation) return;
        const before = sc.scrollHeight;
        const top = sc.scrollTop;
        sc.prepend(f.el);
        this.fitImages(f);
        sc.scrollTop = top + (sc.scrollHeight - before);
      }
      // Keep at most 4 chapters in the DOM.
      const loaded = [...this.frames.keys()].sort((a, b) => a - b);
      while (loaded.length > 4) {
        const dropTop = Math.abs(loaded[0] - this.ch) > Math.abs(loaded[loaded.length - 1] - this.ch);
        const c = dropTop ? loaded.shift()! : loaded.pop()!;
        const f = this.frames.get(c)!;
        if (dropTop) {
          const h = f.el.offsetHeight;
          const top = sc.scrollTop;
          f.el.remove();
          sc.scrollTop = top - h;
        } else f.el.remove();
        this.frames.delete(c);
      }
    } finally {
      this.scrollBusy = false;
    }
  }

  private onScroll() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      const pos = this.scrollPosition();
      if (pos.chapter !== this.ch) this.ch = pos.chapter;
      this.emitLocation(pos);
      this.ensureScrollNeighbours();
    });
  }

  private scrollPosition(): Position {
    const sc = this.scroller;
    if (!sc) return { chapter: this.ch, block: 0, fraction: 0 };
    const top = sc.scrollTop + 8;
    let cur: Frame | undefined;
    for (const f of [...this.frames.values()].sort((a, b) => a.ch - b.ch)) {
      if (f.el.isConnected && f.el.offsetTop <= top) cur = f;
    }
    if (!cur) cur = this.frames.get(this.ch);
    if (!cur) return { chapter: this.ch, block: 0, fraction: 0 };
    const rel = top - cur.el.offsetTop;
    const kids = cur.content.children; // offsetTop values are relative to the scroller
    let block = 0;
    let lo = 0;
    let hi = kids.length - 2;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const el = kids[mid] as HTMLElement;
      if (el.offsetTop + el.offsetHeight <= top) lo = mid + 1;
      else {
        block = mid;
        hi = mid - 1;
      }
    }
    const fraction = Math.min(Math.max(rel / Math.max(cur.el.offsetHeight, 1), 0), 1);
    return { chapter: cur.ch, block, fraction };
  }

  private scrollByScreen(dir: number) {
    const sc = this.scroller;
    if (!sc) return;
    sc.scrollBy({ top: dir * (sc.clientHeight - 60), behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ location

  private emitLocation(pos?: Position) {
    if (this.destroyed) return;
    const position = pos ?? this.getPosition();
    const ch = position.chapter;
    const meta = this.book.chapters[ch];
    let page = 0;
    let pages = 1;
    let within = position.fraction;
    if (!this.isScroll) {
      const f = this.frames.get(ch);
      page = this.page;
      pages = f?.pages ?? 1;
      within = pages > 1 ? (page + 1) / pages : 1;
    }
    const bookFraction = Math.min((this.charsBefore[ch] + meta.chars * within) / this.book.totalChars, 1);
    // Estimate whole-book page numbers from this chapter's density.
    const charsPerPage = Math.max(meta.chars / pages, 200);
    const approxTotal = Math.max(1, Math.round(this.book.totalChars / charsPerPage));
    const approxPage = Math.max(1, Math.min(approxTotal, Math.round((this.charsBefore[ch] / charsPerPage) + page + 1)));
    this.cb.onLocation({ chapter: ch, page, pages, bookFraction, position, approxPage, approxTotal });
  }

  private paintHighlight() {
    const hl = (CSS as any).highlights;
    if (!hl || typeof (window as any).Highlight === 'undefined') return;
    hl.delete('search');
    const h = this.highlight;
    if (!h) return;
    const f = this.frames.get(h.ch);
    if (!f) return;
    const ranges: Range[] = [];
    const needle = h.term.toLowerCase();
    const walker = document.createTreeWalker(f.content, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = (n.textContent || '').toLowerCase();
      let i = text.indexOf(needle);
      while (i >= 0 && ranges.length < 500) {
        const r = new Range();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        ranges.push(r);
        i = text.indexOf(needle, i + needle.length);
      }
    }
    hl.set('search', new (window as any).Highlight(...ranges));
  }

  // ------------------------------------------------------------------ input

  private bindInput() {
    const host = this.host;
    let start: { x: number; y: number; t: number; id: number; type: string } | null = null;
    let dragging = false;
    let samples: { x: number; t: number }[] = [];

    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || start) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType };
      dragging = false;
      samples = [{ x: e.clientX, t: start.t }];
    });

    host.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id || this.isScroll) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging) {
        // Mouse drags select text; touch/pen drags turn pages.
        if (start.type === 'mouse') return;
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        if (window.getSelection()?.toString()) return;
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        if (this.trans) this.finishTransition();
        const to = this.canTurn(dir);
        if (!to || (to.ch !== this.ch && !this.frames.has(to.ch))) {
          start = null;
          if (!to) this.bump(dir);
          return;
        }
        const target = this.frames.get(to.ch)!;
        if (to.page < 0) to.page = target.pages - 1;
        dragging = true;
        try {
          host.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (this.settings.animation === 'none') {
          this.beginTransition(dir, to);
          this.trans!.kind = 'slide';
        } else this.beginTransition(dir, to);
      }
      const t = this.trans;
      if (!t) return;
      const now = performance.now();
      samples.push({ x: e.clientX, t: now });
      if (samples.length > 6) samples.shift();
      const p = Math.min(Math.max((-t.dir * dx) / this.geo.W, 0), 1);
      this.applyProgress(t, p);
    });

    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (dragging) {
        dragging = false;
        const t = this.trans;
        if (!t) return;
        const first = samples[0];
        const last = samples[samples.length - 1];
        const v = (last.x - first.x) / Math.max(last.t - first.t, 1); // px/ms
        const towards = -t.dir * v;
        const commit = e.type !== 'pointercancel' && (t.progress > 0.35 || towards > 0.35) && towards > -0.2;
        const remaining = commit ? 1 - t.progress : t.progress;
        const speed = Math.max(Math.abs(v), 1.4);
        const duration = Math.min(Math.max((remaining * this.geo.W) / speed, 120), 340);
        this.animateTransition(t, commit ? 1 : 0, duration, 'cubic-bezier(0.2, 0.7, 0.3, 1)');
        return;
      }
      if (e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (moved > 10 || performance.now() - s.t > 600) return;
      if (window.getSelection()?.toString()) return;
      this.handleTap(e);
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);

    host.addEventListener('dblclick', (e) => {
      const img = (e.target as Element).closest?.('img');
      if (img) {
        e.preventDefault();
        clearTimeout(this.pendingTap);
        this.openImage(img as HTMLImageElement);
      }
    });

    host.addEventListener(
      'wheel',
      (e) => {
        if (this.isScroll || e.ctrlKey) return;
        e.preventDefault();
        const now = performance.now();
        if (now < this.wheelLock) return;
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.wheelAcc += e.deltaMode === 1 ? d * 30 : d;
        if (Math.abs(this.wheelAcc) > 50) {
          this.turn(this.wheelAcc > 0 ? 1 : -1);
          this.wheelAcc = 0;
          this.wheelLock = now + 320;
        }
      },
      { passive: false },
    );

    host.addEventListener('contextmenu', (e) => {
      if ((e.target as Element).closest?.('img')) e.preventDefault();
    });
  }

  private handleTap(e: PointerEvent) {
    const img = (e.target as Element).closest?.('img') as HTMLImageElement | null;
    const now = performance.now();
    if (img) {
      // Double-tap a picture to zoom; a single tap still turns pages / shows menus.
      if (this.lastImgTap && this.lastImgTap.el === img && now - this.lastImgTap.t < 350) {
        clearTimeout(this.pendingTap);
        this.lastImgTap = null;
        this.openImage(img);
        return;
      }
      this.lastImgTap = { el: img, t: now };
      const x = e.clientX;
      clearTimeout(this.pendingTap);
      if (e.pointerType === 'mouse') return; // mouse uses dblclick; single click on a picture does nothing
      this.pendingTap = window.setTimeout(() => this.zoneTap(x), 300);
      return;
    }
    this.zoneTap(e.clientX);
  }

  private zoneTap(clientX: number) {
    const r = this.host.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    if (this.isScroll) {
      this.cb.onTapCenter();
      return;
    }
    if (x < 0.28) this.prev();
    else if (x > 0.72) this.next();
    else this.cb.onTapCenter();
  }

  private openImage(img: HTMLImageElement) {
    if (img.src) this.cb.onImage(img.src, img.alt || '');
  }
}
