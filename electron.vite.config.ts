import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

const projectRoot = resolve(__dirname);
const assetsDir = resolve(projectRoot, 'assets');

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith('.json')) return 'application/json; charset=utf-8';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function assetsPlugin(): Plugin {
  let rendererOutDir = '';

  return {
    name: 'desktop-pet-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (request, response, next) => {
        const urlPath = decodeURIComponent(request.url?.split('?')[0] ?? '/');
        const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
        const filePath = resolve(assetsDir, `.${safePath}`);

        if (!filePath.startsWith(assetsDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next();
          return;
        }

        response.setHeader('Content-Type', contentTypeFor(filePath));
        createReadStream(filePath).pipe(response);
      });
    },
    configResolved(config) {
      rendererOutDir = isAbsolute(config.build.outDir)
        ? config.build.outDir
        : resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (rendererOutDir && existsSync(assetsDir)) {
        cpSync(assetsDir, resolve(rendererOutDir, 'assets'), { recursive: true });
      }
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [preact(), assetsPlugin()],
    resolve: {
      alias: {
        '@renderer': resolve(projectRoot, 'src/renderer')
      }
    }
  }
});
