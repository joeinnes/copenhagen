// Turns the single-file build (dist/index.html) into the page fragment a claude.ai artifact expects:
// the artifact host adds its own doctype, <html>, <head> and <body>, so we keep only what goes inside them.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const keep = head
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .trim();
writeFileSync('dist/artifact.html', keep + '\n' + body.trim() + '\n');
console.log(`dist/artifact.html: ${(keep.length + body.length) / 1000 | 0} kB`);
