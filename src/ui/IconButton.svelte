<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  type Props = HTMLButtonAttributes & { icon: IconName; label: string; active?: boolean; tone?: 'plain' | 'sheet' };
  let { icon, label, active = false, tone = 'plain', ...rest }: Props = $props();
</script>

<button class="ib {tone}" class:active aria-label={label} title={label} {...rest}>
  <Icon name={icon} />
</button>

<style>
  .ib {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    color: var(--ink);
    transition:
      background-color 140ms var(--ease),
      transform 140ms var(--ease),
      color 140ms;
  }
  .sheet {
    background: var(--card);
    box-shadow: var(--shadow-1);
  }
  .ib:active:not(:disabled) {
    transform: scale(0.92);
    background: var(--paper-2);
  }
  .ib:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .active {
    background: var(--ink);
    color: var(--on-ink);
  }
  .active:active:not(:disabled) {
    background: var(--ink);
  }
</style>
