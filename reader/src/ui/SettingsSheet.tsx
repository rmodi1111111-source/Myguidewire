import type { ReaderSettings } from '../lib/types';
import { DEFAULT_SETTINGS } from '../lib/types';
import { Icon } from './Icon';

function Chips<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: { v: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsSheet({ settings: s, onChange, onClose }: { settings: ReaderSettings; onChange: (s: ReaderSettings) => void; onClose: () => void }) {
  const set = <K extends keyof ReaderSettings>(k: K, v: ReaderSettings[K]) => onChange({ ...s, [k]: v });
  return (
    <div className="sheet-backdrop clear" onClick={onClose}>
      <div className="sheet settings" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Display settings">
        <div className="sheet-grip" />
        <div className="setting-row">
          <button className="size-btn" onClick={() => set('fontSize', Math.max(12, s.fontSize - 1))} aria-label="Smaller text">
            <span style={{ fontSize: 14 }}>A</span>
          </button>
          <input
            type="range"
            min={12}
            max={40}
            step={1}
            value={s.fontSize}
            onChange={(e) => set('fontSize', +e.target.value)}
            aria-label="Text size"
            className="slider"
            style={{ '--p': `${((s.fontSize - 12) / 28) * 100}%` } as React.CSSProperties}
          />
          <button className="size-btn" onClick={() => set('fontSize', Math.min(40, s.fontSize + 1))} aria-label="Larger text">
            <span style={{ fontSize: 24 }}>A</span>
          </button>
          <span className="size-val">{s.fontSize}</span>
        </div>

        <div className="setting">
          <label>Theme</label>
          <div className="themes">
            {(['light', 'sepia', 'dark', 'black'] as const).map((t) => (
              <button key={t} className={`theme-swatch sw-${t} ${s.theme === t ? 'on' : ''}`} onClick={() => set('theme', t)} aria-label={`${t} theme`}>
                Aa
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <label>Font</label>
          <Chips
            value={s.fontFamily}
            onChange={(v) => set('fontFamily', v)}
            options={[
              { v: 'literata', label: <span style={{ fontFamily: 'Literata Variable, serif' }}>Literata</span> },
              { v: 'georgia', label: <span style={{ fontFamily: 'Georgia, serif' }}>Georgia</span> },
              { v: 'sans', label: <span style={{ fontFamily: 'Inter Variable, sans-serif' }}>Sans</span> },
              { v: 'dyslexic', label: 'Easy read' },
              { v: 'mono', label: <span style={{ fontFamily: 'monospace' }}>Mono</span> },
            ]}
          />
        </div>

        <div className="setting two">
          <div>
            <label>Line spacing</label>
            <Chips
              value={s.lineHeight}
              onChange={(v) => set('lineHeight', v)}
              options={[
                { v: 1.35, label: 'Tight' },
                { v: 1.6, label: 'Normal' },
                { v: 1.9, label: 'Loose' },
              ]}
            />
          </div>
          <div>
            <label>Margins</label>
            <Chips
              value={s.margin}
              onChange={(v) => set('margin', v)}
              options={[
                { v: 0, label: 'XS' },
                { v: 1, label: 'S' },
                { v: 2, label: 'M' },
                { v: 3, label: 'L' },
                { v: 4, label: 'XL' },
              ]}
            />
          </div>
        </div>

        <div className="setting two">
          <div>
            <label>Layout</label>
            <Chips
              value={s.layout}
              onChange={(v) => set('layout', v)}
              options={[
                { v: 'paged', label: 'Pages' },
                { v: 'scroll', label: 'Scroll' },
              ]}
            />
          </div>
          <div>
            <label>Alignment</label>
            <Chips
              value={s.justify}
              onChange={(v) => set('justify', v)}
              options={[
                { v: true, label: 'Justified' },
                { v: false, label: 'Left' },
              ]}
            />
          </div>
        </div>

        {s.layout === 'paged' && (
          <div className="setting two">
            <div>
              <label>Page turn</label>
              <Chips
                value={s.animation}
                onChange={(v) => set('animation', v)}
                options={[
                  { v: 'curl', label: 'Page curl' },
                  { v: 'slide', label: 'Slide' },
                  { v: 'flip', label: 'Page flip' },
                  { v: 'fade', label: 'Fade' },
                  { v: 'none', label: 'None' },
                ]}
              />
            </div>
            <div>
              <label>Two pages on wide screens</label>
              <Chips
                value={s.spread}
                onChange={(v) => set('spread', v)}
                options={[
                  { v: 'auto', label: 'On' },
                  { v: 'single', label: 'Off' },
                ]}
              />
            </div>
          </div>
        )}

        <div className="setting-row">
          <Icon name="sun" size={18} />
          <input
            type="range"
            min={0.35}
            max={1}
            step={0.01}
            value={s.brightness}
            onChange={(e) => set('brightness', +e.target.value)}
            aria-label="Brightness"
            className="slider"
            style={{ '--p': `${((s.brightness - 0.35) / 0.65) * 100}%` } as React.CSSProperties}
          />
          <button className="btn ghost small" onClick={() => onChange({ ...DEFAULT_SETTINGS, theme: s.theme })}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
