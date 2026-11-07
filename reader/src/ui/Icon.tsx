const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  toc: 'M4 6h16M4 12h16M4 18h10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  check: 'M5 12l5 5 9-10',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

export function Icon({ name, size = 22, filled = false }: { name: keyof typeof PATHS | string; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
