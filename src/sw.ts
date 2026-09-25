/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
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

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Při první instalaci převezmeme i už otevřenou stránku – modely a běhové soubory
// se tak nacachují hned při prvním kreslení a aplikace pak jede offline.
clientsClaim();

// ——— Navigace: aplikace z precache + hlavičky pro izolaci originu ———
// Izolace (COOP/COEP) povolí vícevláknový WASM – na telefonu to je až několikanásobné zrychlení.
const appShell = createHandlerBoundToURL(`${BASE}index.html`);
registerRoute(
  new NavigationRoute(async (options) => {
    const res = await appShell(options);
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }),
);

// ——— Běhové soubory ONNX Runtime: po prvním použití fungují offline ———
registerRoute(
  ({ url }) => url.pathname.startsWith(`${BASE}ort/`),
  new CacheFirst({
    cacheName: 'omalovankarna-runtime-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 8 })],
  }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
