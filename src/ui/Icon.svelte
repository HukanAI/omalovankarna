<script lang="ts">
  import { ICONS, type IconName } from './icons';

  let { name, size = 24, stroke = 1.8, label }: { name: IconName; size?: number; stroke?: number; label?: string } =
    $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <path d={ICONS[name]} />
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
