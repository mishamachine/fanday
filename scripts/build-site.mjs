#!/usr/bin/env node
// Builds the Fanday static site: site/src -> site/dist (plain files) and site/fanday-site.zip (for Hostinger upload).
// No dependencies. Run with: node scripts/build-site.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, crc32 } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'site', 'src')
const dist = join(root, 'site', 'dist')
const zipPath = join(root, 'site', 'fanday-site.zip')
const ORIGIN = 'https://fanday.bbprojectfactory.com'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const read = (p) => readFileSync(join(src, p), 'utf8')
const write = (p, data) => { const f = join(dist, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data) }
const copy = (from, to) => { const f = join(dist, to); mkdirSync(dirname(f), { recursive: true }); copyFileSync(join(src, from), f) }

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const layout = read('_layout.html')
const logo = read('_logo.svg').trim()
const pages = ['index.html', 'privacy.html', 'terms.html', 'delete.html', '404.html', 'auth/callback.html']

for (const page of pages) {
  const raw = read(page)
  const m = raw.match(/^<!--meta (\{.*\})-->\n/)
  if (!m) throw new Error(`${page}: missing <!--meta {...}--> first line`)
  const meta = JSON.parse(m[1])
  for (const k of ['title', 'description', 'path']) if (!meta[k]) throw new Error(`${page}: meta.${k} missing`)
  const content = raw.slice(m[0].length).trimEnd()
  const vars = {
    title: esc(meta.title), ogTitle: esc(meta.ogTitle ?? meta.title), description: esc(meta.description),
    robots: meta.robots ?? 'index, follow', referrer: meta.referrer ?? 'strict-origin-when-cross-origin',
    canonical: ORIGIN + (meta.path === '/' ? '/' : meta.path),
    logo, content, scripts: (meta.scripts ?? []).map((s) => `<script src="${s}" defer></script>`).join('\n'),
  }
  const html = layout.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in vars)) throw new Error(`layout: unknown {{${k}}}`); return vars[k] })
  write(page, html)
}

copy('site.css', 'site.css')
copy('favicon.svg', 'favicon.svg')
copy('auth/callback.js', 'auth/callback.js')
copy('robots.txt', 'robots.txt')
copy('htaccess', '.htaccess')
copy('well-known/apple-app-site-association', '.well-known/apple-app-site-association')

// Sanity checks: fail the build rather than ship something broken.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const files = walk(dist).sort()
for (const f of files.filter((f) => f.endsWith('.html'))) {
  const h = readFileSync(f, 'utf8')
  if (/<script[^>]+src="https?:/i.test(h) || /<link[^>]+rel="(?:stylesheet|preload|icon)"[^>]+href="https?:/i.test(h)) throw new Error(`${f}: external resource`)
  if (!/<html lang="en">/.test(h) || !/<meta name="description" content="[^"]+">/.test(h)) throw new Error(`${f}: lang/description`)
  if (/<img(?![^>]*\balt=)/i.test(h)) throw new Error(`${f}: img without alt`)
  for (const [, link] of h.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    const t = link === '/' ? 'index.html' : link.replace(/^\//, '')
    if (!existsSync(join(dist, t)) && !existsSync(join(dist, t + '.html'))) throw new Error(`${f}: broken link ${link}`)
  }
}
JSON.parse(readFileSync(join(dist, '.well-known/apple-app-site-association'), 'utf8'))

// Minimal zip writer (stored paths relative to dist, deflate). Zip root = site root, so extract straight into the subdomain folder.
const dosTime = (d) => ({ t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() })
const stamp = dosTime(new Date('2026-01-01T00:00:00'))
const locals = []; const centrals = []; let offset = 0
for (const f of files) {
  const name = Buffer.from(relative(dist, f).split(sep).join('/'))
  const data = readFileSync(f); const comp = deflateRawSync(data, { level: 9 }); const crc = crc32(data)
  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8)
  lh.writeUInt16LE(stamp.t, 10); lh.writeUInt16LE(stamp.d, 12); lh.writeUInt32LE(crc, 14)
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26)
  const ch = Buffer.alloc(46)
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10)
  ch.writeUInt16LE(stamp.t, 12); ch.writeUInt16LE(stamp.d, 14); ch.writeUInt32LE(crc, 16)
  ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28)
  ch.writeUInt32LE(0o100644 << 16 >>> 0, 38); ch.writeUInt32LE(offset, 42)
  locals.push(lh, name, comp); centrals.push(ch, name)
  offset += 30 + name.length + comp.length
}
const cd = Buffer.concat(centrals)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
writeFileSync(zipPath, Buffer.concat([...locals, cd, end]))

console.log(`Built ${files.length} files -> site/dist, ${statSync(zipPath).size} bytes -> site/fanday-site.zip`)
if (readFileSync(join(dist, '.well-known/apple-app-site-association'), 'utf8').includes('TEAMID')) {
  console.log('TODO (Babar): replace TEAMID in .well-known/apple-app-site-association with the Apple Team ID before store release.')
}
