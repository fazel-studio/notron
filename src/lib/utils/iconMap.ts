export const MATERIAL_ICON_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'react_ts',
  js: 'javascript',
  jsx: 'react',
  json: 'json',
  html: 'html',
  css: 'css',
  md: 'markdown',
  rs: 'rust',
  py: 'python',
  go: 'go',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  svelte: 'svelte',
  vue: 'vue',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'h',
  hpp: 'hpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sh: 'console',
  bat: 'console',
  ps1: 'powershell',
  sql: 'database',
  db: 'database',
  gitignore: 'git',
  env: 'tune',
  lock: 'lock',
  xml: 'xml',
};

export const MATERIAL_FOLDER_MAP: Record<string, string> = {
  src: 'folder-src',
  lib: 'folder-lib',
  components: 'folder-components',
  utils: 'folder-utils',
  stores: 'folder-store',
  assets: 'folder-images',
  public: 'folder-public',
  static: 'folder-public',
  node_modules: 'folder-node',
  '.git': 'folder-git',
  docs: 'folder-docs',
  api: 'folder-api',
  config: 'folder-config',
  scripts: 'folder-scripts',
};

export function getMaterialFileIcon(filename: string): string {
  const parts = filename.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toLowerCase() || '';
    if (MATERIAL_ICON_MAP[ext]) {
      return MATERIAL_ICON_MAP[ext];
    }
  }
  
  if (filename === 'package.json') return 'npm';
  if (filename === 'tsconfig.json') return 'tsconfig';
  if (filename.startsWith('vite.config')) return 'vite';
  if (filename.startsWith('svelte.config')) return 'svelte';
  if (filename.startsWith('tailwind.config')) return 'tailwindcss';
  
  return 'document';
}

export function getMaterialFolderIcon(foldername: string): string {
  const name = foldername.toLowerCase();
  if (MATERIAL_FOLDER_MAP[name]) {
    return MATERIAL_FOLDER_MAP[name];
  }
  return 'folder-base';
}
