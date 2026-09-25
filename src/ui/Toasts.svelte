<script lang="ts">
  import { ms } from '$lib/motion';
  import { fly } from 'svelte/transition';
  import { dismiss, toasts } from '../app/toast.svelte';
</script>

<div class="stack" aria-live="polite">
  {#each toasts as t (t.id)}
    <div class="toast" class:error={t.tone === 'error'} transition:fly={{ y: 24, duration: ms(240) }}>
      <span>{t.text}</span>
      {#if t.action}
        <button
          onclick={() => {
            t.action!.run();
            dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(16px + var(--safe-b));
    z-index: 60;
    display: grid;
    gap: 8px;
    justify-items: center;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 520px;
    padding: 12px 12px 12px 18px;
    border-radius: var(--r-m);
    background: var(--ink);
    color: var(--on-ink);
    box-shadow: var(--shadow-2);
    font-size: 15.5px;
  }
  .error {
    background: #7a2b16;
    color: #fff4ee;
  }
  button {
    border: 0;
    background: transparent;
    color: var(--ochre);
    font-weight: 700;
    padding: 8px 10px;
    border-radius: 8px;
  }
</style>
