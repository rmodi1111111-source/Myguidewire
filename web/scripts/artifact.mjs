// Turns the single-file standalone build into an Artifact page body:
// the artifact host supplies <!doctype>, <html>, <head> and <body>, so emit only title, styles, root and script.
import fs from 'node:fs';

const html = fs.readFileSync('dist-standalone/index.html', 'utf8');
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script type="module"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
if (!styles || !scripts) throw new Error('Unexpected build output: missing inline style or script');
const page = [
  '<title>PreBind Center</title>',
  '<style>:root{color-scheme:light}body{background:#f3f5f8}</style>',
  styles,
  '<div id="root"></div>',
  scripts,
].join('\n');
fs.writeFileSync('dist-standalone/prebind-center.html', page);
console.log(`dist-standalone/prebind-center.html (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
