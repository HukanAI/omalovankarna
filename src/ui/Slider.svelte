<script lang="ts">
  let {
    value = $bindable(0.5),
    label,
    min = 0,
    max = 1,
    step = 0.01,
    left,
    right,
    oninput,
    onchange,
  }: {
    value?: number;
    label: string;
    min?: number;
    max?: number;
    step?: number;
    left?: string;
    right?: string;
    oninput?: (v: number) => void;
    onchange?: (v: number) => void;
  } = $props();

  const pct = $derived(((value - min) / (max - min)) * 100);
</script>

<div class="slider">
  <div class="head">
    <span class="label">{label}</span>
  </div>
  <input
    type="range"
    {min}
    {max}
    {step}
    bind:value
    aria-label={label}
    style:--pct="{pct}%"
    oninput={() => oninput?.(value)}
    onchange={() => onchange?.(value)}
  />
  {#if left || right}
    <div class="ends" aria-hidden="true"><span>{left}</span><span>{right}</span></div>
  {/if}
</div>

<style>
  .slider {
    display: grid;
    gap: 6px;
  }
  .label {
    font-weight: 650;
  }
  input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 36px;
    background: transparent;
    margin: 0;
    touch-action: pan-y;
  }
  input::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--ink) var(--pct), var(--paper-3) var(--pct));
  }
  input::-moz-range-track {
    height: 8px;
    border-radius: 999px;
    background: var(--paper-3);
  }
  input::-moz-range-progress {
    height: 8px;
    border-radius: 999px;
    background: var(--ink);
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 30px;
    height: 30px;
    margin-top: -11px;
    border-radius: 50%;
    background: var(--card);
    border: 2px solid var(--ink);
    box-shadow: var(--shadow-1);
  }
  input::-moz-range-thumb {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--card);
    border: 2px solid var(--ink);
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: var(--ink-2);
    margin-top: -4px;
  }
</style>
