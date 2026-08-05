/**
 * stream.ts — 5.3 StreamedBatch Channel convention
 *
 * The backend streams long-running results (directory scans, workspace
 * searches) over a Tauri `Channel` instead of blocking on one giant
 * response. Every streamed command adheres to the same shape:
 *
 *   interface StreamedBatch<T> {
 *     items: T[];
 *     meta: Record<string, number>;   // { files_scanned?, total_matches? }
 *     done: boolean;                  // final frame, stream is complete
 *   }
 *
 * `streamCommand` wraps the invoke call and returns the accumulated
 * result while letting the caller react to each batch as it arrives.
 */

import { Channel, invoke } from '@tauri-apps/api/core';

export interface StreamedBatch<T> {
  items: T[];
  meta: Record<string, number>;
  done: boolean;
}

export interface StreamHandlers<T> {
  /** Called for every non-empty batch that arrives (incremental UI updates). */
  onBatch?: (items: T[], meta: Record<string, number>) => void;
  /** Called once when the final `done` frame arrives. */
  onDone?: (meta: Record<string, number>) => void;
}

export interface StreamResult<T> {
  items: T[];
  meta: Record<string, number>;
}

/**
 * Invoke a streamed command and accumulate every batch until completion.
 *
 * @param command   Rust command name (takes a `channel` argument)
 * @param args      Command arguments (excluding `channel`)
 * @param handlers  Optional incremental callbacks
 */
export async function streamCommand<T>(
  command: string,
  args: Record<string, unknown>,
  handlers: StreamHandlers<T> = {},
): Promise<StreamResult<T>> {
  const items: T[] = [];
  let meta: Record<string, number> = {};

  const channel = new Channel<StreamedBatch<T>>();
  channel.onmessage = (batch: StreamedBatch<T>) => {
    meta = { ...meta, ...batch.meta };
    if (batch.items.length > 0) {
      items.push(...batch.items);
      handlers.onBatch?.(batch.items, meta);
    }
    if (batch.done) {
      handlers.onDone?.(meta);
    }
  };

  await invoke(command, { ...args, channel });

  return { items, meta };
}
