import {
  getMaterialIcon,
  getMaterialFolderIcon,
  MATERIAL_FILE_MAP,
  MATERIAL_FOLDER_MAP,
} from './materialIconMap';

/**
 * Flicker-free material icon rendering.
 *
 * The old approach used `<img src="/icons/material/xxx.svg">`, which loads
 * asynchronously — every newly created tab/tree row/breadcrumb segment showed
 * an empty (or "default") icon for a frame until the SVG arrived, and re-inserted
 * `<img>` elements flashed again on every re-render (e.g. breadcrumb icon re-sync
 * on each keystroke).
 *
 * Instead we fetch each SVG once, keep the markup in memory and inject it
 * inline (`{@html}` / `innerHTML`). Inline SVG paints synchronously with zero
 * async gap — the same strategy VSCode icon themes use (icons are defined
 * in-memory, never re-loaded per render). `id`/`url(#...)` references are
 * namespaced per call so inlining the same icon multiple times never collides.
 *
 * While an icon is being fetched for the first time, callers render an
 * invisible placeholder of the same size (never a different icon), so no
 * "default icon first, themed icon later" flash can occur. `preloadMaterialIcons()`
 * warms the cache in the background so even first renders are instant.
 */

const svgCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let mountCounter = 0;

/**
 * Reactive counter — bumped whenever an icon finishes loading so Svelte
 * re-renders consumers. Stored as an object property because exported
 * `$state` may only be mutated, never reassigned.
 */
export const materialIconState = $state({ version: 0 });

async function fetchIcon(name: string): Promise<string> {
  try {
    const res = await fetch(`/icons/material/${name}.svg`);
    if (!res.ok) return '';
    const text = await res.text();
    if (text.trim().length > 0) {
      svgCache.set(name, text);
      materialIconState.version++;
    }
    return text;
  } catch {
    return '';
  }
}

function ensureLoaded(name: string): void {
  if (svgCache.has(name) || pending.has(name)) return;
  pending.set(name, fetchIcon(name).finally(() => pending.delete(name)));
}

const ID_RE = /(\sid=)(["'])(.*?)\2/g;
const URL_RE = /url\(#([^)'"]+)\)/g;

/**
 * Inline SVG markup for a material icon, sized `size`px.
 * Returns `null` while the icon is still loading — render an invisible
 * placeholder in that case, never a different icon.
 */
export function materialIconSvg(name: string, size = 14): string | null {
  ensureLoaded(name);
  void materialIconState.version; // re-run consumers when the icon finishes loading
  const raw = svgCache.get(name);
  if (raw == null) return null;

  // Namespace ids/url(#) refs per call so duplicated inline copies don't clash.
  const ns = `mi${++mountCounter}`;
  const svg = raw
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
    .replace(ID_RE, (_m, pre: string, q: string, id: string) => `${pre}${q}${ns}-${id}${q}`)
    .replace(URL_RE, (_m, id: string) => `url(#${ns}-${id})`);

  // Force the display size on the root <svg> (source files only have viewBox).
  const setAttr = (attrs: string, name: string): string => {
    const re = new RegExp(`${name}=["'][^"']*["']`, 'i');
    return re.test(attrs) ? attrs.replace(re, `${name}="${size}"`) : `${attrs} ${name}="${size}"`;
  };
  return svg.replace(/<svg([^>]*)>/i, (_full, attrs: string) => `<svg${setAttr(setAttr(attrs, 'width'), 'height')}>`);
}

/** Inline SVG for a file entry by file name (e.g. `main.ts`). */
export function materialFileIconSvg(fileName: string, size = 14): string | null {
  return materialIconSvg(getMaterialIcon(fileName), size);
}

/** Inline SVG for a folder entry by folder name. */
export function materialFolderIconSvg(folderName: string, size = 14): string | null {
  return materialIconSvg(`folder-${getMaterialFolderIcon(folderName)}`, size);
}

/** Kick off the fetch for a single icon (idempotent). */
export function preloadMaterialIcon(name: string): void {
  ensureLoaded(name);
}

/**
 * Warm the cache for every icon the UI can show. Safe to call in the
 * background — each fetch is a tiny local file and runs once. Batched so
 * startup isn't hit with hundreds of simultaneous requests; icons the user
 * opens before preload finishes are still fetched on demand by the accessors.
 */
export function preloadMaterialIcons(): void {
  const names = new Set<string>();
  for (const key of Object.keys(MATERIAL_FILE_MAP)) names.add(key);
  for (const key of Object.keys(MATERIAL_FOLDER_MAP)) names.add(`folder-${key}`);
  const list = [...names];
  let i = 0;
  const BATCH = 50;
  const next = () => {
    const end = Math.min(i + BATCH, list.length);
    for (; i < end; i++) ensureLoaded(list[i]);
    if (i < list.length) setTimeout(next, 50);
  };
  next();
}
