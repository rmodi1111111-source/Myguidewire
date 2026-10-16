// Recently viewed accounts / submissions for the tab-bar dropdowns (per-browser convenience only).

interface Item {
  id: number;
  label: string;
}
interface Recent {
  accounts: Item[];
  submissions: Item[];
  policies: Item[];
}

const KEY = 'recentItems';

export function getRecent(): Recent {
  try {
    return { accounts: [], submissions: [], policies: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { accounts: [], submissions: [], policies: [] };
  }
}

export function pushRecent(kind: keyof Recent, item: Item) {
  const r = getRecent();
  r[kind] = [item, ...r[kind].filter((i) => i.id !== item.id)].slice(0, 6);
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable */
  }
}
