/**
 * Cross-platform path helpers.
 *
 * The Rust backend and the OS both accept forward slashes, but joined paths
 * use the native separator of the current platform so Windows behaves
 * exactly like before.
 */

import { IMAGE_EXT_RE } from '../constants';

/** Last path segment, or '' when the path is empty. */
export function getFileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

/** Last path segment, or the original path when nothing matches. */
export function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

/** Everything before the last separator, keeping the original separator style. */
export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? path : path.slice(0, idx);
}

/** basename without its final extension. */
export function basenameNoExt(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf('.');
  return idx === -1 ? name : name.slice(0, idx);
}

/** Extension of a file name (or path), without the dot; empty when none. */
export function getFileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

/** Lowercased extension — useful for case-insensitive lookups. */
export function ext(path: string): string {
  return getFileExt(basename(path)).toLowerCase();
}

/** Everything before the last separator; the path itself when it has none. */
export function getParentPath(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[/\\]/);
  parts.pop();
  return parts.join(sep) || path;
}

/** Normalize separators to forward slashes (for comparisons / display). */
export function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');
}

const IS_WINDOWS =
  typeof navigator !== 'undefined' && /^win/i.test(navigator.platform);

/** Join path parts with the platform separator, cleaning mixed separators. */
export function joinPath(...parts: string[]): string {
  const sep = IS_WINDOWS ? '\\' : '/';
  return parts.map((p) => p.split(/[\\/]+/).join(sep)).filter(Boolean).join(sep);
}

/**
 * Resolve `rel` against `root`: absolute paths pass through, relative paths
 * (including `./`-prefixed ones) are joined to the root.
 */
export function resolvePath(root: string, rel: string): string {
  if (!rel) return root;
  const clean = rel.replace(/[\\/]+/g, '/').replace(/^\.\//, '');
  if (isAbsolutePath(clean)) return clean;
  return joinPath(root, ...clean.split('/'));
}

/** Whether the given name/path looks like a raster/vector image file. */
export function isImageFile(nameOrPath: string): boolean {
  return IMAGE_EXT_RE.test(nameOrPath);
}
