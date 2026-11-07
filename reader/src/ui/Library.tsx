import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookMeta } from '../lib/types';
import { deleteBook, getResource, LIBRARY_BUDGET, listBooks, listEpubs, putBook, requestPersistence, storageInfo, type EpubFile, type StorageInfo } from '../lib/db';
import { ACCEPT, importFile } from '../lib/import';
import { ensureEpub } from '../lib/epubExport';
import { saveToDevice, shareFile } from '../lib/platform';
import { Icon } from './Icon';
import { SAMPLE_MD } from './sample';

interface Job {
  id: string;
  name: string;
  progress: number;
  message: string;
  error?: string;
}

type Sort = 'recent' | 'title' | 'added' | 'author';

const fmtBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const pref = <T,>(key: string, def: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
};
const setPref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

export function Library({ onOpen }: { onOpen: (book: BookMeta) => void }) {
  const [books, setBooks] = useState<BookMeta[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>(() => pref('lib.sort', 'recent'));
  const [view, setView] = useState<'grid' | 'list'>(() => pref('lib.view', 'grid'));
  const [pdfMode, setPdfMode] = useState<'auto' | 'pages'>(() => pref('lib.pdfMode', 'auto'));
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [menu, setMenu] = useState<BookMeta | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<'books' | 'epubs'>('books');
  const [epubs, setEpubs] = useState<Omit<EpubFile, 'blob'>[]>([]);
  const [making, setMaking] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async () => {
    const list = await listBooks();
    setBooks(list);
    setStorage(await storageInfo(list));
    setEpubs(await listEpubs());
  }, []);

  // Books imported before EPUB files were kept in the app get one now, in the background.
  const backfilling = useRef(false);
  useEffect(() => {
    if (!books || backfilling.current) return;
    const ids = new Set(epubs.map((e) => e.bookId));
    const missing = books.filter((b) => !ids.has(b.id));
    if (!missing.length) return;
    backfilling.current = true;
    (async () => {
      for (const b of missing) {
        setMaking(b.id);
        try {
          await ensureEpub(b);
        } catch (e) {
          console.error('EPUB creation failed', e);
        }
      }
      setMaking(null);
      backfilling.current = false;
      await refresh();
    })();
  }, [books, epubs, refresh]);

  useEffect(() => {
    refresh();
    requestPersistence();
  }, [refresh]);

  useEffect(() => setPref('lib.sort', sort), [sort]);
  useEffect(() => setPref('lib.view', view), [view]);
  useEffect(() => setPref('lib.pdfMode', pdfMode), [pdfMode]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        setJobs((j) => [...j, { id, name: file.name, progress: 0, message: 'Waiting…' }]);
        // Convert one file at a time so the device stays responsive.
        queue.current = queue.current.then(async () => {
          let last = 0;
          try {
            await importFile(
              file,
              (p, message) => {
                const now = performance.now();
                if (now - last < 120 && p < 1) return;
                last = now;
                setJobs((j) => j.map((x) => (x.id === id ? { ...x, progress: p, message } : x)));
              },
              { pdfMode: pdfMode === 'pages' ? 'pages' : 'auto' },
            );
            setJobs((j) => j.filter((x) => x.id !== id));
            await refresh();
          } catch (err) {
            console.error(err);
            const msg = err instanceof Error ? err.message : String(err);
            setJobs((j) => j.map((x) => (x.id === id ? { ...x, error: /quota/i.test(msg) ? 'Not enough storage space on this device.' : msg } : x)));
          }
        });
      }
    },
    [pdfMode, refresh],
  );

  // Drag & drop anywhere (desktop)
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      setDragOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragOver(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) addFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  const shown = useMemo(() => {
    if (!books) return [];
    const q = query.trim().toLowerCase();
    const list = q ? books.filter((b) => `${b.title} ${b.author} ${b.sourceName}`.toLowerCase().includes(q)) : [...books];
    list.sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'author'
          ? (a.author || '~').localeCompare(b.author || '~') || a.title.localeCompare(b.title)
          : sort === 'added'
            ? b.addedAt - a.addedAt
            : Math.max(b.openedAt, b.addedAt) - Math.max(a.openedAt, a.addedAt),
    );
    return list;
  }, [books, query, sort]);

  const current = useMemo(() => books?.filter((b) => b.openedAt && b.progress < 0.995).sort((a, b) => b.openedAt - a.openedAt)[0], [books]);

  const loadSample = () => {
    const file = new File([SAMPLE_MD], 'The Quiet Harbour.md', { type: 'text/markdown' });
    addFiles([file]);
  };

  const remove = async (b: BookMeta) => {
    setMenu(null);
    if (!confirm(`Delete “${b.title}” from your library?`)) return;
    await deleteBook(b);
    await refresh();
    setToast('Book deleted');
  };

  const exportBook = async (b: BookMeta, how: 'save' | 'share') => {
    setMenu(null);
    setToast(how === 'save' ? 'Saving EPUB…' : 'Preparing EPUB…');
    try {
      const f = await ensureEpub(b);
      if (how === 'save') {
        const where = await saveToDevice(f.blob, f.fileName);
        setToast(`Saved “${f.fileName}” to ${where}`);
      } else {
        await shareFile(f.blob, f.fileName);
        setToast(null);
      }
      refresh();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return setToast(null);
      setToast(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const rename = async (b: BookMeta) => {
    setMenu(null);
    const title = prompt('Book title', b.title);
    if (!title?.trim()) return;
    const author = prompt('Author (optional)', b.author) ?? b.author;
    await putBook({ ...b, title: title.trim(), author: author.trim() });
    await refresh();
  };

  const toggleFinished = async (b: BookMeta) => {
    setMenu(null);
    await putBook({ ...b, finished: !b.finished, progress: b.finished ? b.progress : 1 });
    await refresh();
  };

  const used = storage?.used ?? 0;
  const budget = LIBRARY_BUDGET;
  const pct = Math.min(100, (used / budget) * 100);

  return (
    <div className="library">
      <header className="lib-header">
        <div className="lib-brand">
          <div className="lib-logo" aria-hidden="true">
            <Icon name="book" size={20} />
          </div>
          <h1>Library</h1>
        </div>
        <div className="lib-search">
          <Icon name="search" size={18} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your books" aria-label="Search your books" />
          {query && (
            <button className="icon-btn small" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <button className="btn primary" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={18} />
          <span>Import</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </header>

      <main className="lib-main">
        {current && !query && (
          <section className="continue" onClick={() => onOpen(current)}>
            <Cover book={current} />
            <div className="continue-info">
              <div className="eyebrow">Continue reading</div>
              <h2>{current.title}</h2>
              {current.author && <div className="muted">{current.author}</div>}
              <div className="progress-row">
                <div className="bar">
                  <span style={{ width: `${Math.round(current.progress * 100)}%` }} />
                </div>
                <span className="muted small">{Math.round(current.progress * 100)}%</span>
              </div>
              <button className="btn primary">Resume</button>
            </div>
          </section>
        )}

        {jobs.length > 0 && (
          <section className="jobs" aria-live="polite">
            {jobs.map((j) => (
              <div key={j.id} className={`job ${j.error ? 'failed' : ''}`}>
                <div className="job-text">
                  <strong>{j.name}</strong>
                  <span className="muted small">{j.error ?? j.message}</span>
                </div>
                {j.error ? (
                  <button className="icon-btn small" onClick={() => setJobs((x) => x.filter((y) => y.id !== j.id))} aria-label="Dismiss">
                    <Icon name="close" size={16} />
                  </button>
                ) : (
                  <div className="bar">
                    <span style={{ width: `${Math.round(j.progress * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <div className="lib-tabs" role="tablist">
          <button role="tab" className={tab === 'books' ? 'on' : ''} onClick={() => setTab('books')}>
            <Icon name="book" size={18} /> Books <span className="count">{books?.length ?? 0}</span>
          </button>
          <button role="tab" className={tab === 'epubs' ? 'on' : ''} onClick={() => setTab('epubs')}>
            <Icon name="download" size={18} /> EPUB files <span className="count">{epubs.length}</span>
          </button>
        </div>

        {tab === 'epubs' && (
          <section className="epub-list">
            <p className="muted small epub-intro">Every document you import is converted into an EPUB file that is kept here, inside the app. Save a copy to your device or send it to another app (Google Drive, email, Kindle…).</p>
            {books?.length === 0 && <p className="muted pad">No EPUB files yet. Import a document first.</p>}
            {books?.map((b) => {
              const e = epubs.find((x) => x.bookId === b.id);
              return (
                <div key={b.id} className="epub-row">
                  <div className="epub-icon">EPUB</div>
                  <div className="epub-info" onClick={() => onOpen(b)}>
                    <strong>{e?.fileName ?? `${b.title}.epub`}</strong>
                    <span className="muted small">{e ? `${fmtBytes(e.size)} · created ${new Date(e.createdAt).toLocaleDateString()} · from ${b.sourceName}` : making === b.id ? 'Creating EPUB…' : 'Waiting to be created…'}</span>
                  </div>
                  <div className="epub-actions">
                    <button className="btn small" disabled={!e} onClick={() => exportBook(b, 'save')}>
                      <Icon name="download" size={16} /> Save
                    </button>
                    <button className="btn small primary" disabled={!e} onClick={() => exportBook(b, 'share')}>
                      <Icon name="upload" size={16} /> Export
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {tab === 'books' && (
        <>
        <div className="lib-toolbar">
          <div className="seg" role="tablist" aria-label="Sort">
            {(['recent', 'title', 'author', 'added'] as Sort[]).map((s) => (
              <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
                {s === 'recent' ? 'Recent' : s === 'title' ? 'Title' : s === 'author' ? 'Author' : 'Added'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <label className="pdf-mode" title="How PDFs are converted">
            <span className="muted small">PDF</span>
            <select value={pdfMode} onChange={(e) => setPdfMode(e.target.value as 'auto' | 'pages')}>
              <option value="auto">Reflow text</option>
              <option value="pages">Exact pages</option>
            </select>
          </label>
          <button className="icon-btn" onClick={() => setView(view === 'grid' ? 'list' : 'grid')} aria-label="Toggle view">
            <Icon name={view === 'grid' ? 'list' : 'grid'} />
          </button>
        </div>

        {books && books.length === 0 && jobs.length === 0 && (
          <section className="empty">
            <div className="empty-art" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h2>Your shelf is empty</h2>
            <p className="muted">Import a PDF, Word, PowerPoint, EPUB, web page or text file. It becomes a book you can read like on a Kindle — and everything stays on this device.</p>
            <div className="row">
              <button className="btn primary" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={18} /> Import a document
              </button>
              <button className="btn" onClick={loadSample}>
                Try a sample book
              </button>
            </div>
          </section>
        )}

        <section className={view === 'grid' ? 'grid' : 'list'} style={tab === 'books' ? undefined : { display: 'none' }}>
          {shown.map((b) => (
            <article key={b.id} className="book" onClick={() => onOpen(b)} onContextMenu={(e) => (e.preventDefault(), setMenu(b))}>
              <Cover book={b} />
              <div className="book-info">
                <div className="book-title">{b.title}</div>
                <div className="muted small book-sub">
                  {b.author ? `${b.author} · ` : ''}
                  {b.format.toUpperCase()} · {fmtBytes(b.size)}
                  {epubs.some((e) => e.bookId === b.id) ? ' · EPUB ✓' : ''}
                </div>
                <div className="progress-row">
                  <div className="bar thin">
                    <span style={{ width: `${Math.round(b.progress * 100)}%` }} />
                  </div>
                  <span className="muted tiny">{b.finished || b.progress >= 0.995 ? 'Done' : b.openedAt ? `${Math.round(b.progress * 100)}%` : 'New'}</span>
                </div>
              </div>
              <button
                className="icon-btn small book-more"
                aria-label={`More for ${b.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(b);
                }}
              >
                <Icon name="more" size={18} />
              </button>
            </article>
          ))}
        </section>

        </>
        )}

        <footer className="storage">
          <div className="storage-head">
            <span>Library storage</span>
            <span className="muted">
              {fmtBytes(used)} of {fmtBytes(budget)} used{storage?.persisted ? ' · protected' : ''}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${Math.max(pct, used ? 0.6 : 0)}%` }} className={pct > 90 ? 'warn' : ''} />
          </div>
          <div className="muted tiny">
            {books?.length ?? 0} book{books?.length === 1 ? '' : 's'} · Stored offline on this device. Space available to the app: {storage ? fmtBytes(storage.quota) : '…'}
          </div>
        </footer>
      </main>

      {menu && (
        <div className="sheet-backdrop" onClick={() => setMenu(null)}>
          <div className="sheet small" onClick={(e) => e.stopPropagation()} role="menu">
            <div className="sheet-title">{menu.title}</div>
            <button className="menu-item" onClick={() => (setMenu(null), onOpen(menu))}>
              <Icon name="book" /> Read
            </button>
            <button className="menu-item" onClick={() => exportBook(menu, 'save')}>
              <Icon name="download" /> Save EPUB to device
            </button>
            <button className="menu-item" onClick={() => exportBook(menu, 'share')}>
              <Icon name="upload" /> Export / share EPUB to…
            </button>
            <button className="menu-item" onClick={() => rename(menu)}>
              <Icon name="edit" /> Rename
            </button>
            <button className="menu-item" onClick={() => toggleFinished(menu)}>
              <Icon name="check" /> {menu.finished ? 'Mark as unread' : 'Mark as finished'}
            </button>
            <button className="menu-item danger" onClick={() => remove(menu)}>
              <Icon name="trash" /> Delete
            </button>
          </div>
        </div>
      )}

      {dragOver && (
        <div className="dropzone">
          <div>
            <Icon name="upload" size={40} />
            <p>Drop files to add them to your library</p>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const coverCache = new Map<string, string>();

export function Cover({ book }: { book: BookMeta }) {
  const [url, setUrl] = useState<string | null>(book.coverResId ? coverCache.get(book.coverResId) ?? null : null);
  useEffect(() => {
    let live = true;
    if (book.coverResId && !coverCache.has(book.coverResId)) {
      getResource(book.coverResId).then((r) => {
        if (!r || !live) return;
        const u = URL.createObjectURL(r.blob);
        coverCache.set(book.coverResId!, u);
        setUrl(u);
      });
    }
    return () => {
      live = false;
    };
  }, [book.coverResId]);
  return (
    <div className="cover" style={{ '--c': book.coverColor } as React.CSSProperties}>
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="cover-gen">
          <div className="cover-title">{book.title}</div>
          {book.author && <div className="cover-author">{book.author}</div>}
        </div>
      )}
      <span className="cover-badge">{book.format}</span>
    </div>
  );
}
