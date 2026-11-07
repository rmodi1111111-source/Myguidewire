import type { BookMeta, Resource } from './types';

/**
 * IndexedDB storage. Books are split into three stores so that the library
 * screen only ever loads small metadata records, and the reader only loads the
 * chapter it is showing (plus neighbours) — never the whole book at once.
 */
const DB_NAME = 'local-reader';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters');
      if (!db.objectStoreNames.contains('resources')) {
        const s = db.createObjectStore('resources', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('epubs')) db.createObjectStore('epubs', { keyPath: 'bookId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const chapterKey = (bookId: string, index: number) => `${bookId}:${index}`;

export async function listBooks(): Promise<BookMeta[]> {
  const db = await open();
  const all = await req(db.transaction('books').objectStore('books').getAll() as IDBRequest<BookMeta[]>);
  return all;
}

export async function getBook(id: string): Promise<BookMeta | undefined> {
  const db = await open();
  return req(db.transaction('books').objectStore('books').get(id) as IDBRequest<BookMeta | undefined>);
}

export async function putBook(book: BookMeta): Promise<void> {
  const db = await open();
  const tx = db.transaction('books', 'readwrite');
  tx.objectStore('books').put(book);
  await done(tx);
}

export async function saveBook(
  book: BookMeta,
  chapters: string[],
  resources: Resource[],
): Promise<void> {
  const db = await open();
  const tx = db.transaction(['books', 'chapters', 'resources'], 'readwrite');
  const cs = tx.objectStore('chapters');
  chapters.forEach((html, i) => cs.put(html, chapterKey(book.id, i)));
  const rs = tx.objectStore('resources');
  for (const r of resources) rs.put(r);
  tx.objectStore('books').put(book);
  await done(tx);
}

export async function getChapter(bookId: string, index: number): Promise<string> {
  const db = await open();
  const html = await req(db.transaction('chapters').objectStore('chapters').get(chapterKey(bookId, index)));
  return (html as string) ?? '';
}

export async function getResource(id: string): Promise<Resource | undefined> {
  const db = await open();
  return req(db.transaction('resources').objectStore('resources').get(id) as IDBRequest<Resource | undefined>);
}

export async function getBookResources(bookId: string): Promise<Resource[]> {
  const db = await open();
  const idx = db.transaction('resources').objectStore('resources').index('bookId');
  return req(idx.getAll(bookId) as IDBRequest<Resource[]>);
}

export async function deleteBook(book: BookMeta): Promise<void> {
  const db = await open();
  const tx = db.transaction(['books', 'chapters', 'resources', 'epubs'], 'readwrite');
  tx.objectStore('books').delete(book.id);
  tx.objectStore('epubs').delete(book.id);
  const cs = tx.objectStore('chapters');
  for (let i = 0; i < book.chapters.length; i++) cs.delete(chapterKey(book.id, i));
  const rs = tx.objectStore('resources');
  const keys = await req(rs.index('bookId').getAllKeys(book.id));
  for (const k of keys) rs.delete(k);
  await done(tx);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return req(db.transaction('kv').objectStore('kv').get(key) as IDBRequest<T | undefined>);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  await done(tx);
}

/** The library budget the app guarantees and shows to the user. */
export const LIBRARY_BUDGET = 1024 * 1024 * 1024; // 1 GB

export interface StorageInfo {
  used: number;
  quota: number;
  persisted: boolean;
}

export async function storageInfo(books: BookMeta[]): Promise<StorageInfo> {
  const used = books.reduce((s, b) => s + (b.size || 0), 0);
  let quota = LIBRARY_BUDGET;
  let persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota) quota = Math.max(LIBRARY_BUDGET, Math.min(est.quota, 64 * LIBRARY_BUDGET));
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    /* ignore */
  }
  return { used, quota, persisted };
}

/** Ask the browser/OS not to evict the library when the device is low on space. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

/** An EPUB file kept inside the app for each book. */
export interface EpubFile {
  bookId: string;
  fileName: string;
  blob: Blob;
  size: number;
  createdAt: number;
}

export async function putEpub(f: EpubFile): Promise<void> {
  const db = await open();
  const tx = db.transaction('epubs', 'readwrite');
  tx.objectStore('epubs').put(f);
  await done(tx);
}

export async function getEpub(bookId: string): Promise<EpubFile | undefined> {
  const db = await open();
  return req(db.transaction('epubs').objectStore('epubs').get(bookId) as IDBRequest<EpubFile | undefined>);
}

/** Metadata of all stored EPUB files (without loading their contents into the UI). */
export async function listEpubs(): Promise<Omit<EpubFile, 'blob'>[]> {
  const db = await open();
  const all = await req(db.transaction('epubs').objectStore('epubs').getAll() as IDBRequest<EpubFile[]>);
  return all.map(({ blob: _b, ...rest }) => rest);
}
