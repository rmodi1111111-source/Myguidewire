import { useCallback, useEffect, useState } from 'react';
import type { BookMeta, ReaderSettings } from './lib/types';
import { DEFAULT_SETTINGS } from './lib/types';
import { getBook } from './lib/db';
import { Library } from './ui/Library';
import { Reader } from './ui/Reader';

const loadSettings = (): ReaderSettings => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('reader.settings') || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export function App() {
  const [book, setBook] = useState<BookMeta | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);

  const updateSettings = useCallback((s: ReaderSettings) => {
    setSettings(s);
    try {
      localStorage.setItem('reader.settings', JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, []);

  // Match the system bar / page background to the reading theme.
  useEffect(() => {
    const color = book ? { light: '#fbfaf7', sepia: '#f4ecd8', dark: '#1d1d1f', black: '#000000' }[settings.theme] : '#f6f3ee';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    document.documentElement.dataset.ui = book && (settings.theme === 'dark' || settings.theme === 'black') ? 'dark' : 'light';
  }, [book, settings.theme]);

  const open = useCallback(async (b: BookMeta) => {
    // Re-read so we get the latest saved position.
    setBook((await getBook(b.id)) ?? b);
  }, []);

  const close = useCallback(() => setBook(null), []);

  return book ? (
    <Reader key={book.id} book={book} settings={settings} onSettings={updateSettings} onClose={close} />
  ) : (
    <Library onOpen={open} />
  );
}
