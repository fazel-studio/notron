import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from '@tailwindcss/vite'

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [tailwindcss(), svelte()],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Pre-bundle dependency berat saat dev server start, bukan saat browser request pertama
  // Ini menghilangkan blank white screen dan "Not Responding" di dev mode
  optimizeDeps: {
    include: [
      '@codemirror/view',
      '@codemirror/state',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/search',
      '@codemirror/autocomplete',
      '@codemirror/lang-javascript',
      '@codemirror/lang-python',
      '@codemirror/lang-html',
      '@codemirror/lang-css',
      '@codemirror/lang-json',
      '@codemirror/lang-markdown',
      '@codemirror/lang-rust',
      '@codemirror/lang-cpp',
      '@codemirror/lang-java',
      '@codemirror/lang-go',
      '@codemirror/lang-sql',
      '@codemirror/lang-xml',
      '@codemirror/lang-php',
      '@codemirror/theme-one-dark',
      'marked',
    ],
    // Exclude mermaid dari pre-bundle karena sudah lazy loaded
    exclude: ['mermaid'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Pisahkan mermaid ke chunk terpisah (lazy loaded)
          'mermaid': ['mermaid'],
          // Pisahkan CodeMirror core ke chunk terpisah
          'codemirror': [
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/language',
            '@codemirror/commands',
            '@codemirror/search',
            '@codemirror/autocomplete',
            '@codemirror/theme-one-dark',
            '@replit/codemirror-minimap',
          ],
        },
      },
    },
  },
}));
