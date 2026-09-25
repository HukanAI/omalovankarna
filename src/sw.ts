/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { addPlugins, addRoute, cleanupOutdatedCaches, createHandlerBoundToURL, precache } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const BASE = import.meta.env.BASE_URL;
export const INBOX_CACHE = 'omalovankarna-inbox';

// ——— Sdílení fotky z jiné aplikace (Android „Sdílet → Omalovánkárna“) ———
// Musí být zaregistrováno před Workboxem, aby POST nezachytil jiný handler.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.get('photo');
        if (file instanceof File) {
          const inbox = await caches.open(INBOX_CACHE);
          await inbox.put(`${BASE}inbox/photo`, new Response(file, { headers: { 'content-type': file.type } }));
        }
      } catch {
        // Nepodařilo se převzít soubor – aplikace se aspoň otevře.
      }
      return Response.redirect(`${BASE}?share=1`, 303);
    })(),
  );
});

// ——— Izolace originu (COOP/COEP) ———
// Povolí SharedArrayBuffer, a tedy vícevláknový WASM – na telefonu až několikanásobné
// zrychlení. GitHub Pages hlavičky nastavit neumí, doplňuje je proto service worker
// všem odpovědím, které obsluhuje (dokument i skript workeru musí být izolované).
function isolate(res: Response): Response {
  if (res.type === 'opaque' || res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
const isolationPlugin = {
  cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) =>
    cachedResponse ? isolate(cachedResponse) : cachedResponse,
};

addPlugins([isolationPlugin]);
precache(self.__WB_MANIFEST);
// Navigace musí mít routu dřív než precache, jinak by index.html
// odešel bez izolačních hlaviček.
const appShell = createHandlerBoundToURL(`${BASE}index.html`);
registerRoute(new NavigationRoute(async (options) => isolate(await appShell(options))));
addRoute();
cleanupOutdatedCaches();
// Při první instalaci převezmeme i už otevřenou stránku – modely a běhové soubory
// se tak nacachují hned při prvním kreslení a aplikace pak jede offline.
clientsClaim();

// ——— Běhové soubory ONNX Runtime: po prvním použití fungují offline ———
registerRoute(
  ({ url }) => url.pathname.startsWith(`${BASE}ort/`),
  new CacheFirst({
    cacheName: 'omalovankarna-runtime-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 8 }), isolationPlugin],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
