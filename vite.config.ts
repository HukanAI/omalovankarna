import { defaultClientConditions, defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_PATH ?? '/omalovankarna/';
const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string };
const version = `${pkg.version} (${new Date().toISOString().slice(0, 10)})`;
const ortSize = (f: string) => statSync(`${root}node_modules/onnxruntime-web/dist/${f}`).size;
const ortSizes = {
  wasm: ortSize('ort-wasm-simd-threaded.wasm'),
  webgpu: ortSize('ort-wasm-simd-threaded.asyncify.wasm'),
};

/** Běhové soubory ONNX Runtime (WASM) se servírují z vlastního originu. */
function ortRuntime(): Plugin {
  const files = [
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.asyncify.wasm',
    'ort-wasm-simd-threaded.asyncify.mjs',
  ];
  const copy = () => {
    mkdirSync(`${root}public/ort`, { recursive: true });
    for (const f of files) copyFileSync(`${root}node_modules/onnxruntime-web/dist/${f}`, `${root}public/ort/${f}`);
  };
  return { name: 'ort-runtime', buildStart: copy, configureServer: copy };
}

// Izolace originu povolí vícevláknový WASM (v produkci hlavičky doplňuje service worker).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: BASE,
  plugins: [
    ortRuntime(),
    svelte(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
        globIgnores: ['ort/**', 'models/**', '**/*vietnamese*', '**/*cyrillic*', '**/*greek*'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
      manifest: {
        id: BASE,
        name: 'Omalovánkárna',
        short_name: 'Omalovánkárna',
        description: 'Z fotky omalovánka přímo v telefonu. Bez internetu, bez účtu, zdarma.',
        lang: 'cs',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f0e4',
        theme_color: '#f6f0e4',
        categories: ['kids', 'education', 'photo', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/monochrome.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'monochrome' },
        ],
        shortcuts: [
          {
            name: 'Nová omalovánka',
            short_name: 'Nová',
            url: `${BASE}?new=1`,
            icons: [{ src: 'icons/shortcut-new.png', sizes: '96x96', type: 'image/png' }],
          },
        ],
        share_target: {
          action: `${BASE}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'photo', accept: ['image/*'] }] },
        },
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(version), __ORT_SIZES__: JSON.stringify(ortSizes) },
  resolve: {
    alias: { $lib: `${root}src/lib` },
    // Varianta ORT bez přibaleného WASM – binárky se berou z public/ort (viz ortRuntime).
    conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  server: { headers: isolation },
  preview: { headers: isolation },
});
