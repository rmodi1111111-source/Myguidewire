import type JSZip from 'jszip';

export const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

export const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
export const kid = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);
export const desc = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name));

export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Map relationship id -> absolute zip path for an OOXML part. */
export async function readRels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.substring(0, partPath.lastIndexOf('/'));
  const file = partPath.substring(partPath.lastIndexOf('/') + 1);
  const relsPath = `${dir ? dir + '/' : ''}_rels/${file}.rels`;
  const map = new Map<string, string>();
  const txt = await zip.file(relsPath)?.async('string');
  if (!txt) return map;
  for (const r of desc(parseXml(txt), 'Relationship')) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    map.set(r.getAttribute('Id') || '', resolvePath(partPath, r.getAttribute('Target') || ''));
  }
  return map;
}

export async function readCoreProps(zip: JSZip): Promise<{ title?: string; author?: string }> {
  const txt = await zip.file('docProps/core.xml')?.async('string');
  if (!txt) return {};
  const doc = parseXml(txt);
  return {
    title: desc(doc, 'title')[0]?.textContent?.trim() || undefined,
    author: desc(doc, 'creator')[0]?.textContent?.trim() || undefined,
  };
}
