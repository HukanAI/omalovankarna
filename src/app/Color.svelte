<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { Painter } from '../color/painter';
  import { PALETTE } from '../color/palette';
  import { getPage, putPage, trackSave, type PageRecord } from '$lib/db';
  import { canvasLongSide, haptic } from '$lib/device.svelte';
  import { renderThumb } from '$lib/render';
  import ExportSheet from '../ui/ExportSheet.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import type { IconName } from '../ui/icons';
  import { back } from './nav.svelte';
  import { toast } from './toast.svelte';

  let { pageId }: { pageId: string } = $props();

  type Tool = 'bucket' | 'pencil' | 'eraser';
  const tools: { id: Tool; icon: IconName; label: string }[] = [
    { id: 'bucket', icon: 'bucket', label: 'Kyblík' },
    { id: 'pencil', icon: 'pencil', label: 'Pastelka' },
    { id: 'eraser', icon: 'eraser', label: 'Guma' },
  ];
  const sizes = [0.008, 0.018, 0.036];

  let record = $state<PageRecord | null>(null);
  let colorCanvas: HTMLCanvasElement | undefined = $state();
  let lineCanvas: HTMLCanvasElement | undefined = $state();
  let viewport: HTMLDivElement | undefined = $state();
  let painter: Painter | null = null;

  let tool = $state<Tool>('bucket');
  let colorIdx = $state(3);
  let sizeIdx = $state(1);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let dirty = false;
  let showName = $state(false);
  let exportOpen = $state(false);
  let exportBlob = $state<Blob | null>(null);
  let ready = $state(false);

  // Přiblížení a posun.
  let zoom = $state(1);
  let tx = $state(0);
  let ty = $state(0);

  onMount(async () => {
    const rec = await getPage(pageId);
    if (!rec) return back();
    record = rec;
    await Promise.resolve();
    painter = new Painter(rec.drawing, canvasLongSide(), colorCanvas!, lineCanvas!);
    await painter.load(rec.colored);
    painter.onchange = () => {
      canUndo = painter!.canUndo;
      canRedo = painter!.canRedo;
      dirty = true;
      scheduleSave();
    };
    ready = true;
  });

  onDestroy(() => {
    clearTimeout(saveTimer);
    if (dirty) void trackSave(save());
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1500);
  }

  async function save() {
    if (!painter || !record || !dirty) return;
    dirty = false;
    try {
      await saveNow();
    } catch (e) {
      console.error(e);
      dirty = true;
      toast('Vybarvení se nepodařilo uložit.', { tone: 'error' });
    }
  }

  async function saveNow() {
    if (!painter || !record) return;
    const colored = await painter.export();
    const next: PageRecord = {
      ...record,
      colored,
      updatedAt: Date.now(),
      thumb: await renderThumb(record.drawing, colored),
    };
    record = next;
    await putPage($state.snapshot(next) as PageRecord);
  }

  async function openExport() {
    if (!painter) return;
    exportBlob = await painter.export();
    exportOpen = true;
  }

  function pickColor(i: number) {
    colorIdx = i;
    if (tool === 'eraser') tool = 'pencil';
    haptic();
    showName = true;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => (showName = false), 1400);
  }
  let nameTimer: ReturnType<typeof setTimeout> | undefined;

  // ——— Dotyky: jeden prst kreslí, dva prsty přibližují ———

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { d: number; cx: number; cy: number; zoom: number; tx: number; ty: number } | null = null;
  let tapStart: { x: number; y: number; t: number } | null = null;
  let stroking = false;

  function toCanvas(e: PointerEvent): { x: number; y: number } {
    const r = colorCanvas!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * painter!.w, y: ((e.clientY - r.top) / r.height) * painter!.h };
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  function onDown(e: PointerEvent) {
    if (!painter) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      if (stroking) {
        painter.cancelStroke();
        stroking = false;
      }
      tapStart = null;
      gesture = { ...pinchState(), zoom, tx, ty };
      return;
    }
    if (pointers.size > 2) return;
    tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (tool !== 'bucket') {
      const p = toCanvas(e);
      const width = sizes[sizeIdx] * Math.max(painter.w, painter.h) * (tool === 'eraser' ? 1.6 : 1);
      painter.beginStroke(p.x, p.y, PALETTE[colorIdx].hex, width, tool === 'eraser', e.pressure);
      stroking = true;
    }
  }

  function onMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId) || !painter) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture && pointers.size === 2) {
      const now = pinchState();
      const nz = Math.min(6, Math.max(1, gesture.zoom * (now.d / gesture.d)));
      const rect = viewport!.getBoundingClientRect();
      // Bod mezi prsty zůstane pod prsty.
      const ox = gesture.cx - rect.left - rect.width / 2;
      const oy = gesture.cy - rect.top - rect.height / 2;
      tx = now.cx - rect.left - rect.width / 2 - ((ox - gesture.tx) * nz) / gesture.zoom;
      ty = now.cy - rect.top - rect.height / 2 - ((oy - gesture.ty) * nz) / gesture.zoom;
      if (nz === 1) {
        tx = 0;
        ty = 0;
      }
      zoom = nz;
      return;
    }
    if (stroking) {
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const p = toCanvas(ev);
        painter.extendStroke(p.x, p.y, ev.pressure);
      }
    }
  }

  function onUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId) || !painter) return;
    pointers.delete(e.pointerId);
    if (gesture) {
      if (pointers.size < 2) gesture = null;
      return;
    }
    if (stroking) {
      painter.endStroke();
      stroking = false;
      return;
    }
    if (tool === 'bucket' && tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 14) {
      const p = toCanvas(e);
      if (painter.fill(p.x, p.y, PALETTE[colorIdx].hex)) haptic();
    }
    tapStart = null;
  }

  function resetZoom() {
    zoom = 1;
    tx = 0;
    ty = 0;
  }

  function undo() {
    painter?.undo();
    haptic();
  }
  function redo() {
    painter?.redo();
    haptic();
  }

  function leave() {
    // Uloží se v onDestroy na pozadí; další obrazovka na uložení počká.
    back();
  }

  const aspect = $derived(record ? record.drawing.w / record.drawing.h : 3 / 4);
</script>

<div class="color">
  <header>
    <IconButton icon="back" label="Hotovo, zpět" onclick={leave} />
    <h1>Vybarvování</h1>
    <IconButton icon="undo" label="Zpět o krok" disabled={!canUndo} onclick={undo} />
    <IconButton icon="redo" label="Znovu" disabled={!canRedo} onclick={redo} />
    <IconButton icon="download" label="Uložit a tisknout" disabled={!ready} onclick={openExport} />
  </header>

  <div
    class="viewport"
    bind:this={viewport}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    ondblclick={resetZoom}
    role="application"
    aria-label="Plátno omalovánky. Kyblíkem klepněte do plochy, pastelkou táhněte prstem."
  >
    <div
      class="sheet"
      style:aspect-ratio={aspect}
      style:width="min(100%, calc((100dvh - 290px) * {aspect}))"
      style:transform="translate({tx}px, {ty}px) scale({zoom})"
    >
      <canvas bind:this={colorCanvas} class="layer"></canvas>
      <canvas bind:this={lineCanvas} class="layer lines"></canvas>
      {#if !ready}<div class="loading" transition:fade></div>{/if}
    </div>
    {#if zoom > 1.05}
      <button class="zoom-reset" onclick={resetZoom} transition:fade>Zobrazit celé</button>
    {/if}
  </div>

  <footer>
    <div class="toolrow">
      <div class="tools" role="radiogroup" aria-label="Nástroj">
        {#each tools as t (t.id)}
          <button
            role="radio"
            aria-checked={tool === t.id}
            class:on={tool === t.id}
            onclick={() => {
              tool = t.id;
              haptic();
            }}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        {/each}
      </div>
      {#if tool !== 'bucket'}
        <div class="sizes" role="radiogroup" aria-label="Tloušťka" transition:fade={{ duration: 120 }}>
          {#each sizes as _, i (i)}
            <button role="radio" aria-checked={sizeIdx === i} class:on={sizeIdx === i} onclick={() => (sizeIdx = i)} aria-label={['Tenká', 'Střední', 'Silná'][i]}>
              <span style:width="{6 + i * 7}px" style:height="{6 + i * 7}px"></span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="palette-wrap">
      {#if showName}
        <span class="color-name" transition:fade={{ duration: 150 }}>{PALETTE[colorIdx].name}</span>
      {/if}
      <div class="palette" role="radiogroup" aria-label="Barva">
        {#each PALETTE as c, i (c.hex)}
          <button
            role="radio"
            aria-checked={colorIdx === i}
            aria-label={c.name}
            class:on={colorIdx === i}
            style:--c={c.hex}
            onclick={() => pickColor(i)}
          ></button>
        {/each}
      </div>
    </div>
  </footer>
</div>

{#if record && exportBlob !== undefined}
  <ExportSheet bind:open={exportOpen} drawing={record.drawing} colored={exportBlob} />
{/if}

<style>
  .color {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    height: 100dvh;
    max-width: 900px;
    margin: 0 auto;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    padding: calc(4px + var(--safe-t)) 6px 0;
    min-height: 60px;
  }
  h1 {
    flex: 1;
    font-size: 20px;
    padding-left: 4px;
  }
  .viewport {
    position: relative;
    display: grid;
    place-items: center;
    padding: 10px 14px;
    touch-action: none;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .sheet {
    position: relative;
    background: var(--sheet);
    border-radius: 4px;
    box-shadow: var(--shadow-sheet);
    transform-origin: center;
    will-change: transform;
  }
  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .lines {
    pointer-events: none;
  }
  .loading {
    position: absolute;
    inset: 0;
    background: var(--sheet);
  }
  .zoom-reset {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    border: 0;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font-weight: 650;
    font-size: 14.5px;
    box-shadow: var(--shadow-2);
  }
  footer {
    display: grid;
    gap: 10px;
    padding: 10px 12px calc(12px + var(--safe-b));
    border-top: 1px solid var(--rule);
    background: var(--paper);
  }
  .toolrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 56px;
  }
  .tools {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--paper-2);
    border-radius: 999px;
  }
  .tools button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 46px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    font-weight: 650;
    font-size: 15px;
  }
  .tools button.on {
    background: var(--ink);
    color: var(--on-ink);
  }
  @media (max-width: 400px) {
    .tools button span {
      display: none;
    }
  }
  .sizes {
    display: flex;
    gap: 2px;
  }
  .sizes button {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
  }
  .sizes span {
    display: block;
    border-radius: 50%;
    background: var(--ink-3);
  }
  .sizes .on span {
    background: var(--ink);
    box-shadow: 0 0 0 3px var(--paper), 0 0 0 5px var(--ink);
  }
  .palette-wrap {
    position: relative;
  }
  .color-name {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--on-ink);
    font-family: var(--font-display);
    font-variation-settings: 'SOFT' 100;
    font-size: 16px;
    white-space: nowrap;
    pointer-events: none;
  }
  .palette {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding: 8px 4px 6px;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }
  .palette::-webkit-scrollbar {
    display: none;
  }
  .palette button {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 0;
    background: var(--c);
    box-shadow:
      inset 0 -3px 0 rgb(0 0 0 / 0.14),
      0 0 0 1.5px rgb(35 31 27 / 0.18);
    scroll-snap-align: center;
    transition: transform 160ms var(--ease-spring);
  }
  .palette button.on {
    transform: translateY(-4px) scale(1.08);
    box-shadow:
      inset 0 -3px 0 rgb(0 0 0 / 0.14),
      0 0 0 3px var(--paper),
      0 0 0 5.5px var(--ink);
  }
</style>
