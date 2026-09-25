<script lang="ts">
  import { curvePath, ringsPath, strokeGroups } from '../engine/svg';
  import type { Drawing, Stroke } from '../engine/types';

  let {
    drawing,
    reveal = null,
    animate = false,
    colorLayer = null,
    ondone,
  }: {
    drawing: Drawing;
    reveal?: Stroke[] | null;
    animate?: boolean;
    /** Vybarvení (obrázek pod čarami), pokud existuje. */
    colorLayer?: string | null;
    ondone?: () => void;
  } = $props();

  const uid = `dv${Math.random().toString(36).slice(2, 8)}`;
  const TOTAL_MS = 2300;

  const rings = $derived(ringsPath(drawing));
  const groups = $derived(strokeGroups(drawing));

  function polyLen(pts: number[]) {
    let l = 0;
    for (let i = 2; i < pts.length; i += 2) l += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return l;
  }

  /** Časování tahů: celkem ~2,3 s, delší tahy trvají déle, začátky se překrývají. */
  const timeline = $derived.by(() => {
    if (!animate || !reveal?.length) return [];
    // Délka tahu určuje jeho trvání; další tah začne v polovině předchozího.
    const items = reveal.map((s) => {
      const len = polyLen(s.pts);
      return { d: curvePath(s.pts, s.closed), dur: Math.sqrt(len) + 4 };
    });
    let t = 0;
    const raw = items.map((it) => {
      const start = t;
      t += it.dur * 0.5;
      return start;
    });
    const total = t + (items.at(-1)?.dur ?? 0) * 0.5 || 1;
    const k = TOTAL_MS / total;
    return items.map((it, i) => ({ d: it.d, delay: raw[i] * k, dur: Math.max(120, it.dur * k) }));
  });

  let done = $state(false);
  $effect(() => {
    if (!animate || !timeline.length) {
      done = true;
      return;
    }
    done = false;
    const end = Math.max(...timeline.map((t) => t.delay + t.dur)) + 60;
    const id = setTimeout(() => {
      done = true;
      ondone?.();
    }, end);
    return () => clearTimeout(id);
  });

  const maskWidth = $derived(drawing.lineWidth * 3.2 + 3);
</script>

<svg
  class="drawing"
  viewBox="0 0 {drawing.w} {drawing.h}"
  preserveAspectRatio="xMidYMid meet"
  role="img"
  aria-label="Omalovánka"
>
  {#if colorLayer}
    <image href={colorLayer} x="0" y="0" width={drawing.w} height={drawing.h} preserveAspectRatio="none" />
  {/if}
  {#if !done}
    <defs>
      <mask id="{uid}-m" maskUnits="userSpaceOnUse" x="0" y="0" width={drawing.w} height={drawing.h}>
        <g fill="none" stroke="#fff" stroke-width={maskWidth} stroke-linecap="round" stroke-linejoin="round">
          {#each timeline as t, i (i)}
            <path
              d={t.d}
              pathLength="1"
              class="draw"
              style:animation-duration="{t.dur}ms"
              style:animation-delay="{t.delay}ms"
            />
          {/each}
        </g>
      </mask>
    </defs>
  {/if}
  <g class="ink">
    <path d={rings} fill-rule="evenodd" mask={done ? undefined : `url(#${uid}-m)`} />
    <g
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
      class:late={!done}
    >
      {#each groups as g (g.width)}
        <path d={g.d} stroke-width={g.width} />
      {/each}
    </g>
  </g>
</svg>

<style>
  .drawing {
    display: block;
    width: 100%;
    height: 100%;
  }
  .ink {
    fill: #1d1a17;
    stroke: #1d1a17;
  }
  .ink :global(g) {
    fill: none;
  }
  .draw {
    stroke-dasharray: 1 1;
    stroke-dashoffset: 1;
    animation-name: draw;
    animation-timing-function: cubic-bezier(0.45, 0.05, 0.35, 1);
    animation-fill-mode: forwards;
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  /* Obrys a dotažené mezery naskočí až ke konci kresby. */
  .late {
    opacity: 0;
    animation: appear 500ms 1900ms var(--ease) forwards;
  }
  @keyframes appear {
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .draw {
      stroke-dashoffset: 0;
    }
    .late {
      opacity: 1;
    }
  }
</style>
