<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  type Props = HTMLButtonAttributes & {
    variant?: 'ink' | 'paper' | 'ghost' | 'crayon';
    size?: 'm' | 'l';
    icon?: IconName;
    block?: boolean;
    busy?: boolean;
    children?: Snippet;
  };

  let { variant = 'paper', size = 'm', icon, block = false, busy = false, children, ...rest }: Props = $props();
</script>

<button class="btn {variant} {size}" class:block class:busy disabled={rest.disabled || busy} {...rest}>
  {#if busy}
    <span class="spinner" aria-hidden="true"></span>
  {:else if icon}
    <Icon name={icon} size={size === 'l' ? 24 : 21} />
  {/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
</button>

<style>
  .btn {
    --bg: var(--card);
    --fg: var(--ink);
    --edge: var(--rule-strong);
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.55em;
    min-height: 48px;
    padding: 0 1.15em;
    border: 1.5px solid var(--edge);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font-weight: 650;
    font-size: 16.5px;
    letter-spacing: 0.005em;
    white-space: nowrap;
    /* „Kartonová“ hrana: tlačítko se při stisku zamáčkne. */
    box-shadow: 0 2px 0 var(--edge);
    transform: translateY(0);
    transition:
      transform 120ms var(--ease),
      box-shadow 120ms var(--ease),
      background-color 160ms var(--ease),
      opacity 160ms;
  }
  .btn:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: 0 0 0 var(--edge);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn.busy {
    opacity: 1;
  }
  .l {
    min-height: 58px;
    font-size: 18px;
    padding: 0 1.5em;
  }
  .block {
    display: flex;
    width: 100%;
  }
  .ink {
    --bg: var(--ink);
    --fg: var(--on-ink);
    --edge: color-mix(in srgb, var(--ink) 60%, #000);
    border-color: var(--ink);
  }
  .crayon {
    --bg: var(--crayon);
    --fg: #1d1712;
    --edge: color-mix(in srgb, var(--crayon) 65%, #3a1606);
    border-color: color-mix(in srgb, var(--crayon) 80%, #000);
  }
  .ghost {
    --bg: transparent;
    --edge: transparent;
    box-shadow: none;
    border-color: transparent;
  }
  .ghost:active:not(:disabled) {
    background: var(--paper-2);
    transform: none;
  }
  .spinner {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2.5px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
</style>
