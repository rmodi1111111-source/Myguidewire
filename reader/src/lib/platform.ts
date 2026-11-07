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

/**
 * Save a file to a place the user can find outside the app.
 * Android / iOS: Documents/LocalReader (visible in the Files app).
 * Desktop browsers / Windows app: a "Save as" dialog where supported, otherwise Downloads.
 * Returns a human-readable description of where it went.
 */
export async function saveToDevice(blob: Blob, filename: string): Promise<string> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const data = await blobToBase64(blob);
    try {
      try {
        await Filesystem.requestPermissions(); // only asks on Android 9 and older
      } catch {
        /* not needed */
      }
      await Filesystem.writeFile({ path: `LocalReader/${filename}`, data, directory: Directory.Documents, recursive: true });
      return 'Documents › LocalReader';
    } catch {
      // Some devices block the shared Documents folder: fall back to the share sheet.
      await shareFile(blob, filename);
      return 'the place you picked';
    }
  }
  const picker = (window as any).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: [{ description: 'EPUB book', accept: { 'application/epub+zip': ['.epub'] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return handle.name;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'your Downloads folder';
}

/** Send a file to another app (Drive, email, Files, Kindle, WhatsApp…). */
export async function shareFile(blob: Blob, filename: string): Promise<void> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: filename, files: [res.uri], dialogTitle: 'Export EPUB to…' });
    return;
  }
  const file = new File([blob], filename, { type: 'application/epub+zip' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return;
  }
  await saveToDevice(blob, filename);
}

/** Back-compat helper. */
export const saveFile = async (blob: Blob, filename: string) => {
  await saveToDevice(blob, filename);
};

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
