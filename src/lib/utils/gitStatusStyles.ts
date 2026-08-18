/**
 * Git status color helpers, shared by the file tree, source control panel
 * and any other surface that decorates files with their git state.
 *
 * Codes follow the VSCode convention: U / A / R / C = green (success),
 * M = yellow (warning), D = red (error), Conflict = accent.
 */

function statusTone(code: string | undefined): 'success' | 'warning' | 'error' | 'accent' | 'muted' {
  if (!code) return 'muted';
  if (code === 'U' || code === 'A' || code === 'R' || code === 'C') return 'success';
  if (code === 'M') return 'warning';
  if (code === 'D') return 'error';
  if (code === 'Conflict') return 'accent';
  return 'muted';
}

const TONE_COLOR: Record<'success' | 'warning' | 'error' | 'accent' | 'muted', string> = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  accent: 'var(--accent)',
  muted: 'var(--text-muted)',
};

/** Color of the git status badge/label for the given status code. */
export function getGitStatusStyle(code: string | undefined): string {
  return `color: ${TONE_COLOR[statusTone(code)]}`;
}

/**
 * Badge style. When `isRollup` is true (a folder showing the worst status
 * inside it), the badge is rendered as a pill and needs a border color too.
 */
export function getGitBadgeStyle(code: string | undefined, isRollup = false): string {
  const color = TONE_COLOR[statusTone(code)];
  return isRollup ? `border-color: ${color}; color: ${color}` : `color: ${color}`;
}

/** Color of a file row inside an expanded commit's file list. */
export function getExpandedFileStatusStyle(code: string): string {
  if (code === 'M') return 'color: var(--color-warning)';
  if (code === 'A') return 'color: var(--color-success)';
  if (code === 'D') return 'color: var(--color-error)';
  return 'color: var(--text-primary)';
}

/** Single-character badge shown next to a file: '!' for conflicts, the code otherwise. */
export function getGitStatusBadgeChar(code: string | undefined): string {
  return code === 'Conflict' ? '!' : code ?? '';
}
