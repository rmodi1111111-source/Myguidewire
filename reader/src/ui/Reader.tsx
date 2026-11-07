import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookMeta, Bookmark, Position, ReaderSettings } from '../lib/types';
import { getChapter, putBook } from '../lib/db';
import { ReaderEngine, type Location } from '../reader/engine';
import { onBack } from '../lib/platform';
import { newId } from '../lib/import/builder';
import { Icon } from './Icon';
import { ImageViewer } from './ImageViewer';
import { SettingsSheet } from './SettingsSheet';

type Panel = null | 'settings' | 'toc' | 'search';

export function Reader({
  book: initial,
  settings,
  onSettings,
  onClose,
}: {
  book: BookMeta;
  settings: ReaderSettings;
  onSettings: (s: ReaderSettings) => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReaderEngine | null>(null);
  const bookRef = useRef<BookMeta>(initial);
  const [book, setBook] = useState(initial);
  const [loc, setLoc] = useState<Location | null>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hint, setHint] = useState(() => {
    try {
      return localStorage.getItem('reader.hintSeen') !== '1';
    } catch {
      return false;
    }
  });
  const dismissHint = () => {
    setHint(false);
    try {
      localStorage.setItem('reader.hintSeen', '1');
    } catch {
      /* ignore */
    }
  };
  const saveTimer = useRef(0);

  const persist = useCallback((b: BookMeta) => {
    bookRef.current = b;
    setBook(b);
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => putBook(bookRef.current), 400);
  }, []);

  // Create the engine once.
  useEffect(() => {
    const host = hostRef.current!;
    const engine = new ReaderEngine(host, initial, settings, {
      onLocation: (l) => {
        setLoc(l);
        const b = bookRef.current;
        persist({ ...b, position: l.position, progress: l.bookFraction, openedAt: Date.now(), finished: b.finished || l.bookFraction >= 0.995 });
      },
      onTapCenter: () => setChrome((c) => !c),
      onImage: (src, alt) => setImage({ src, alt }),
      onBusy: setBusy,
    });
    engineRef.current = engine;
    engine.open(initial.position);
    // Hide the toolbars shortly after opening, like a real e-reader.
    const t = setTimeout(() => setChrome(false), 1800);
    return () => {
      clearTimeout(t);
      clearTimeout(saveTimer.current);
      putBook(bookRef.current);
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  // Keyboard
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (image || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const eng = engineRef.current;
      if (!eng) return;
      if (['ArrowRight', 'PageDown', ' ', 'ArrowDown'].includes(e.key) && !(e.key === 'ArrowDown' && settings.layout === 'scroll')) {
        if (e.key === ' ' && settings.layout === 'scroll') return;
        e.preventDefault();
        eng.next();
      } else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key) && !(e.key === 'ArrowUp' && settings.layout === 'scroll')) {
        e.preventDefault();
        eng.prev();
      } else if (e.key === 'Escape') {
        if (panel) setPanel(null);
        else onClose();
      } else if (e.key === '+' || e.key === '=') onSettings({ ...settings, fontSize: Math.min(40, settings.fontSize + 1) });
      else if (e.key === '-') onSettings({ ...settings, fontSize: Math.max(12, settings.fontSize - 1) });
      else if (e.key.toLowerCase() === 'f' && document.fullscreenEnabled) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [image, panel, settings, onSettings, onClose]);

  // Android back button: close panels first, then the book.
  useEffect(
    () =>
      onBack(() => {
        if (image) return false; // viewer handles its own
        if (panel) {
          setPanel(null);
          return true;
        }
        onClose();
        return true;
      }),
    [panel, image, onClose],
  );

  const chapterTitle = useMemo(() => {
    if (!loc) return '';
    let c = loc.chapter;
    while (c > 0 && !book.chapters[c].toc) c--;
    return book.chapters[c]?.title ?? '';
  }, [loc, book.chapters]);

  const bookmarkHere = useMemo(() => {
    if (!loc) return undefined;
    return book.bookmarks.find((b) => b.pos.chapter === loc.chapter && Math.abs(b.pos.block - loc.position.block) <= 1);
  }, [loc, book.bookmarks]);

  const toggleBookmark = () => {
    if (!loc) return;
    const b = bookRef.current;
    if (bookmarkHere) persist({ ...b, bookmarks: b.bookmarks.filter((x) => x.id !== bookmarkHere.id) });
    else {
      const bm: Bookmark = { id: newId('bm'), pos: loc.position, label: `${chapterTitle} · ${Math.round(loc.bookFraction * 100)}%`, createdAt: Date.now() };
      persist({ ...b, bookmarks: [...b.bookmarks, bm].sort((x, y) => x.pos.chapter - y.pos.chapter || x.pos.block - y.pos.block) });
    }
  };

  const goTo = (pos: Position, highlight?: string) => {
    setPanel(null);
    setChrome(false);
    engineRef.current?.goTo(pos).then(() => engineRef.current?.setHighlight(highlight ?? null));
  };

  const pctNow = scrub ?? loc?.bookFraction ?? book.progress;
  const preview = scrub !== null && engineRef.current ? engineRef.current.describeFraction(scrub) : null;
  const pagesLeft = loc && settings.layout === 'paged' ? loc.pages - loc.page - 1 : null;

  return (
    <div className={`reader theme-${settings.theme} ${chrome ? 'chrome-on' : ''}`} data-theme={settings.theme}>
      <div className="reader-host" ref={hostRef} />
      {settings.brightness < 1 && <div className="dimmer" style={{ opacity: 1 - settings.brightness }} />}

      {busy && (
        <div className="reader-busy" aria-live="polite">
          <div className="spinner" />
        </div>
      )}

      {/* Quiet footer while reading */}
      <div className="reader-footer" aria-hidden={chrome}>
        <span>{settings.layout === 'paged' && loc ? (pagesLeft === 0 ? 'Last page in chapter' : `${pagesLeft} page${pagesLeft === 1 ? '' : 's'} left in chapter`) : chapterTitle}</span>
        <span>{Math.round(pctNow * 100)}%</span>
      </div>

      <header className="reader-top">
        <button className="icon-btn" onClick={onClose} aria-label="Back to library">
          <Icon name="back" />
        </button>
        <div className="reader-titles">
          <div className="reader-book">{book.title}</div>
          <div className="reader-chapter">{chapterTitle}</div>
        </div>
        <button className="icon-btn" onClick={() => setPanel('search')} aria-label="Search in book">
          <Icon name="search" />
        </button>
        <button className="icon-btn" onClick={() => setPanel('toc')} aria-label="Contents and bookmarks">
          <Icon name="toc" />
        </button>
        <button className={`icon-btn ${bookmarkHere ? 'active' : ''}`} onClick={toggleBookmark} aria-label={bookmarkHere ? 'Remove bookmark' : 'Add bookmark'}>
          <Icon name="bookmark" filled={!!bookmarkHere} />
        </button>
        <button className="icon-btn" onClick={() => setPanel('settings')} aria-label="Text and display settings">
          <span className="aa">Aa</span>
        </button>
      </header>

      <div className="reader-progress" aria-hidden="true">
        <span style={{ width: `${pctNow * 100}%` }} />
      </div>

      {settings.layout === 'scroll' && <ScrollHandle fraction={pctNow} onScrub={setScrub} onCommit={(f) => engineRef.current?.goToFraction(f)} />}

      <footer className="reader-bottom">
        <div className="quick-row">
          <div className="seg">
            <button className={settings.layout === 'paged' ? 'on' : ''} onClick={() => onSettings({ ...settings, layout: 'paged' })}>
              Pages
            </button>
            <button className={settings.layout === 'scroll' ? 'on' : ''} onClick={() => onSettings({ ...settings, layout: 'scroll' })}>
              Scroll
            </button>
          </div>
          {settings.layout === 'paged' && (
            <div className="seg">
              {(
                [
                  ['curl', 'Curl'],
                  ['slide', 'Slide'],
                  ['flip', 'Flip'],
                  ['none', 'None'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={settings.animation === v ? 'on' : ''} onClick={() => onSettings({ ...settings, animation: v })}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {preview && (
          <div className="scrub-preview" style={{ left: `calc(${pctNow * 100}% )` }}>
            <div className="scrub-title">{preview.title}</div>
            <div className="muted small">{Math.round(pctNow * 100)}%</div>
          </div>
        )}
        <input
          className="scrubber"
          type="range"
          min={0}
          max={1000}
          value={Math.round(pctNow * 1000)}
          style={{ '--p': `${pctNow * 100}%` } as React.CSSProperties}
          aria-label="Position in book"
          onChange={(e) => setScrub(+e.target.value / 1000)}
          onPointerUp={() => {
            if (scrub !== null) engineRef.current?.goToFraction(scrub);
            setScrub(null);
          }}
          onKeyUp={() => {
            if (scrub !== null) engineRef.current?.goToFraction(scrub);
            setScrub(null);
          }}
        />
        <div className="reader-meta">
          <span>{loc ? (settings.layout === 'paged' ? `Page ${loc.approxPage} of ~${loc.approxTotal}` : chapterTitle) : ''}</span>
          <span>{Math.round(pctNow * 100)}% read</span>
        </div>
        <div className="reader-nav">
          <button className="btn ghost" onClick={() => engineRef.current?.prev()} aria-label="Previous page">
            ‹ Prev
          </button>
          <button className="btn ghost" onClick={() => engineRef.current?.next()} aria-label="Next page">
            Next ›
          </button>
        </div>
      </footer>

      {panel === 'settings' && <SettingsSheet settings={settings} onChange={onSettings} onClose={() => setPanel(null)} />}
      {panel === 'toc' && <TocPanel book={book} current={loc?.chapter ?? 0} onGo={goTo} onClose={() => setPanel(null)} onDeleteBookmark={(id) => persist({ ...bookRef.current, bookmarks: bookRef.current.bookmarks.filter((b) => b.id !== id) })} />}
      {panel === 'search' && <SearchPanel book={book} onGo={goTo} onClose={() => setPanel(null)} />}
      {hint && (
        <div className="hint" onClick={dismissHint}>
          <div className="hint-zones">
            <div>
              <strong>‹</strong>
              <span>Tap or swipe here for the previous page</span>
            </div>
            <div>
              <strong>☰</strong>
              <span>Tap the middle for the menu: Pages / Scroll, page curl, text size, contents</span>
            </div>
            <div>
              <strong>›</strong>
              <span>Tap here, or drag the page corner, to turn the page</span>
            </div>
          </div>
          <p>Tap any picture to open it full screen and pinch to zoom.</p>
          <button className="btn primary">Got it</button>
        </div>
      )}
      {image && <ImageViewer src={image.src} alt={image.alt} onClose={() => setImage(null)} />}
    </div>
  );
}

function TocPanel({ book, current, onGo, onClose, onDeleteBookmark }: { book: BookMeta; current: number; onGo: (p: Position) => void; onClose: () => void; onDeleteBookmark: (id: string) => void }) {
  const [tab, setTab] = useState<'toc' | 'marks'>('toc');
  const listRef = useRef<HTMLDivElement>(null);
  let currentToc = current;
  while (currentToc > 0 && !book.chapters[currentToc].toc) currentToc--;
  useEffect(() => {
    listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }, [tab]);
  return (
    <div className="sheet-backdrop side" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="seg">
            <button className={tab === 'toc' ? 'on' : ''} onClick={() => setTab('toc')}>
              Contents
            </button>
            <button className={tab === 'marks' ? 'on' : ''} onClick={() => setTab('marks')}>
              Bookmarks{book.bookmarks.length ? ` (${book.bookmarks.length})` : ''}
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-list" ref={listRef}>
          {tab === 'toc' &&
            book.chapters.map((c, i) =>
              c.toc ? (
                <button key={i} className={`toc-item lvl${Math.min(c.level, 2)} ${i === currentToc ? 'current' : ''}`} onClick={() => onGo({ chapter: i, block: 0, fraction: 0 })}>
                  <span>{c.title}</span>
                  <span className="muted tiny">{Math.round((book.chapters.slice(0, i).reduce((s, x) => s + x.chars, 0) / book.totalChars) * 100)}%</span>
                </button>
              ) : null,
            )}
          {tab === 'marks' &&
            (book.bookmarks.length ? (
              book.bookmarks.map((b) => (
                <div key={b.id} className="toc-item">
                  <button className="link" onClick={() => onGo(b.pos)}>
                    {b.label}
                  </button>
                  <button className="icon-btn small" onClick={() => onDeleteBookmark(b.id)} aria-label="Delete bookmark">
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))
            ) : (
              <p className="muted pad">No bookmarks yet. Tap the ribbon icon while reading to add one.</p>
            ))}
        </div>
      </aside>
    </div>
  );
}

interface Hit {
  chapter: number;
  block: number;
  before: string;
  match: string;
  after: string;
}

function SearchPanel({ book, onGo, onClose }: { book: BookMeta; onGo: (p: Position, hl?: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const token = useRef(0);

  const run = async (term: string) => {
    const my = ++token.current;
    const needle = term.trim().toLowerCase();
    setHits([]);
    if (needle.length < 2) return;
    setSearching(true);
    const found: Hit[] = [];
    for (let ch = 0; ch < book.chapters.length && found.length < 300; ch++) {
      const html = await getChapter(book.id, ch);
      if (my !== token.current) return;
      if (!html.toLowerCase().includes(needle)) continue;
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      Array.from(doc.body.children).forEach((el, block) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ');
        const lower = text.toLowerCase();
        let i = lower.indexOf(needle);
        while (i >= 0 && found.length < 300) {
          found.push({ chapter: ch, block, before: text.slice(Math.max(0, i - 50), i), match: text.slice(i, i + needle.length), after: text.slice(i + needle.length, i + needle.length + 70) });
          i = lower.indexOf(needle, i + needle.length);
        }
      });
      if (ch % 5 === 4) {
        setHits([...found]);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (my === token.current) {
      setHits(found);
      setSearching(false);
    }
  };

  return (
    <div className="sheet-backdrop side" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <form
          className="drawer-head"
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
        >
          <div className="lib-search grow">
            <Icon name="search" size={18} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search in this book" enterKeyHint="search" />
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </form>
        <div className="drawer-list">
          {searching && <p className="muted pad">Searching…</p>}
          {!searching && q && hits.length === 0 && token.current > 0 && <p className="muted pad">No results.</p>}
          {hits.map((h, i) => (
            <button key={i} className="hit" onClick={() => onGo({ chapter: h.chapter, block: h.block, fraction: 0 }, q.trim())}>
              <span className="muted tiny">{book.chapters[h.chapter].title}</span>
              <span>
                …{h.before}
                <mark>{h.match}</mark>
                {h.after}…
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

/** Draggable scroll handle on the right edge in scroll mode (fast scroll through the whole book). */
function ScrollHandle({ fraction, onScrub, onCommit }: { fraction: number; onScrub: (f: number | null) => void; onCommit: (f: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const f = drag ?? fraction;
  const at = (clientY: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
  };
  return (
    <div className="scroll-track" ref={track}>
      <div
        className={`scroll-thumb ${drag !== null ? 'active' : ''}`}
        style={{ top: `calc(${f * 100}% - ${f * 56}px)` }}
        role="slider"
        aria-label="Scroll through book"
        aria-valuenow={Math.round(f * 100)}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const v = at(e.clientY);
          setDrag(v);
          onScrub(v);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const v = at(e.clientY);
          setDrag(v);
          onScrub(v);
        }}
        onPointerUp={(e) => {
          if (drag === null) return;
          const v = at(e.clientY);
          setDrag(null);
          onScrub(null);
          onCommit(v);
        }}
      >
        <span>{Math.round(f * 100)}%</span>
      </div>
    </div>
  );
}
