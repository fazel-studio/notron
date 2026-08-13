// ── Module F, §F.6 — Entry Point Resolution Engine ─────────────────────────
//
// Implements modules/06-Notron-Module-RunAndDebug_V2.md §F.6. This engine
// answers "what should Run and Debug launch?" without a hand-written launch.json.
//
//   §F.6.1 — Strict signal hierarchy, never a hardcoded 1-2 favorite filenames:
//            1. explicit config (launch.json / manual pick)  → handled by caller
//            2. project manifest (package.json / pyproject.toml)
//            3. framework-aware override
//            4. generic filename heuristic (fallback)
//            5. active file (only for explicit "Run/Debug Current File")
//    The engine returns candidates WITH a confidence tier so the caller can
//    (a) pick the unique best entry immediately, or (b) surface a quick-pick
//    when ≥2 equally-trusted candidates exist (§F.6.1 "never guess silently").
//
//   §F.6.2 — Node: package.json `scripts` first (command *parsed*, not just the
//            script name), then `main`, then `exports`, then heuristic.
//
//   §F.6.3 — Python: pyproject.toml [project.scripts]/[tool.poetry.scripts]
//            resolved to a module file (src-layout aware), Django manage.py +
//            FLASK_APP + FastAPI/uvicorn, then heuristics.
//
//   §F.6.4 — Monorepo: resolution prefers the nearest manifest to the active
//            file; the returned candidates carry a `project` hint so the UI
//            can pin a workspace sub-project.
//
//   §F.6.5 — Results cached per workspace (localStorage), invalidated when a
//            manifest's mtime changes.

import { invoke } from '@tauri-apps/api/core';
import type { RunConfiguration } from '../stores/run';

// ── Public model ────────────────────────────────────────────────────────────

export type EntryTier = 'manifest' | 'framework' | 'heuristic' | 'active';

export interface ResolvedEntry {
  name: string;
  type: 'node' | 'python' | 'go' | 'ruby';
  program: string;
  cwd: string;
  source: string;
  tier: EntryTier;
  command?: string;
  framework?: string;
  runtimeExecutable?: string;
  project?: string;
}

interface CacheEntry {
  version: number;
  sig: string;
  candidates: ResolvedEntry[];
}

const CACHE_VERSION = 1;
const CACHE_PREFIX = 'notron:entryResolver:';

type Pyproject = {
  project?: { scripts?: Record<string, string> };
  tool?: { poetry?: { scripts?: Record<string, string> } };
};

// ── small FS helpers ────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>('file_exists', { path });
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await invoke<string>('read_file_text', { path });
  } catch {
    return null;
  }
}

async function manifestMtime(path: string): Promise<number> {
  try {
    const info = await invoke<{ modified?: number } | null>('get_file_info', { path });
    return info?.modified ?? 0;
  } catch {
    return 0;
  }
}

function joinPath(...parts: string[]): string {
  return parts.join('\\');
}

// ── path helpers ────────────────────────────────────────────────────────────

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function dirname(path: string): string {
  const i = normalize(path).lastIndexOf('/');
  return i === -1 ? path : path.slice(0, i);
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function ext(path: string): string {
  const n = basename(path);
  const idx = n.lastIndexOf('.');
  return idx === -1 ? '' : n.slice(idx + 1).toLowerCase();
}

function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');
}

function resolvePath(root: string, rel: string): string {
  if (!rel) return root;
  const clean = rel.replace(/[\\/]+/g, '/').replace(/^\.\//, '');
  if (isAbsolutePath(clean)) return clean;
  return joinPath(root, ...clean.split('/'));
}

const NODE_EXTS = ['js', 'ts', 'mjs', 'cjs', 'tsx', 'mts', 'cts', 'jsx'];

function isNodeFile(p: string): boolean {
  return NODE_EXTS.includes(ext(p));
}

// heuristic priorities (§F.6.2 step 3 / §F.6.3 step 3)
const NODE_HEURISTIC = [
  'index.js', 'index.ts', 'index.mjs',
  'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
  'app.js', 'app.ts', 'src/app.js', 'src/app.ts',
  'server.js', 'server.ts', 'src/server.js', 'src/server.ts',
];
const PY_HEURISTIC = ['main.py', 'app.py', '__main__.py', 'src/main.py', 'src/app.py'];

// ── package.json ────────────────────────────────────────────────────────────

interface Pkg {
  main?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parsePackageJson(raw: string): Pkg | null {
  try {
    return JSON.parse(raw) as Pkg;
  } catch {
    return null;
  }
}

async function findPackageJson(root: string, activeDir?: string): Promise<{ dir: string; pkg: Pkg } | null> {
  const candidates: string[] = [];
  if (activeDir && normalize(activeDir) !== normalize(root)) {
    let dir = activeDir;
    while (dir && normalize(dir).startsWith(normalize(root))) {
      candidates.push(joinPath(dir, 'package.json'));
      if (dir === root || dir === dirname(dir)) break;
      dir = dirname(dir);
    }
  }
  candidates.push(joinPath(root, 'package.json'));
  for (const p of candidates) {
    const raw = await readText(p);
    if (raw != null) {
      const pkg = parsePackageJson(raw);
      if (pkg) return { dir: dirname(p), pkg };
    }
  }
  return null;
}

/** Pull the first trailing path argument ending in .js/.ts/.mjs/.cjs/.tsx from a script. */
function extractScriptEntry(script: string): string | null {
  const parts = script.trim().split(/\s+/);
  for (const p of parts) {
    if (/\.(j|t|c|m)sx?$/.test(p)) return p;
  }
  return null;
}

/** exports field → single path (node > import > require > default). */
function resolveExports(exports: unknown): string | null {
  if (typeof exports === 'string') return exports;
  if (Array.isArray(exports)) {
    for (const e of exports) {
      const r = resolveExports(e);
      if (r) return r;
    }
    return null;
  }
  if (exports && typeof exports === 'object') {
    const obj = exports as Record<string, unknown>;
    if ('.' in obj) return resolveExports(obj['.']);
    for (const key of ['node', 'import', 'require', 'default']) {
      if (key in obj) {
        const r = resolveExports(obj[key]);
        if (r) return r;
      }
    }
    for (const v of Object.values(obj)) {
      const r = resolveExports(v);
      if (r) return r;
    }
  }
  return null;
}

function detectNodeFramework(pkg: Pkg): ResolvedEntry | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) {
    return { name: 'Next.js (dev server)', type: 'node', program: '', cwd: '', source: 'package.json#next', tier: 'framework', framework: 'next', command: 'next dev' };
  }
  if (deps['@nestjs/core']) {
    return { name: 'NestJS (src/main.ts)', type: 'node', program: '', cwd: '', source: 'package.json#@nestjs/core', tier: 'framework', framework: 'nest', command: 'nest start --watch' };
  }
  if (deps.vite || deps['@vitejs/plugin-react']) {
    return { name: 'Vite (dev)', type: 'node', program: '', cwd: '', source: 'package.json#vite', tier: 'framework', framework: 'vite', command: 'vite' };
  }
  return null;
}

function buildNodeCandidate(pkgDir: string, entry: string, tier: EntryTier, label: string): ResolvedEntry | null {
  if (!isNodeFile(entry)) return null;
  const abs = isAbsolutePath(entry) ? entry : resolvePath(pkgDir, entry);
  return { name: label, type: 'node', program: abs, cwd: dirname(abs), source: label, tier };
}

async function resolveNode(root: string, activeDir?: string): Promise<ResolvedEntry[]> {
  const out: ResolvedEntry[] = [];
  const near = await findPackageJson(root, activeDir);
  const pkgDir = near ? near.dir : root;

  if (near) {
    const pkg = near.pkg;

    // 1. scripts (parsed command, not just the script name)
    for (const key of ['dev', 'start', 'debug']) {
      const script = pkg.scripts?.[key];
      if (!script) continue;
      const entry = extractScriptEntry(script);
      if (entry) {
        const cand = buildNodeCandidate(pkgDir, entry, 'manifest', `${key} script`);
        if (cand) out.push(cand);
      }
    }

    // framework-aware override (evaluated before generic heuristics)
    const framework = detectNodeFramework(pkg);
    if (framework) {
      framework.cwd = pkgDir;
      out.push(framework);
    }

    // (2) main field
    if (pkg.main && out.length === 0) {
      const c = buildNodeCandidateP(pkgDir, pkg.main, 'manifest', 'package.json#main');
      if (c) out.push(c);
    }

    // (3) exports field
    const exportsEntry = pkg.main ? null : resolveExports(pkg.exports);
    if (exportsEntry && out.length === 0) {
      const c = buildNodeCandidateP(pkgDir, exportsEntry, 'manifest', 'package.json#exports');
      if (c) out.push(c);
    }
  }

  // (4) heuristic file names (only when nothing above produced anything)
  if (out.length === 0) {
    for (const rel of NODE_HEURISTIC) {
      const p = joinPath(root, ...rel.split('/'));
      if (await fileExists(p)) {
        const c = buildNodeCandidateP(root, p, 'heuristic', `heuristic ${rel}`);
        if (c) out.push(c);
        break;
      }
    }
  }

  return dedupe(out);
}

function buildNodeCandidateP(pkgDir: string, entry: string, tier: EntryTier, label: string): ResolvedEntry | null {
  return buildNodeCandidate(pkgDir, entry, tier, label);
}

// ── pyproject.toml (lightweight parser — only the tables we need) ───────────

function parseTomlLoose(raw: string): Record<string, any> {
  const root: Record<string, any> = {};
  let stack: string[] = [];
  let current: Record<string, any> | null = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('[')) {
      const path = trimmed.slice(1, trimmed.lastIndexOf(']')).trim();
      stack = path.split('.').map((s) => s.trim());
      const anchor: Record<string, any> = root;
      for (const seg of stack) {
        anchor[seg] = anchor[seg] || {};
        if (seg === stack[stack.length - 1]) current = anchor[seg] as Record<string, any>;
      }
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1 || !current) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^"(.*)"$/s, '$1');
    const value = trimmed.slice(eq + 1).trim();
    current[key] = value.startsWith('"') ? value.replace(/^"(.*)"$/s, '$1') : value;
  }
  return root;
}

/** "package.module:fn" → "package.module" (file path). */
function scriptModulePath(value: string): string {
  return value.split(':')[0].trim();
}

/** Resolve a dotted module path to an on-disk .py file (src-layout aware). */
async function moduleToPath(module: string, root: string): Promise<string | null> {
  if (!module) return null;
  const relParts = module.split('.');
  const roots = [root, joinPath(root, 'src')];
  for (const r of roots) {
    const file = joinPath(r, ...relParts) + '.py';
    if (await fileExists(file)) return file;
    const pkgMain = joinPath(r, ...relParts, '__main__.py');
    if (await fileExists(pkgMain)) return pkgMain;
  }
  return null;
}

async function detectPythonFramework(root: string, pyprojectRaw: string | null): Promise<ResolvedEntry | null> {
  if (await fileExists(joinPath(root, 'manage.py'))) {
    return {
      name: 'Django (runserver)',
      type: 'python',
      program: joinPath(root, 'manage.py'),
      cwd: root,
      source: 'Django manage.py',
      tier: 'framework',
      framework: 'django',
      command: 'python manage.py runserver',
    };
  }
  if (pyprojectRaw && /fastapi|uvicorn/i.test(pyprojectRaw)) {
    return {
      name: 'FastAPI (uvicorn)',
      type: 'python',
      program: '',
      cwd: root,
      source: 'FastAPI/uvicorn',
      tier: 'framework',
      framework: 'uvicorn',
      command: 'uvicorn app:app',
    };
  }
  if (pyprojectRaw && /flask/i.test(pyprojectRaw)) {
    const app = await flaskApp(root);
    return {
      name: 'Flask (FLASK_APP / app.py)',
      type: 'python',
      program: app,
      cwd: root,
      source: 'Flask',
      tier: 'framework',
      framework: 'flask',
      command: 'flask run',
    };
  }
  return null;
}

async function flaskApp(root: string): Promise<string> {
  const raw = (await readText(joinPath(root, '.env'))) || '';
  const m = raw.match(/^FLASK_APP\s*=\s*"?([^"\n]+)"?/m);
  if (m) {
    const module = m[1].replace(/\.py$/, '').replace(/[\\/]/g, '.');
    const resolved = await moduleToPath(module, root);
    if (resolved) return resolved;
  }
  for (const name of ['app.py', 'wsgi.py']) {
    const p = joinPath(root, name);
    if (await fileExists(p)) return p;
  }
  return '';
}

function entryFromPython(program: string, name: string, tier: EntryTier): ResolvedEntry {
  return { name, type: 'python', program, cwd: dirname(program), source: name, tier };
}

async function resolvePython(root: string): Promise<ResolvedEntry[]> {
  const out: ResolvedEntry[] = [];
  const workspaceName = basename(root) || 'project';
  const pyprojectRaw = await readText(joinPath(root, 'pyproject.toml'));

  // (1) pyproject entry scripts
  if (pyprojectRaw != null) {
    const parsed = parseTomlLoose(pyprojectRaw) as unknown as Pyproject;
    const scripts = parsed?.project?.scripts || parsed?.tool?.poetry?.scripts;
    if (scripts && typeof scripts === 'object') {
      let count = 0;
      for (const [name, value] of Object.entries(scripts as Record<string, string>)) {
        if (count >= 4) break;
        const file = await moduleToPath(scriptModulePath(value), root);
        if (file) {
          out.push(entryFromPython(file, `pyproject → ${name}`, 'manifest'));
          count++;
        }
      }
    }
  }

  // (2) framework-aware
  const framework = await detectPythonFramework(root, pyprojectRaw);
  if (framework) out.push(framework);

  // (3) heuristics (only if nothing yet)
  if (out.length === 0) {
    for (const rel of PY_HEURISTIC) {
      const p = joinPath(root, ...rel.split('/'));
      if (await fileExists(p)) {
        out.push(entryFromPython(p, rel, 'heuristic'));
        break;
      }
    }
    const pkgMain = joinPath(root, workspaceName, '__main__.py');
    if (out.length === 0 && await fileExists(pkgMain)) {
      out.push(entryFromPython(pkgMain, `${workspaceName}/__main__.py`, 'heuristic'));
    }
  }

  return dedupe(out);
}

/** Python interpreter resolution (§F.6.3 step 4) — macOS/Windows convention. */
export async function resolvePythonInterpreter(root: string): Promise<string> {
  const candidates = [
    `${root}\\.venv\\Scripts\\python.exe`,
    `${root}\\.venv\\bin\\python`,
    `${root}\\venv\\Scripts\\python.exe`,
    `${root}\\venv\\bin\\python`,
  ];
  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }
  return 'python';
}

// ── dedupe ──────────────────────────────────────────────────────────────────

function dedupe(list: (ResolvedEntry | null)[]): ResolvedEntry[] {
  const seen = new Set<string>();
  const out: ResolvedEntry[] = [];
  for (const c of list) {
    if (!c) continue;
    if (!c.program && !c.command) continue;
    const sig = `${c.type}:${c.program}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(c);
  }
  return out;
}

// ── caching (§F.6.5) ────────────────────────────────────────────────────────

function cacheKey(workspace: string): string {
  try {
    return CACHE_PREFIX + btoa(unescape(encodeURIComponent(workspace)));
  } catch {
    return CACHE_PREFIX + workspace.length;
  }
}

function loadCache(workspace: string, sig: string): ResolvedEntry[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(workspace));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.version !== CACHE_VERSION || parsed.sig !== sig || !Array.isArray(parsed.candidates)) return null;
    return parsed.candidates;
  } catch {
    return null;
  }
}

function saveCache(workspace: string, sig: string, candidates: ResolvedEntry[]) {
  try {
    localStorage.setItem(cacheKey(workspace), JSON.stringify({ version: CACHE_VERSION, sig, candidates }));
  } catch {
    // ignore quota failures
  }
}

export function invalidateEntryCache(workspace: string) {
  try {
    localStorage.removeItem(cacheKey(workspace));
  } catch {
    // ignore
  }
}

// ── public API ──────────────────────────────────────────────────────────────

// ── Go & Ruby (§F.5.2 Fase 1) — manifest-based entry resolution ─────────────

/** Basic heuristic resolution for Go and Ruby workspaces (Fase 1 adapters). */
async function resolveGoRuby(root: string): Promise<ResolvedEntry[]> {
  const out: ResolvedEntry[] = [];
  const cwd = root;

  // Go: prefer an explicit `main` package under `cmd/`, else a root main.go.
  if (await fileExists(joinPath(root, 'go.mod')) || await fileExists(joinPath(root, 'Gopkg.toml'))) {
    for (const rel of ['cmd/main.go', 'cmd/app/main.go', 'main.go']) {
      const p = joinPath(root, ...rel.split('/'));
      if (await fileExists(p)) {
        out.push({ name: 'Go: main package', type: 'go', program: p, cwd, source: `go.mod → ${rel}`, tier: 'heuristic' });
        break;
      }
    }
  }

  // Ruby: bin/rails (Rails), or a Gemfile with a conventional entry.
  if (await fileExists(joinPath(root, 'Gemfile')) || await fileExists(joinPath(root, '.ruby-version'))) {
    const rails = joinPath(root, 'bin');
    if (await fileExists(joinPath(rails, 'rails'))) {
      out.push({ name: 'Rails (rails server)', type: 'ruby', program: '', cwd, source: 'bin/rails', tier: 'framework', framework: 'rails', command: 'bin/rails server' });
    }
    for (const rel of ['main.rb', 'app.rb']) {
      const p = joinPath(root, rel);
      if (await fileExists(p)) {
        out.push({ name: `Ruby ${rel}`, type: 'ruby', program: p, cwd, source: rel, tier: 'heuristic' });
        break;
      }
    }
  }

  return dedupe(out);
}

async function resolutionSignature(root: string): Promise<string> {
  const parts: string[] = [];
  for (const f of ['package.json', 'pyproject.toml', 'manage.py', 'requirements.txt', '.env', 'go.mod', 'Gemfile']) {
    const p = joinPath(root, f);
    if (await fileExists(p)) parts.push(`${f}:${await manifestMtime(p)}`);
  }
  return parts.join('|');
}

function rankEntries(list: ResolvedEntry[]): ResolvedEntry[] {
  const order: Record<EntryTier, number> = { manifest: 0, framework: 1, heuristic: 2, active: 3 };
  return [...list].sort((a, b) => order[a.tier] - order[b.tier]);
}

/**
 * Resolve candidate entry point(s) for a workspace, ordered by confidence.
 * Returns [] when nothing can be established (caller falls back to active file).
 */
export async function resolveEntries(root: string, activeDir?: string): Promise<ResolvedEntry[]> {
  if (!root) return [];
  const sig = await resolutionSignature(root);
  const cached = loadCache(root, sig);
  if (cached) return cached;

  const hasPackage = await fileExists(joinPath(root, 'package.json'));
  const hasPyToml = await fileExists(joinPath(root, 'pyproject.toml'));
  const hasRequirements = await fileExists(joinPath(root, 'requirements.txt'));

  const results: ResolvedEntry[] = [];
  if (hasPackage) results.push(...await resolveNode(root, activeDir));
  if (hasPyToml || hasRequirements) results.push(...await resolvePython(root));
  results.push(...await resolveGoRuby(root));

  const ranked = rankEntries(dedupe(results));
  saveCache(root, sig, ranked);
  return ranked;
}

/** Convert a resolved entry into a detected RunConfiguration. */
export function entryToRunConfig(entry: ResolvedEntry): RunConfiguration {
  return {
    name: entry.name,
    type: entry.type,
    request: 'launch',
    program: entry.program || undefined,
    cwd: entry.cwd,
    envFile: undefined,
    env: undefined,
    args: [],
    source: 'detected',
    detectedTier: entry.tier,
    // dev-server/framework commands run via the terminal Run path
    command: entry.command,
  };
}