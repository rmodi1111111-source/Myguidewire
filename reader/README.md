# Local Reader 3.0

Turn **PDF, Word (.docx), PowerPoint (.pptx), EPUB, HTML, Markdown, text and pictures** into books and read them the way you would on a Kindle or in Apple Books. Everything is converted and stored **on the device**. Nothing is uploaded.

Runs on **Android** (APK), **iPhone/iPad**, **Windows** (installer or portable .exe), and in any modern browser as an installable web app.

## What's new compared with v2.1

| Problem in v2.1 | What 3.0 does |
| --- | --- |
| Hangs on page turns | A turn is now only a GPU transform of an already laid-out page strip. Long chapters are split into small sections, and the next and previous chapters are preloaded while you read. In testing with the CPU slowed 4× to mimic a mid-range phone, 95% of frames during page turns took ≤17 ms (60 fps). |
| Rough page animation | **Slide**, **3D page flip**, **fade** or none. Swipes follow your finger and finish or cancel based on swipe speed. Rapid taps never queue up. |
| No proper scrolling | **Scroll** layout with continuous chapters, plus a whole-book scrubber with a chapter preview in page mode. |
| Pictures can't be zoomed | **Double-tap (or double-click) any picture**: full-screen viewer with pinch, mouse-wheel and +/− zoom up to 800%, drag to pan, double-tap to toggle, and swipe down or Esc to close. |
| Basic text options | Text size 12–40, 5 fonts, line spacing, margins, justify, light / sepia / dark / black themes, brightness, two-page spreads on wide screens. |
| Library / storage | Cover grid or list, search, sort, continue-reading card, progress, bookmarks, search inside books, rename, mark finished, delete. A **1 GB library meter**. The app asks the OS for persistent storage so books aren't evicted. |
| EPUB | Every book can be **saved as a standard EPUB 3** (Share sheet on phones, download on desktop). |

### Conversion details

* **PDF**: rebuilds real paragraphs (joins lines, removes hyphenation, drops running headers, footers and page numbers), detects headings by font size, reads two-column regions column by column, and uses the PDF bookmarks as chapters. **Pictures are cut out of the page where they are drawn**, so they stay next to their text. Scanned PDFs, and the library's **PDF → "Exact pages"** option, keep each page as a sharp image you can zoom.
* **Word**: headings become chapters, and pictures, lists, tables and quotes are kept.
* **PowerPoint**: one chapter per slide, with titles, bullet levels, tables, pictures in reading order, and speaker notes.
* **EPUB**: chapters, table of contents, cover and pictures. Publisher styling is replaced by your reading settings.
* Old binary `.doc` / `.ppt` files must be re-saved as `.docx` / `.pptx` first.

## Get the apps

Each push to this branch runs the GitHub Actions workflow `.github/workflows/reader-apps.yml`. It builds and publishes a **pre-release** containing:

* `LocalReader.apk`: Android. Open it on the phone and allow "install unknown apps". If v2.1 is installed, uninstall it first: same app id, different signing key.
* `Local Reader Setup x.y.z.exe` and `LocalReader-x.y.z-portable.exe`: Windows 10/11.
* `LocalReader-unsigned.ipa`: iPhone/iPad. Apple only allows signed apps, so install it with Sideloadly or AltStore using your Apple ID, or open the Xcode project in `ios/` on a Mac and press Run.
* `LocalReader-web.zip`: host the folder on any HTTPS site. Chrome and Edge on Windows offer "Install app", and Safari on iOS offers "Add to Home Screen".

## Build it yourself

```bash
cd reader
npm install
npm run dev                 # browser, hot reload
npm run build               # production web build in dist/

# Android (needs Android Studio / SDK)
npx cap sync android && cd android && ./gradlew assembleDebug

# iOS (needs a Mac with Xcode)
npx cap sync ios && npx cap open ios

# Windows desktop (run on Windows)
npm run electron:win        # installer + portable exe in release/
```

## Code map

* `src/reader/engine.ts`: the reading engine. It handles column pagination, chapter preloading, page-turn animations and gestures, scroll mode and position tracking.
* `src/lib/import/*`: one converter per format, plus `builder.ts` (splits chapters into sections) and `sanitize.ts` (cleans HTML).
* `src/lib/db.ts`: IndexedDB storage. Metadata, chapters and pictures are stored separately, so only what's on screen is loaded.
* `src/lib/epubExport.ts`: EPUB 3 writer.
* `src/ui/*`: library, reader chrome, settings, contents, search and picture viewer (React).
* `electron/main.cjs`: desktop shell. `android/`, `ios/`: Capacitor native projects.
