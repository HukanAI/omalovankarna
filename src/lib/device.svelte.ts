/** Drobnosti o zařízení: instalace, iOS, haptika, síť. */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

export const device = $state({
  standalone:
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true),
  canInstall: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
});

let deferred: BeforeInstallPromptEvent | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    device.canInstall = true;
  });
  window.addEventListener('appinstalled', () => {
    device.canInstall = false;
    device.standalone = true;
    deferred = null;
  });
  window.addEventListener('online', () => (device.online = true));
  window.addEventListener('offline', () => (device.online = false));
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  device.canInstall = false;
  return outcome === 'accepted';
}

/** Krátké cvaknutí (jen Android; iOS vibrace z webu nepovoluje). */
export function haptic(kind: 'tap' | 'success' = 'tap'): void {
  try {
    navigator.vibrate?.(kind === 'tap' ? 8 : [10, 40, 18]);
  } catch {
    /* nepodporováno */
  }
}

/** Menší plátno na slabších telefonech. */
export function canvasLongSide(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return mem <= 2 ? 1400 : mem <= 4 ? 1800 : 2200;
}
