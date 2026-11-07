import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Save or share a generated file (EPUB export). */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: filename, url: res.uri, dialogTitle: 'Save or send EPUB' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];

/** Register a handler for the Android back button / browser back. Return true if handled. */
export function onBack(h: BackHandler): () => void {
  backHandlers.push(h);
  return () => {
    const i = backHandlers.indexOf(h);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

export async function initPlatform() {
  if (!isNative()) return;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', () => {
    for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return;
    App.minimizeApp();
  });
}
