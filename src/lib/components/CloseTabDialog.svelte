<script lang="ts">
  import Modal from './Modal.svelte';
  import { themeStore } from '../stores/theme';

  let isDark = $derived($themeStore.isDark);

  let { isOpen, fileName, onSave, onDontSave, onCancel }: {
    isOpen: boolean; fileName: string;
    onSave: () => void; onDontSave: () => void; onCancel: () => void;
  } = $props();
</script>

<Modal {isOpen} title="Unsaved Changes" onClose={onCancel} widthClass="max-w-sm">
  {#snippet children()}
    <div class="p-5">
      <p class="text-sm text-secondary">Do you want to save the changes you made to <span class="font-semibold text-primary">{fileName}</span>?</p>
    </div>
  {/snippet}
  {#snippet footer()}
    <div class="flex justify-end gap-2">
      <button
        onclick={onCancel}
        class="px-3 py-1.5 rounded text-sm transition-colors bg-surface border border-subtle hover:bg-hover text-primary"
      >Cancel</button>
      <button
        onclick={onDontSave}
        class="px-3 py-1.5 rounded text-sm transition-colors {isDark ? 'bg-red-900/50 hover:bg-red-900/80 text-red-200' : 'bg-red-100 hover:bg-red-200 text-red-700'}"
      >Don't Save</button>
      <button onclick={onSave} class="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white transition-colors">Save</button>
    </div>
  {/snippet}
</Modal>
