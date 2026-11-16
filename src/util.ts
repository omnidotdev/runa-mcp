/**
 * Pure helpers: text conversion between MCP clients (plain text) and Runa's
 * stored rich text (HTML from the web editor), task keys, and identifier
 * matching
 */

/** Escape text so it can never inject markup into stored HTML */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Plain text to the editor's HTML: one escaped paragraph per line */
export const plainTextToHtml = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

/**
 * Reduce stored rich-text HTML to plain text. Block-level boundaries become
 * spaces so words never run together; the result is not HTML-safe
 */
export const htmlToText = (html: string | null | undefined): string => {
  if (!html) return "";
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|#39|#x27|nbsp);/g,
      (entity) => ENTITIES[entity] ?? entity,
    )
    .replace(/\s+/g, " ")
    .trim();
};

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value looks like a row id rather than a name, slug, or key */
export const isUuid = (value: string): boolean => UUID_SHAPE.test(value.trim());

/** A task key such as `APP-12`, split into prefix and number */
export const parseTaskKey = (
  value: string,
): { prefix: string; number: number } | null => {
  const match = value.trim().match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { prefix: match[1], number: Number(match[2]) };
};

/** Human-readable task key, or null when the task has no number */
export const taskKey = (
  prefix: string | null | undefined,
  number: number | null | undefined,
): string | null => {
  if (number == null) return null;
  return prefix ? `${prefix}-${number}` : String(number);
};

/** Case- and whitespace-insensitive comparison for names and titles */
export const sameName = (a: string | null | undefined, b: string): boolean =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
