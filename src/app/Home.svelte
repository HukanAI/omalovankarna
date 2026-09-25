<script lang="ts">
  import { ms } from '$lib/motion';
  import { onDestroy, onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { fade, scale } from 'svelte/transition';
  import { deletePage, listPages, type PageRecord } from '$lib/db';
  import { device, isIOS, promptInstall, haptic } from '$lib/device.svelte';
  import { plural, relativeDay } from '$lib/format';
  import { fileName, saveToDevice } from '$lib/share';
  import Button from '../ui/Button.svelte';
  import HeroArt from '../ui/HeroArt.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import PhotoPicker from '../ui/PhotoPicker.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import { go } from './nav.svelte';
  import { toast } from './toast.svelte';

  let pages = $state<PageRecord[] | null>(null);
  let thumbs = new Map<string, string>();
  let selecting = $state(false);
  let selected = $state<Set<string>>(new Set());
  let busy = $state(false);
  let iosHelp = $state(false);
  let installDismissed = $state(readFlag('install-dismissed'));

  const showInstall = $derived(!device.standalone && !installDismissed && (device.canInstall || isIOS));

  function readFlag(k: string) {
    try {
      return localStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  }

  function thumbUrl(p: PageRecord): string {
    let u = thumbs.get(p.id + p.updatedAt);
    if (!u) {
      u = URL.createObjectURL(p.thumb);
      thumbs.set(p.id + p.updatedAt, u);
    }
    return u;
  }

  onMount(async () => {
    pages = await listPages();
  });

  onDestroy(() => {
    for (const u of thumbs.values()) URL.revokeObjectURL(u);
  });

  function pick(file: File) {
    go({ name: 'create', photo: file });
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
    haptic();
  }

  function stopSelecting() {
    selecting = false;
    selected = new Set();
  }

  async function makeBook() {
    if (!pages || !selected.size) return;
    busy = true;
    try {
      // Pořadí stránek jako v galerii, nejstarší první (jak vznikaly).
      const chosen = pages.filter((p) => selected.has(p.id)).reverse();
      const { makePdf } = await import('$lib/pdf');
      const pdf = await makePdf(
        chosen.map((p) => ({ drawing: p.drawing, colored: null })),
        'Sešit omalovánek',
      );
      const res = await saveToDevice(pdf, fileName('pdf').replace('omalovanka', 'sesit'));
      if (res !== 'cancelled') toast(`Sešit s ${chosen.length} ${plural(chosen.length, ['stránkou', 'stránkami', 'stránkami'])} je připravený.`);
      stopSelecting();
    } catch (e) {
      console.error(e);
      toast('Sešit se nepodařilo vytvořit.', { tone: 'error' });
    } finally {
      busy = false;
    }
  }

  async function removeSelected() {
    if (!pages) return;
    const ids = [...selected];
    const removed = pages.filter((p) => selected.has(p.id));
    pages = pages.filter((p) => !selected.has(p.id));
    stopSelecting();
    let undone = false;
    toast(`${ids.length === 1 ? 'Omalovánka smazána' : `Smazáno: ${ids.length}`}`, {
      action: {
        label: 'Vrátit',
        run: () => {
          undone = true;
          pages = [...removed, ...(pages ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
        },
      },
    });
    // Skutečné smazání až po uplynutí možnosti vrátit.
    setTimeout(async () => {
      if (!undone) for (const id of ids) await deletePage(id);
    }, 6200);
  }

  async function install() {
    if (device.canInstall) {
      if (await promptInstall()) toast('Omalovánkárna je na ploše.');
    } else {
      iosHelp = true;
    }
  }

  function dismissInstall() {
    installDismissed = true;
    try {
      localStorage.setItem('install-dismissed', '1');
    } catch {
      /* soukromý režim */
    }
  }
</script>

<div class="home">
  <header>
    <div class="brand">
      <svg viewBox="0 0 512 512" class="mark" aria-hidden="true">
        <path
          d="M150 214C146 170 146 128 158 92c36 16 64 36 82 58 10-2 22-2 32 0 20-22 48-42 82-58 12 36 14 78 8 122 28 32 38 70 30 108-14 70-70 104-136 104s-122-34-136-104c-8-38 2-76 30-108z"
          fill="none"
          stroke="currentColor"
          stroke-width="34"
          stroke-linejoin="round"
        />
      </svg>
      <span>Omalovánkárna</span>
    </div>
    {#if selecting}
      <Button variant="ghost" onclick={stopSelecting}>Hotovo</Button>
    {:else}
      <IconButton icon="info" label="O aplikaci" onclick={() => go({ name: 'about' })} />
    {/if}
  </header>

  {#if pages === null}
    <div class="loading" aria-hidden="true"></div>
  {:else if pages.length === 0}
    <section class="hero" in:fade={{ duration: ms(300) }}>
      <HeroArt />
      <h1>Z fotky omalovánka.</h1>
      <p class="lead">
        Vyfoťte, co má vaše dítě rádo – pejska, auto, babičku. Obrázek nakreslíme přímo v telefonu, fotka nikam
        neodchází.
      </p>
      <PhotoPicker onpick={pick} />
      <ul class="facts">
        <li><Icon name="offline" size={20} /> Funguje i bez internetu</li>
        <li><Icon name="subject" size={20} /> Umí vynechat pozadí</li>
        <li><Icon name="printer" size={20} /> Tisk na A4</li>
      </ul>
    </section>
  {:else}
    <section class="start" in:fade={{ duration: ms(250) }}>
      <h1>Co nakreslíme dnes?</h1>
      <PhotoPicker onpick={pick} compact />
    </section>

    <section class="gallery">
      <div class="gallery-head">
        <h2>Vaše omalovánky <span class="count">{pages.length}</span></h2>
        {#if !selecting && pages.length > 0}
          <Button variant="ghost" icon="book" onclick={() => (selecting = true)}>Sešit</Button>
        {/if}
      </div>
      {#if selecting}
        <p class="select-hint">Vyberte stránky do sešitu – vytiskne se jako jedno PDF.</p>
      {/if}
      <ul class="grid">
        {#each pages as p (p.id)}
          <li animate:flip={{ duration: ms(260) }} out:scale={{ duration: ms(180), start: 0.9 }}>
            <button
              class="card"
              class:picked={selected.has(p.id)}
              onclick={() => (selecting ? toggle(p.id) : go({ name: 'create', pageId: p.id }))}
              aria-pressed={selecting ? selected.has(p.id) : undefined}
            >
              <span class="paper">
                <img src={thumbUrl(p)} alt="" loading="lazy" decoding="async" />
              </span>
              <span class="meta">
                <span>{relativeDay(p.updatedAt)}</span>
                {#if p.colored}<span class="dot" title="Vybarvená"></span>{/if}
              </span>
              {#if selecting}
                <span class="check" aria-hidden="true">
                  {#if selected.has(p.id)}<Icon name="check" size={18} stroke={2.6} />{/if}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if showInstall && pages !== null && !selecting}
    <aside class="install" transition:fade={{ duration: ms(200) }}>
      <div>
        <strong>Mějte Omalovánkárnu po ruce</strong>
        <span>Přidejte si ji na plochu – spustí se jako aplikace a poběží i offline.</span>
      </div>
      <div class="install-actions">
        <Button variant="ink" onclick={install}>Přidat</Button>
        <IconButton icon="close" label="Teď ne" onclick={dismissInstall} />
      </div>
    </aside>
  {/if}

  {#if selecting}
    <div class="selbar" transition:fade={{ duration: ms(150) }}>
      <Button variant="paper" icon="trash" disabled={!selected.size} onclick={removeSelected}>Smazat</Button>
      <Button variant="ink" icon="pdf" disabled={!selected.size} {busy} onclick={makeBook}>
        Vytvořit sešit{selected.size ? ` (${selected.size})` : ''}
      </Button>
    </div>
  {/if}
</div>

<Sheet bind:open={iosHelp} title="Přidat na plochu">
  <ol class="ios-steps">
    <li><span class="n">1</span> Dole v Safari klepněte na <Icon name="share" size={20} /> <b>Sdílet</b>.</li>
    <li><span class="n">2</span> Sjeďte níž a zvolte <b>Přidat na plochu</b>.</li>
    <li><span class="n">3</span> Potvrďte <b>Přidat</b>. Ikona s kočkou je na ploše.</li>
  </ol>
  <Button variant="ink" block onclick={() => (iosHelp = false)}>Rozumím</Button>
</Sheet>

<style>
  .home {
    max-width: 720px;
    margin: 0 auto;
    padding: calc(8px + var(--safe-t)) 16px calc(120px + var(--safe-b));
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 56px;
    margin: 0 -6px 4px 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-display);
    font-variation-settings: 'SOFT' 100;
    font-weight: 620;
    font-size: 21px;
    letter-spacing: -0.01em;
  }
  .mark {
    width: 26px;
    height: 26px;
    color: var(--crayon);
  }
  .loading {
    height: 60vh;
  }
  .hero {
    display: grid;
    gap: 18px;
    padding-top: 8px;
  }
  .hero h1 {
    font-size: clamp(38px, 11vw, 56px);
    margin-top: 6px;
  }
  .lead {
    font-size: 18px;
    color: var(--ink-2);
    max-width: 34ch;
  }
  .facts {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: grid;
    gap: 10px;
    color: var(--ink-2);
    font-size: 15.5px;
  }
  .facts li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .start {
    display: grid;
    gap: 16px;
    padding: 18px 0 8px;
  }
  .start h1 {
    font-size: clamp(30px, 8.5vw, 40px);
  }
  .gallery {
    margin-top: 26px;
  }
  .gallery-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .gallery-head h2 {
    font-size: 23px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .count {
    font-family: var(--font-ui);
    font-size: 15px;
    font-weight: 600;
    color: var(--ink-3);
  }
  .select-hint {
    color: var(--ink-2);
    margin: -4px 0 12px;
    font-size: 15px;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 18px 14px;
  }
  .card {
    position: relative;
    display: grid;
    gap: 8px;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
  }
  .paper {
    display: grid;
    place-items: center;
    aspect-ratio: 3 / 4;
    padding: 10px;
    border-radius: 6px;
    background: var(--sheet);
    box-shadow: var(--shadow-1);
    transition:
      transform 200ms var(--ease),
      box-shadow 200ms var(--ease);
  }
  /* Každý list leží na stole trochu jinak. */
  li:nth-child(3n + 1) .paper {
    transform: rotate(-0.8deg);
  }
  li:nth-child(3n + 2) .paper {
    transform: rotate(0.6deg);
  }
  .card:active .paper {
    transform: scale(0.97);
  }
  .picked .paper {
    box-shadow:
      0 0 0 3px var(--crayon),
      var(--shadow-2);
  }
  .paper img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--ink-2);
    padding-left: 2px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: conic-gradient(var(--crayon) 0 33%, var(--ochre) 0 66%, var(--sky) 0);
  }
  .check {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--card);
    border: 2px solid var(--ink);
    color: var(--on-ink);
  }
  .picked .check {
    background: var(--crayon);
    border-color: var(--crayon);
    color: #1d1712;
  }
  .install {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(12px + var(--safe-b));
    max-width: 560px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 8px 14px 18px;
    border-radius: var(--r-l);
    background: var(--card);
    box-shadow: var(--shadow-2);
    z-index: 20;
  }
  .install > div:first-child {
    display: grid;
    gap: 2px;
    flex: 1;
    font-size: 14.5px;
    color: var(--ink-2);
  }
  .install strong {
    color: var(--ink);
    font-size: 16px;
  }
  .install-actions {
    display: flex;
    align-items: center;
  }
  .selbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    justify-content: center;
    gap: 10px;
    padding: 14px 16px calc(14px + var(--safe-b));
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--rule);
  }
  .ios-steps {
    list-style: none;
    padding: 0;
    margin: 0 0 20px;
    display: grid;
    gap: 14px;
  }
  .ios-steps li {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .n {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--ink);
    color: var(--on-ink);
    font-weight: 700;
    font-size: 15px;
    margin-right: 4px;
  }
</style>
