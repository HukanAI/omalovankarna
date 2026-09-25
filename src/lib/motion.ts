/**
 * Délky animací s ohledem na „omezit pohyb“ v systému.
 * Svelte přechody běží přes Web Animations API, na které globální CSS pravidlo nedosáhne.
 */
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function ms(duration: number): number {
  return query?.matches ? 0 : duration;
}
