<script lang="ts">
  import type { Level } from '../engine/presets';

  let {
    value = $bindable<Level>('skolaci'),
    compact = false,
    onchange,
  }: { value?: Level; compact?: boolean; onchange?: (l: Level) => void } = $props();

  const levels: { id: Level; title: string; age: string }[] = [
    { id: 'mali', title: 'Malí umělci', age: '3–5 let' },
    { id: 'skolaci', title: 'Školáci', age: '6–9 let' },
    { id: 'zkuseni', title: 'Zkušení', age: '10+ a dospělí' },
  ];

  function pick(id: Level) {
    if (id === value) return;
    value = id;
    onchange?.(id);
  }
</script>

<div class="levels" class:compact role="radiogroup" aria-label="Pro koho je omalovánka">
  {#each levels as l (l.id)}
    <button
      type="button"
      role="radio"
      aria-checked={value === l.id}
      class:on={value === l.id}
      onclick={() => pick(l.id)}
    >
      <svg viewBox="0 0 48 36" aria-hidden="true" class="glyph">
        <!-- Stejný motiv s přibývajícími detaily. -->
        <path d="M8 30 Q10 8 24 7 Q38 8 40 30 Z" />
        {#if l.id !== 'mali'}
          <path d="M16 20 q2-3 4 0 M28 20 q2-3 4 0 M21 25 q3 2 6 0" />
        {:else}
          <path d="M18 20 v1 M30 20 v1" />
        {/if}
        {#if l.id === 'zkuseni'}
          <path d="M12 14 l3 2 M14 10 l2 3 M36 14 l-3 2 M34 10 l-2 3 M19 12 q5-3 10 0" />
        {/if}
      </svg>
      <span class="title">{l.title}</span>
      <span class="age">{l.age}</span>
    </button>
  {/each}
</div>

<style>
  .levels {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  button {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 10px 6px 11px;
    border-radius: var(--r-m);
    border: 1.5px solid var(--rule-strong);
    background: var(--card);
    color: var(--ink);
    box-shadow: 0 2px 0 var(--rule-strong);
    transition:
      transform 140ms var(--ease),
      box-shadow 140ms var(--ease),
      border-color 140ms,
      background-color 140ms;
  }
  button:active {
    transform: translateY(2px);
    box-shadow: 0 0 0 var(--rule-strong);
  }
  .on {
    border-color: var(--ink);
    background: var(--crayon-soft);
    box-shadow: 0 2px 0 var(--ink);
  }
  .glyph {
    width: 44px;
    height: 33px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    margin-bottom: 2px;
  }
  .on .glyph path:first-child {
    fill: color-mix(in srgb, var(--crayon) 45%, transparent);
  }
  .title {
    font-weight: 700;
    font-size: 15px;
    line-height: 1.15;
  }
  .age {
    font-size: 13px;
    color: var(--ink-2);
  }
  .compact button {
    padding: 8px 4px;
  }
  .compact .glyph,
  .compact .age {
    display: none;
  }
</style>
