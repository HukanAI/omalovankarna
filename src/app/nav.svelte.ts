export type Route =
  | { name: 'home' }
  | { name: 'create'; photo?: Blob; pageId?: string }
  | { name: 'color'; pageId: string }
  | { name: 'about' };

export const nav = $state<{ route: Route; depth: number }>({ route: { name: 'home' }, depth: 0 });

const stack: Route[] = [];

function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    doc.startViewTransition(update);
  } else {
    update();
  }
}

/** Přejde na obrazovku a zapíše krok do historie (systémové „zpět“ pak funguje). */
export function go(route: Route): void {
  stack.push(nav.route);
  history.pushState({ depth: stack.length }, '');
  transition(() => {
    nav.route = route;
    nav.depth = stack.length;
  });
}

/** Nahradí aktuální obrazovku bez nového kroku v historii. */
export function replace(route: Route): void {
  transition(() => (nav.route = route));
}

export function back(): void {
  if (stack.length) history.back();
  else replace({ name: 'home' });
}

if (typeof window !== 'undefined') {
  history.replaceState({ depth: 0 }, '');
  window.addEventListener('popstate', () => {
    const prev = stack.pop() ?? { name: 'home' };
    transition(() => {
      nav.route = prev;
      nav.depth = stack.length;
    });
  });
}
