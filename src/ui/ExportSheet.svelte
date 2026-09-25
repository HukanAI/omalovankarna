<script lang="ts">
  import { drawingToSvg } from '../engine/svg';
  import type { Drawing } from '../engine/types';
  import { renderPng } from '$lib/render';
  import { fileName, saveToDevice, shareFile, type ShareResult } from '$lib/share';
  import { haptic } from '$lib/device.svelte';
  import { toast } from '../app/toast.svelte';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';
  import Switch from './Switch.svelte';
  import type { IconName } from './icons';

  let {
    open = $bindable(false),
    drawing,
    colored = null,
  }: { open?: boolean; drawing: Drawing; colored?: Blob | null } = $props();

  let withColor = $state(true);
  let working = $state<string | null>(null);
  const useColor = $derived(!!colored && withColor);

  type Action = { id: string; icon: IconName; title: string; hint: string; run: () => Promise<ShareResult> };

  const actions: Action[] = [
    {
      id: 'png',
      icon: 'download',
      title: 'Uložit do telefonu',
      hint: 'Obrázek na A4, ostrý i při tisku',
      run: async () => saveToDevice(await renderPng(drawing, { layout: 'a4', colored: useColor ? colored : null }), fileName('png')),
    },
    {
      id: 'pdf',
      icon: 'printer',
      title: 'PDF k tisku',
      hint: 'A4 s okraji, čáry ve vektorech',
      run: async () => {
        const { makePdf } = await import('$lib/pdf');
        return saveToDevice(await makePdf([{ drawing, colored: useColor ? colored : null }]), fileName('pdf'));
      },
    },
    {
      id: 'share',
      icon: 'share',
      title: 'Poslat…',
      hint: 'Babičce, do školky, do tiskárny',
      run: async () =>
        shareFile(await renderPng(drawing, { layout: 'a4', colored: useColor ? colored : null }), fileName('png'), 'Omalovánka'),
    },
    {
      id: 'svg',
      icon: 'vector',
      title: 'Vektor SVG',
      hint: 'Pro úpravy v grafickém programu',
      run: async () =>
        saveToDevice(new Blob([drawingToSvg(drawing, { width: 2000 })], { type: 'image/svg+xml' }), fileName('svg')),
    },
  ];

  async function run(a: Action) {
    if (working) return;
    working = a.id;
    haptic();
    try {
      const res = await a.run();
      if (res === 'saved') toast(a.id === 'pdf' ? 'PDF je v Stažených souborech.' : 'Uloženo do Stažených souborů.');
      if (res !== 'cancelled') open = false;
    } catch (e) {
      console.error(e);
      toast('Tohle se nepovedlo. Zkuste to prosím znovu.', { tone: 'error' });
    } finally {
      working = null;
    }
  }
</script>

<Sheet bind:open title="Uložit a tisknout">
  {#if colored}
    <div class="color-switch">
      <Switch bind:checked={withColor} label="I s vybarvením" hint="Jinak jen čisté čáry k novému vybarvení" />
    </div>
  {/if}
  <ul class="list">
    {#each actions as a (a.id)}
      <li>
        <button onclick={() => run(a)} disabled={!!working && working !== a.id} aria-busy={working === a.id}>
          <span class="ic">
            {#if working === a.id}<span class="spin"></span>{:else}<Icon name={a.icon} />{/if}
          </span>
          <span class="txt">
            <span class="t">{a.title}</span>
            <span class="h">{a.hint}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .color-switch {
    margin: -6px 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 8px;
    border: 0;
    border-radius: var(--r-m);
    background: transparent;
    text-align: left;
    transition: background-color 140ms;
  }
  button:active:not(:disabled) {
    background: var(--paper-2);
  }
  button:disabled {
    opacity: 0.45;
  }
  .ic {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: var(--card);
    box-shadow: var(--shadow-1);
    flex: none;
  }
  .txt {
    display: grid;
  }
  .t {
    font-weight: 700;
  }
  .h {
    font-size: 14.5px;
    color: var(--ink-2);
  }
  .spin {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2.5px solid currentColor;
    border-right-color: transparent;
    animation: s 0.8s linear infinite;
  }
  @keyframes s {
    to {
      transform: rotate(1turn);
    }
  }
</style>
