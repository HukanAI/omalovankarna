import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import { toast } from './app/toast.svelte';
import './ui/theme.css';

const app = mount(App, { target: document.getElementById('app')! });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast('Je tu nová verze Omalovánkárny.', {
        ms: 20_000,
        action: { label: 'Aktualizovat', run: () => void updateSW(true) },
      });
    },
    onOfflineReady() {
      toast('Omalovánkárna je připravená i bez internetu.');
    },
  });

  // Vícevláknové výpočty potřebují izolovaný origin, který zajistí až service worker.
  // Při úplně první návštěvě proto stránku jednou tiše obnovíme, jakmile převezme řízení.
  if (!self.crossOriginIsolated) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      try {
        if (sessionStorage.getItem('coi-reload')) return;
        sessionStorage.setItem('coi-reload', '1');
      } catch {
        return;
      }
      if (history.state?.depth === 0) location.reload();
    });
  }
}

export default app;
