<script lang="ts">
  import Button from './Button.svelte';

  let { onpick, compact = false }: { onpick: (file: File) => void; compact?: boolean } = $props();

  let camera: HTMLInputElement;
  let library: HTMLInputElement;

  function take(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) onpick(file);
  }
</script>

<div class="picker" class:compact>
  <Button variant="ink" size={compact ? 'm' : 'l'} icon="camera" block onclick={() => camera.click()}>Vyfotit</Button>
  <Button variant="paper" size={compact ? 'm' : 'l'} icon="photos" block onclick={() => library.click()}
    >Vybrat fotku</Button
  >
  <input bind:this={camera} type="file" accept="image/*" capture="environment" onchange={take} hidden />
  <input bind:this={library} type="file" accept="image/*" onchange={take} hidden />
</div>

<style>
  .picker {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
</style>
