<script lang="ts">
  import { materialFileIconSvg, materialFolderIconSvg } from '../utils/materialIconRenderer.svelte';

  let {
    name,
    isDir = false,
    size = 14,
  }: {
    name: string;
    isDir?: boolean;
    size?: number;
  } = $props();

  let svg = $derived(
    isDir ? materialFolderIconSvg(name, size) : materialFileIconSvg(name, size)
  );
</script>

<!--
  Renders the material icon for `name` as inline SVG (synchronous — no flicker).
  While the SVG is fetched for the first time an invisible placeholder of the
  same size is shown, so a different "default" icon never flashes in.
-->
{#if svg}
  <span
    class="material-icon shrink-0 inline-flex items-center justify-center"
    style="width:{size}px;height:{size}px"
    aria-hidden="true"
  >
    {@html svg}
  </span>
{:else}
  <span
    class="material-icon shrink-0 inline-flex items-center justify-center"
    style="width:{size}px;height:{size}px"
    aria-hidden="true"
  ></span>
{/if}
