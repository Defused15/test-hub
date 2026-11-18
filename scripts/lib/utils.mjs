// ── Pure helpers shared across the build pipeline ────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Remove ANSI escape codes from a string (Playwright embeds them in errors). */
export const stripAnsi = s => (s ?? '').replace(ANSI_RE, '');

/** Format a millisecond duration for display: "1.23s" or "456ms". */
export const fmtDur = ms => ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';

/**
 * JSON.stringify for embedding inside an inline <script>. Escapes `<` so data
 * containing `</script>` or `<!--` cannot terminate or alter the script block,
 * and escapes U+2028/U+2029 line terminators.
 */
export const safeJson = v => JSON.stringify(v)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

/** Escape a value for use in HTML text or a quoted attribute. */
export const escHtml = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
