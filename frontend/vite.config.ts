import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Plugin } from 'vite';

const buildId = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return Date.now().toString(36);
  }
})();

function versionJsonPlugin(): Plugin {
  return {
    name: 'vite-plugin-version-json',
    closeBundle() {
      const outDir = join(process.cwd(), 'dist');
      try { mkdirSync(outDir, { recursive: true }); } catch {}
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ buildId }));
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
});
