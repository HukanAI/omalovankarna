<script lang="ts">
  let {
    checked = $bindable(false),
    label,
    hint,
    disabled = false,
    onchange,
  }: { checked?: boolean; label: string; hint?: string; disabled?: boolean; onchange?: (v: boolean) => void } =
    $props();
  const id = `sw-${Math.random().toString(36).slice(2, 8)}`;
</script>

<label class="row" for={id} class:disabled>
  <span class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
  <input
    {id}
    type="checkbox"
    role="switch"
    bind:checked
    {disabled}
    onchange={() => onchange?.(checked)}
  />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
</label>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 56px;
    cursor: pointer;
    position: relative;
  }
  .disabled {
    opacity: 0.5;
    cursor: default;
  }
  .text {
    flex: 1;
    display: grid;
    gap: 2px;
  }
  .label {
    font-weight: 650;
  }
  .hint {
    font-size: 14.5px;
    color: var(--ink-2);
  }
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .track {
    flex: none;
    width: 52px;
    height: 32px;
    border-radius: 999px;
    background: var(--paper-3);
    border: 1.5px solid var(--rule-strong);
    position: relative;
    transition: background-color 200ms var(--ease);
  }
  .thumb {
    position: absolute;
    top: 2.5px;
    left: 2.5px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--card);
    box-shadow: var(--shadow-1);
    transition: transform 260ms var(--ease-spring);
  }
  input:checked + .track {
    background: var(--ink);
    border-color: var(--ink);
  }
  input:checked + .track .thumb {
    transform: translateX(20px);
  }
  input:focus-visible + .track {
    outline: 2.5px solid var(--focus);
    outline-offset: 3px;
  }
</style>
