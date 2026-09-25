<script lang="ts">
  import { onMount } from 'svelte';
  import { clearPages } from '$lib/db';
  import { engine } from '$lib/engine.svelte';
  import { MODEL_CACHE } from '$lib/model-files';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import { back } from './nav.svelte';
  import { toast } from './toast.svelte';

  let usage = $state<string | null>(null);
  let backend = $state<string | null>(null);
  let confirmOpen = $state(false);

  onMount(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) usage = `${(est.usage / 1e6).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} MB`;
    } catch {
      /* nepodporováno */
    }
    try {
      backend = (await engine().backend()) === 'webgpu' ? 'grafický čip (WebGPU)' : 'procesor (WebAssembly)';
    } catch {
      backend = null;
    }
  });

  async function wipe() {
    await clearPages();
    try {
      await caches.delete(MODEL_CACHE);
    } catch {
      /* nevadí */
    }
    confirmOpen = false;
    toast('Vše smazáno. Aplikace je jako nová.');
  }
</script>

<div class="about">
  <header>
    <IconButton icon="back" label="Zpět" onclick={back} />
  </header>

  <article>
    <h1>O Omalovánkárně</h1>

    <section>
      <h2>Fotky zůstávají doma</h2>
      <p>
        Všechno kreslení probíhá přímo ve vašem telefonu. Fotky ani omalovánky se nikam neposílají, nepotřebujete
        účet a aplikace nesbírá žádná data. Galerie je uložená jen v tomto zařízení.
      </p>
    </section>

    <section>
      <h2>Jak to kreslí</h2>
      <p>
        Fotka se nejdřív zjednoduší, aby zmizely drobné textury jako srst nebo tráva. Potom ji překreslí
        neuronová síť, která se učila od ilustrátorů. Čáry pak projdou úpravou, jakou by udělal kreslíř:
        zbytečné tahy zmizí, mezery se dotáhnou, aby plochy šly vybarvit kyblíkem, a vše se převede na hladké
        křivky, které jsou ostré i při tisku. Obličeje aplikace najde zvlášť a oči, nos a pusu dokreslí
        čistými tahy, jak to dělají ilustrátoři omalovánek.
      </p>
      {#if backend}<p class="muted">Na tomto zařízení počítá: {backend}.</p>{/if}
    </section>

    <section>
      <h2>Tipy pro nejlepší výsledek</h2>
      <ul>
        <li>Foťte za denního světla, s postavou nebo věcí zblízka.</li>
        <li>U rušného pozadí zapněte <b>Jen hlavní postava</b>.</li>
        <li>Pro nejmenší volte <b>Malí umělci</b> – velké plochy, silné čáry.</li>
        <li>Posuvníkem detailů doladíte, kolik čar zůstane.</li>
      </ul>
    </section>

    <section>
      <h2>Poděkování</h2>
      <p class="credits">
        Kreslicí síť <i>Informative Drawings</i> (C. Chan, F. Durand, P. Isola, MIT, licence MIT).<br />
        Výběr postavy <i>SlimSAM</i> (Z. Chen a kol., licence Apache 2.0) vycházející ze <i>Segment Anything</i> (Meta AI).<br />
        Obličeje: detektor <i>YuNet</i> (W. Wu, H. Peng, S. Yu, MIT) a <i>MediaPipe Face Mesh</i> (Google, Apache 2.0).<br />
        Výpočty běží v <i>ONNX Runtime Web</i> (Microsoft, MIT).<br />
        Písma <i>Fraunces</i> a <i>Atkinson Hyperlegible Next</i> (SIL Open Font License).
      </p>
    </section>

    <section class="storage">
      <p class="muted">Aplikace v telefonu zabírá {usage ?? 'jen pár megabajtů'}.</p>
      <Button variant="paper" icon="trash" onclick={() => (confirmOpen = true)}>Smazat vše</Button>
      <p class="muted version">Verze {__APP_VERSION__}</p>
    </section>
  </article>
</div>

<Sheet bind:open={confirmOpen} title="Smazat všechny omalovánky?">
  <p class="confirm">Smaže se galerie i stažení kreslíři. Vrátit to nepůjde.</p>
  <div class="confirm-actions">
    <Button variant="paper" onclick={() => (confirmOpen = false)}>Nechat</Button>
    <Button variant="ink" icon="trash" onclick={wipe}>Smazat vše</Button>
  </div>
</Sheet>

<style>
  .about {
    max-width: 640px;
    margin: 0 auto;
    padding: calc(4px + var(--safe-t)) 16px calc(40px + var(--safe-b));
  }
  header {
    min-height: 60px;
    display: flex;
    align-items: center;
    margin-left: -10px;
  }
  article {
    display: grid;
    gap: 28px;
  }
  h1 {
    font-size: 38px;
  }
  h2 {
    font-size: 22px;
    margin-bottom: 8px;
  }
  p,
  li {
    color: var(--ink-2);
  }
  ul {
    margin: 0;
    padding-left: 1.2em;
    display: grid;
    gap: 6px;
  }
  .credits {
    font-size: 15px;
    line-height: 1.6;
  }
  .muted {
    color: var(--ink-3);
    font-size: 15px;
  }
  .storage {
    display: grid;
    gap: 12px;
    justify-items: start;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
  }
  .version {
    font-variant-numeric: tabular-nums;
  }
  .confirm {
    color: var(--ink-2);
    margin-bottom: 20px;
  }
  .confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
</style>
