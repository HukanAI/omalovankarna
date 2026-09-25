<script lang="ts">
  import { onMount } from 'svelte';
  import About from './app/About.svelte';
  import Color from './app/Color.svelte';
  import Create from './app/Create.svelte';
  import Home from './app/Home.svelte';
  import { go, nav } from './app/nav.svelte';
  import { toast } from './app/toast.svelte';
  import Toasts from './ui/Toasts.svelte';

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    if (params.has('share')) {
      // Fotka nasdílená z galerie telefonu (viz service worker).
      history.replaceState(null, '', location.pathname);
      try {
        const inbox = await caches.open('omalovankarna-inbox');
        const key = `${import.meta.env.BASE_URL}inbox/photo`;
        const res = await inbox.match(key);
        if (res) {
          const blob = await res.blob();
          await inbox.delete(key);
          go({ name: 'create', photo: blob });
        }
      } catch {
        toast('Sdílenou fotku se nepodařilo otevřít.', { tone: 'error' });
      }
    } else if (params.has('new')) {
      history.replaceState(null, '', location.pathname);
    }
  });
</script>

{#key nav.route}
  {#if nav.route.name === 'home'}
    <Home />
  {:else if nav.route.name === 'create'}
    <Create photo={nav.route.photo} pageId={nav.route.pageId} />
  {:else if nav.route.name === 'color'}
    <Color pageId={nav.route.pageId} />
  {:else if nav.route.name === 'about'}
    <About />
  {/if}
{/key}

<Toasts />
