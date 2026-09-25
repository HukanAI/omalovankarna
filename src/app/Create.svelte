<script lang="ts">
  import { ms } from '$lib/motion';
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import * as Comlink from 'comlink';
  import type { Level } from '../engine/presets';
  import type { SamPoint } from '../engine/models';
  import type { Stage } from '../engine/studio';
  import type { Drawing, Stroke } from '../engine/types';
  import { downloadProgress, engine } from '$lib/engine.svelte';
  import { deletePage, getPage, newId, putPage, trackSave, type PageRecord } from '$lib/db';
  import { haptic } from '$lib/device.svelte';
  import { formatMB } from '$lib/model-files';
  import { bitmapToBlob, fileToBitmap } from '$lib/photo';
  import { renderThumb } from '$lib/render';
  import Button from '../ui/Button.svelte';
  import DrawingView from '../ui/DrawingView.svelte';
  import ExportSheet from '../ui/ExportSheet.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import LevelPicker from '../ui/LevelPicker.svelte';
  import Slider from '../ui/Slider.svelte';
  import Switch from '../ui/Switch.svelte';
  import { back, go, replace } from './nav.svelte';
  import { toast } from './toast.svelte';

  let { photo, pageId }: { photo?: Blob; pageId?: string } = $props();

  type Phase = 'loading' | 'compose' | 'drawing' | 'done' | 'error';

  let phase = $state<Phase>('loading');
  let errorText = $state('');
  let photoUrl = $state<string | null>(null);
  let photoBlob: Blob | null = null;
  let aspect = $state(3 / 4);
  let photoAspect = 3 / 4;
  let imageInWorker = false;

  let level = $state<Level>(readLevel());
  let detail = $state(0.5);
  let style = $state<'pen' | 'ink'>(readStyle());

  let subjectOn = $state(readSubjectPref());
  let points = $state<SamPoint[]>([]);
  let tapMode = $state<'add' | 'remove'>('add');
  let selecting = $state(false);
  let maskCanvas: HTMLCanvasElement | undefined = $state();

  let stage = $state<Stage | null>(null);
  let drawing = $state<Drawing | null>(null);
  let reveal = $state<Stroke[] | null>(null);
  let animate = $state(false);
  let redrawing = $state(false);

  let record = $state<PageRecord | null>(null);
  let colored = $state<Blob | null>(null);
  let exportOpen = $state(false);

  const dlLines = $derived(downloadProgress(['runtime', 'lineart']));
  const dlSam = $derived(downloadProgress(['samEncoder', 'samDecoder']));

  function readSubjectPref(): boolean {
    try {
      return localStorage.getItem('subject') !== '0';
    } catch {
      return true;
    }
  }

  function readStyle(): 'pen' | 'ink' {
    try {
      return localStorage.getItem('style') === 'ink' ? 'ink' : 'pen';
    } catch {
      return 'pen';
    }
  }

  function onStyle(v: 'pen' | 'ink') {
    if (v === style) return;
    style = v;
    haptic();
    try {
      localStorage.setItem('style', v);
    } catch {
      /* nevadí */
    }
    void draw({ animate: false, quiet: true });
  }

  function readLevel(): Level {
    try {
      const v = localStorage.getItem('level');
      if (v === 'mali' || v === 'skolaci' || v === 'zkuseni') return v;
    } catch {
      /* soukromý režim */
    }
    return 'skolaci';
  }

  onMount(async () => {
    try {
      if (pageId) await openExisting(pageId);
      else if (photo) await openPhoto(photo);
      else replace({ name: 'home' });
    } catch (e) {
      fail(e, 'Fotku se nepodařilo otevřít. Zkuste prosím jinou.');
    }
  });

  onDestroy(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  });

  async function openPhoto(file: Blob) {
    const bmp = await fileToBitmap(file);
    aspect = bmp.width / bmp.height;
    photoBlob = await bitmapToBlob(bmp, 1600);
    photoUrl = URL.createObjectURL(photoBlob);
    const size = await engine().setImage(Comlink.transfer(bmp, [bmp]));
    aspect = photoAspect = size.w / size.h;
    imageInWorker = true;
    phase = 'compose';
    // Hlavní postavu zkusíme najít rovnou – bez ní bývá kresba přeplněná pozadím.
    if (subjectOn) void runSelection([], true);
    // Kreslíře připravíme hned, ať je hotový, než si uživatel vybere úroveň.
    engine()
      .warmup('lineart')
      .catch(() => {});
  }

  async function openExisting(id: string) {
    const rec = await getPage(id);
    if (!rec) return replace({ name: 'home' });
    record = rec;
    photoBlob = rec.photo;
    photoUrl = URL.createObjectURL(rec.photo);
    const probe = await createImageBitmap(rec.photo);
    photoAspect = probe.width / probe.height;
    probe.close();
    level = rec.level;
    detail = rec.detail;
    style = rec.style ?? 'ink';
    subjectOn = !!rec.selection;
    points = rec.selection ?? [];
    colored = rec.colored;
    drawing = rec.drawing;
    aspect = rec.drawing.w / rec.drawing.h;
    animate = false;
    phase = 'done';
  }

  /** U otevřené stránky z galerie se fotka do workeru nahraje až při první změně. */
  async function ensureImage() {
    if (imageInWorker || !photoBlob) return;
    const bmp = await fileToBitmap(photoBlob);
    await engine().setImage(Comlink.transfer(bmp, [bmp]));
    imageInWorker = true;
    if (subjectOn) await engine().select($state.snapshot(points));
  }

  function fail(e: unknown, text: string) {
    if (e) console.error(e);
    errorText = text;
    phase = 'error';
  }

  // ——— Výběr hlavní postavy ———

  async function setSubject(on: boolean) {
    subjectOn = on;
    haptic();
    try {
      localStorage.setItem('subject', on ? '1' : '0');
    } catch {
      /* nevadí */
    }
    if (!on) {
      points = [];
      clearMask();
      await engine().clearSelection();
      return;
    }
    await runSelection([]);
  }

  async function runSelection(pts: SamPoint[], automatic = false) {
    selecting = true;
    try {
      await ensureImage();
      const res = await engine().select(pts);
      if (automatic && !res.confident) {
        // Krajina, interiér… – kreslí se celá fotka.
        subjectOn = false;
        points = [];
        clearMask();
        await engine().clearSelection();
        toast('Na fotce není jasná hlavní postava, nakreslím ji celou.');
        return;
      }
      paintMask(res);
      if (res.coverage < 0.004) toast('Tady jsem nic nenašel. Klepněte přímo na postavu.');
    } catch (e) {
      console.error(e);
      if (!automatic) toast('Výběr postavy se nepovedl. Zkontrolujte připojení a zkuste to znovu.', { tone: 'error' });
      subjectOn = false;
    } finally {
      selecting = false;
    }
  }

  function paintMask(m: { w: number; h: number; data: Uint8Array }) {
    if (!maskCanvas) return;
    maskCanvas.width = m.w;
    maskCanvas.height = m.h;
    const ctx = maskCanvas.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    const px = img.data;
    const { w, h, data } = m;
    // Tloušťka obrysu úměrná velikosti, ať je vidět i na displeji telefonu.
    const r = Math.max(1, Math.round(Math.max(w, h) / 320));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        if (!data[i]) {
          // Pozadí zbledne jako pod pauzovacím papírem.
          px[o] = 246;
          px[o + 1] = 240;
          px[o + 2] = 228;
          px[o + 3] = 200;
          continue;
        }
        let edge = false;
        for (let dy = -r; dy <= r && !edge; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w && !data[yy * w + xx]) {
              edge = true;
              break;
            }
          }
        }
        if (edge) {
          px[o] = 224;
          px[o + 1] = 88;
          px[o + 2] = 47;
          px[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function clearMask() {
    maskCanvas?.getContext('2d')?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  }

  let downAt: { x: number; y: number } | null = null;
  function onPhotoDown(e: PointerEvent) {
    downAt = { x: e.clientX, y: e.clientY };
  }
  function onPhotoUp(e: PointerEvent) {
    if (!subjectOn || selecting || !downAt) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p: SamPoint = {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
      positive: tapMode === 'add',
    };
    // První klepnutí nahradí automatický odhad.
    points = [...points, p];
    haptic();
    void runSelection($state.snapshot(points));
  }

  function undoPoint() {
    points = points.slice(0, -1);
    void runSelection($state.snapshot(points));
  }

  // ——— Kreslení ———

  async function draw(opts: { animate: boolean; quiet?: boolean }) {
    if (opts.quiet) redrawing = true;
    else phase = 'drawing';
    try {
      await ensureImage();
      const res = await engine().draw(
        { level, detail, subject: subjectOn, style },
        Comlink.proxy((s: Stage) => (stage = s)),
      );
      if (!res.drawing.rings.length && !res.drawing.strokes.length) {
        fail(null, 'Na fotce jsem nenašel žádné obrysy. Zkuste jinou úroveň nebo fotku s výraznějším motivem.');
        return;
      }
      const changed = drawing !== null;
      drawing = res.drawing;
      aspect = res.drawing.w / res.drawing.h;
      reveal = res.reveal;
      animate = opts.animate;
      phase = 'done';
      if (res.fallback) toast('Kreslíř se nestáhl, použil jsem jednodušší metodu. Zkuste to později s internetem.');
      if (opts.animate) haptic('success');
      // První verzi uložíme hned, další úpravy posuvníkem s malým zpožděním.
      scheduleSave(changed, record ? 500 : 0);
    } catch (e) {
      fail(e, 'Kreslení se nepovedlo. Může za to málo paměti nebo výpadek připojení při prvním stažení.');
    } finally {
      redrawing = false;
      stage = null;
    }
  }

  function start() {
    try {
      localStorage.setItem('level', level);
    } catch {
      /* nevadí */
    }
    void draw({ animate: true });
  }

  let detailTimer: ReturnType<typeof setTimeout> | undefined;
  function onDetail() {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => draw({ animate: false, quiet: true }), 140);
  }

  function onLevel(l: Level) {
    level = l;
    try {
      localStorage.setItem('level', l);
    } catch {
      /* nevadí */
    }
    if (phase === 'done') void draw({ animate: true, quiet: true });
  }

  // ——— Ukládání do galerie ———

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(changed: boolean, ms: number) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void trackSave(save(changed)), ms);
  }

  async function save(changed: boolean) {
    if (!drawing || !photoBlob) return;
    const snapshot = $state.snapshot(drawing) as Drawing;
    const now = Date.now();
    let rec = record;
    // Vybarvenou stránku nikdy nepřepíšeme novou kresbou – vznikne kopie.
    if (rec?.colored && changed) {
      rec = null;
      colored = null;
      toast('Upravená kresba je nová stránka, vybarvená zůstala v galerii.');
    }
    const next: PageRecord = {
      id: rec?.id ?? newId(),
      createdAt: rec?.createdAt ?? now,
      updatedAt: now,
      level,
      detail,
      style,
      selection: subjectOn ? ($state.snapshot(points) as SamPoint[]) : null,
      drawing: snapshot,
      photo: photoBlob,
      thumb: await renderThumb(snapshot, rec?.colored ?? null),
      colored: rec?.colored ?? null,
    };
    await putPage(next);
    record = next;
  }

  async function remove() {
    if (!record) return back();
    const rec = record;
    await deletePage(rec.id);
    back();
    toast('Omalovánka smazána', { action: { label: 'Vrátit', run: () => void putPage(rec) } });
  }

  async function toColor() {
    clearTimeout(saveTimer);
    await save(false);
    if (record) go({ name: 'color', pageId: record.id });
  }

  function editSelection() {
    phase = 'compose';
    aspect = photoAspect;
    if (!subjectOn) void setSubject(true);
    else void ensureImage().then(() => runSelection($state.snapshot(points)));
  }

  const stageText = $derived.by(() => {
    if (dlLines) return `Stahuji kreslíře · ${Math.round(dlLines.ratio * 100)} % z ${formatMB(dlLines.total)}`;
    if (stage === 'prepare') return 'Připravuji papír…';
    if (stage === 'lines') return 'Kreslím obrysy…';
    if (stage === 'clean') return 'Čistím a obtahuji čáry…';
    return 'Chvilku…';
  });

  // Vybarvení z galerie se zobrazí pod čarami.
  let coloredUrl = $state<string | null>(null);
  $effect(() => {
    if (!colored) return;
    const url = URL.createObjectURL(colored);
    coloredUrl = url;
    return () => {
      URL.revokeObjectURL(url);
      coloredUrl = null;
    };
  });
</script>

<div class="create">
  <header>
    <IconButton icon="back" label="Zpět" onclick={back} />
    <h1>{record ? 'Omalovánka' : 'Nová omalovánka'}</h1>
    {#if record && phase === 'done'}
      <IconButton icon="trash" label="Smazat" onclick={remove} />
    {:else}
      <span class="spacer"></span>
    {/if}
  </header>

  <main class="stage">
    <div
      class="sheet"
      class:paper={phase === 'done'}
      style:aspect-ratio={aspect}
      style:width="min(100%, calc(min({phase === 'done' ? 46 : 52}dvh, 640px) * {aspect}))"
    >
      {#if phase === 'loading'}
        <div class="placeholder" aria-label="Načítám fotku"></div>
      {:else if phase === 'done' && drawing}
        <div class="drawing" class:dim={redrawing} in:fade={{ duration: ms(200) }}>
          {#key drawing}
            <DrawingView {drawing} {reveal} {animate} colorLayer={coloredUrl} />
          {/key}
        </div>
        {#if redrawing}<div class="mini-spinner" transition:fade={{ duration: ms(200) }}></div>{/if}
      {:else if photoUrl}
        <div
          class="photo"
          class:tappable={subjectOn && phase === 'compose'}
          onpointerdown={onPhotoDown}
          onpointerup={onPhotoUp}
          role="presentation"
        >
          <img src={photoUrl} alt="Vybraná fotka" draggable="false" />
          <canvas bind:this={maskCanvas} class="mask" class:hidden={!subjectOn}></canvas>
          {#each points as p, i (i)}
            <span class="pin" class:neg={!p.positive} style:left="{p.x * 100}%" style:top="{p.y * 100}%" in:fly={{ y: -8, duration: ms(200) }}>
              <Icon name={p.positive ? 'plus' : 'minus'} size={14} stroke={3} />
            </span>
          {/each}
          {#if selecting}<div class="scan" transition:fade={{ duration: ms(200) }}></div>{/if}
          {#if phase === 'drawing'}
            <div class="drawing-overlay" transition:fade={{ duration: ms(200) }}>
              <div class="sweep"></div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </main>

  <section class="panel">
    {#if phase === 'compose'}
      <div class="block" in:fade={{ duration: ms(180) }}>
        <h2>Pro koho bude?</h2>
        <LevelPicker bind:value={level} onchange={onLevel} />
      </div>
      <div class="block">
        <Switch
          checked={subjectOn}
          label="Jen hlavní postava"
          hint={subjectOn ? 'Klepnutím na fotku výběr upravíte' : 'Pozadí se vynechá a kresba se přiblíží'}
          disabled={selecting}
          onchange={(v) => setSubject(v)}
        />
        {#if subjectOn}
          <div class="select-tools" transition:fade={{ duration: ms(150) }}>
            {#if dlSam}
              <p class="note">Stahuji pomocníka na výběr · {Math.round(dlSam.ratio * 100)} % z {formatMB(dlSam.total)}</p>
            {:else}
              <div class="modes" role="radiogroup" aria-label="Co dělá klepnutí">
                <button role="radio" aria-checked={tapMode === 'add'} class:on={tapMode === 'add'} onclick={() => (tapMode = 'add')}>
                  <Icon name="plus" size={18} /> Přidat
                </button>
                <button role="radio" aria-checked={tapMode === 'remove'} class:on={tapMode === 'remove'} onclick={() => (tapMode = 'remove')}>
                  <Icon name="minus" size={18} /> Ubrat
                </button>
              </div>
              <IconButton icon="undo" label="Vrátit klepnutí" disabled={!points.length || selecting} onclick={undoPoint} />
            {/if}
          </div>
        {/if}
      </div>
      <Button variant="ink" size="l" icon="pencil" block disabled={selecting} onclick={start}>Nakreslit</Button>
      {#if dlLines && !dlSam}
        <p class="note center">Poprvé se stahuje kreslíř ({formatMB(dlLines.total)}). Potom už vše funguje i bez internetu.</p>
      {/if}
    {:else if phase === 'drawing'}
      <div class="progress" in:fade={{ duration: ms(200) }}>
        <p class="stage-text" aria-live="polite">{stageText}</p>
        {#if dlLines}
          <div class="bar"><span style:width="{dlLines.ratio * 100}%"></span></div>
        {/if}
      </div>
    {:else if phase === 'done' && drawing}
      <div class="block" in:fade={{ duration: ms(200) }}>
        <Slider bind:value={detail} label="Množství detailů" left="Méně" right="Víc" oninput={onDetail} />
      </div>
      <div class="block">
        <LevelPicker value={level} compact onchange={onLevel} />
      </div>
      <div class="styles" role="radiogroup" aria-label="Styl čar">
        <span class="styles-label">Čára</span>
        <button role="radio" aria-checked={style === 'pen'} class:on={style === 'pen'} onclick={() => onStyle('pen')}>
          <svg viewBox="0 0 40 16" aria-hidden="true"><path d="M3 11 C12 3 26 13 37 5" /></svg>
          Pero
        </button>
        <button role="radio" aria-checked={style === 'ink'} class:on={style === 'ink'} onclick={() => onStyle('ink')}>
          <svg viewBox="0 0 40 16" aria-hidden="true"><path class="ink-glyph" d="M3 11 C12 3 26 13 37 5" /></svg>
          Tuš
        </button>
      </div>
      <button class="link" onclick={editSelection}>
        <Icon name="subject" size={20} />
        {subjectOn ? 'Upravit výběr postavy' : 'Vynechat pozadí'}
      </button>
      <div class="actions">
        <Button variant="paper" size="l" icon="download" onclick={() => (exportOpen = true)}>Uložit</Button>
        <Button variant="crayon" size="l" icon="palette" onclick={toColor}>Vybarvit</Button>
      </div>
    {:else if phase === 'error'}
      <div class="error" in:fade={{ duration: ms(200) }}>
        <p>{errorText}</p>
        <div class="actions">
          <Button variant="paper" onclick={back}>Zpět</Button>
          <Button variant="ink" icon="refresh" onclick={() => (drawing ? (phase = 'done') : start())}>Zkusit znovu</Button>
        </div>
      </div>
    {/if}
  </section>
</div>

{#if drawing}
  <ExportSheet bind:open={exportOpen} {drawing} {colored} />
{/if}

<style>
  .create {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-columns: minmax(0, 1fr);
    min-height: 100dvh;
    max-width: 720px;
    margin: 0 auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(4px + var(--safe-t)) 6px 0;
    min-height: 60px;
  }
  header h1 {
    flex: 1;
    text-align: center;
    font-size: 20px;
  }
  .spacer {
    width: 48px;
  }
  .stage {
    display: grid;
    place-items: center;
    padding: 8px 20px 16px;
    min-height: 0;
  }
  .sheet {
    position: relative;
    border-radius: 6px;
    overflow: hidden;
    background: var(--paper-2);
    box-shadow: var(--shadow-sheet);
  }
  .sheet.paper {
    background: var(--sheet);
    padding: 3%;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, var(--paper-2) 30%, var(--paper-3) 50%, var(--paper-2) 70%);
    background-size: 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .photo {
    position: absolute;
    inset: 0;
    touch-action: manipulation;
  }
  .photo.tappable {
    cursor: crosshair;
  }
  .photo img,
  .mask {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    -webkit-user-drag: none;
    user-select: none;
  }
  .mask {
    transition: opacity 200ms;
    pointer-events: none;
  }
  .mask.hidden {
    opacity: 0;
  }
  .pin {
    position: absolute;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--ink);
    color: var(--on-ink);
    border: 2px solid #fff;
    box-shadow: var(--shadow-1);
    pointer-events: none;
  }
  .pin.neg {
    background: #fff;
    color: #1d1a17;
    border-color: #1d1a17;
  }
  .scan {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 0%, rgb(224 88 47 / 0.18) 48%, transparent 52%);
    background-size: 100% 220%;
    animation: scan 1.1s var(--ease) infinite;
    pointer-events: none;
  }
  @keyframes scan {
    from {
      background-position: 0 -120%;
    }
    to {
      background-position: 0 120%;
    }
  }
  .drawing-overlay {
    position: absolute;
    inset: 0;
    backdrop-filter: grayscale(1) contrast(0.8) brightness(1.15);
    -webkit-backdrop-filter: grayscale(1) contrast(0.8) brightness(1.15);
    background: rgb(255 253 248 / 0.35);
    overflow: hidden;
  }
  .sweep {
    position: absolute;
    top: -10%;
    bottom: -10%;
    width: 38%;
    background: linear-gradient(90deg, transparent, rgb(255 253 248 / 0.85), transparent);
    animation: sweep 1.6s var(--ease) infinite;
  }
  @keyframes sweep {
    from {
      transform: translateX(-120%) skewX(-12deg);
    }
    to {
      transform: translateX(320%) skewX(-12deg);
    }
  }
  .drawing {
    width: 100%;
    height: 100%;
    transition: opacity 200ms;
  }
  .drawing.dim {
    opacity: 0.45;
  }
  .mini-spinner {
    position: absolute;
    right: 12px;
    top: 12px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2.5px solid var(--ink);
    border-right-color: transparent;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
  .panel {
    display: grid;
    gap: 12px;
    padding: 16px 16px calc(16px + var(--safe-b));
    background: var(--paper);
    border-top: 1px solid var(--rule);
    border-radius: var(--r-xl) var(--r-xl) 0 0;
    box-shadow: 0 -10px 30px -18px rgb(70 45 20 / 0.25);
  }
  .panel h2 {
    font-size: 19px;
    margin-bottom: 10px;
  }
  .block {
    display: grid;
  }
  .select-tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 4px;
  }
  .modes {
    display: inline-flex;
    padding: 4px;
    gap: 4px;
    border-radius: 999px;
    background: var(--paper-2);
  }
  .modes button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    font-weight: 650;
    font-size: 15px;
  }
  .modes .on {
    background: var(--card);
    box-shadow: var(--shadow-1);
  }
  .note {
    font-size: 14.5px;
    color: var(--ink-2);
  }
  .center {
    text-align: center;
  }
  .progress {
    display: grid;
    gap: 12px;
    min-height: 96px;
    align-content: center;
  }
  .stage-text {
    text-align: center;
    font-family: var(--font-display);
    font-variation-settings: 'SOFT' 100;
    font-size: 21px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--paper-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--ink);
    border-radius: inherit;
    transition: width 200ms linear;
  }
  .styles {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .styles-label {
    font-weight: 650;
    margin-right: auto;
  }
  .styles button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1.5px solid var(--rule-strong);
    background: var(--card);
    font-weight: 650;
    font-size: 15px;
  }
  .styles button.on {
    border-color: var(--ink);
    background: var(--crayon-soft);
  }
  .styles svg {
    width: 30px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .styles .ink-glyph {
    stroke-width: 1.4;
    filter: drop-shadow(0 0 0.6px currentColor);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    justify-self: start;
    border: 0;
    background: none;
    padding: 6px 2px;
    font-weight: 650;
    color: var(--ink-2);
    text-decoration: underline;
    text-decoration-color: var(--rule-strong);
    text-underline-offset: 4px;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .error {
    display: grid;
    gap: 16px;
  }
  .error p {
    color: var(--ink-2);
  }
</style>
