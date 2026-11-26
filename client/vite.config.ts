import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function normalizeViteBase(rawBase?: string): string {
  const trimmed = (rawBase ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, ROOT_DIR, '');
  const rawBasePath = process.env.VITE_BASE_PATH ?? rootEnv.VITE_BASE_PATH;

  return {
    base: normalizeViteBase(rawBasePath),
    envDir: ROOT_DIR,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
