<script lang="ts">
  import { ms } from '$lib/motion';
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';

  let {
    open = $bindable(false),
    title,
    children,
    onclose,
  }: { open?: boolean; title: string; children: Snippet; onclose?: () => void } = $props();

  let panel: HTMLDivElement | undefined = $state();
  let dragY = $state(0);
  let startY = 0;
  let dragging = $state(false);

  function close() {
    open = false;
    onclose?.();
  }

  function slideUp(_node: HTMLElement) {
    return {
      duration: ms(320),
      css: (t: number) => {
        const e = 1 - Math.pow(1 - t, 3);
        return `transform: translateY(${(1 - e) * 100}%)`;
      },
    };
  }

  // Zavření tažením dolů za úchyt – jako u nativních listů.
  function onDown(e: PointerEvent) {
    dragging = true;
    startY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (dragging) dragY = Math.max(0, e.clientY - startY);
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (dragY > (panel?.offsetHeight ?? 300) * 0.28) close();
    dragY = 0;
  }

  $effect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    panel?.focus();
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if open}
  <div class="scrim" transition:fade={{ duration: ms(200) }} onclick={close} aria-hidden="true"></div>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
    bind:this={panel}
    transition:slideUp
    style:transform={dragY ? `translateY(${dragY}px)` : undefined}
    style:transition={dragging ? 'none' : undefined}
  >
    <div
      class="grip"
      role="button"
      tabindex="-1"
      aria-label="Zavřít"
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onUp}
      onkeydown={(e) => e.key === 'Enter' && close()}
    >
      <span></span>
    </div>
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 40;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    max-height: 88dvh;
    overflow: auto;
    margin: 0 auto;
    max-width: 560px;
    padding: 0 20px calc(20px + var(--safe-b));
    background: var(--paper);
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    box-shadow: var(--shadow-2);
    outline: none;
    transition: transform 260ms var(--ease);
  }
  .sheet::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-image: var(--grain);
    opacity: var(--grain-opacity);
    pointer-events: none;
  }
  .grip {
    display: grid;
    place-items: center;
    height: 28px;
    touch-action: none;
    cursor: grab;
  }
  .grip span {
    width: 44px;
    height: 5px;
    border-radius: 3px;
    background: var(--rule-strong);
  }
  h2 {
    font-size: 24px;
    margin: 4px 0 16px;
  }
  .body {
    position: relative;
  }
</style>
