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

/** A bare calendar date, `YYYY-MM-DD` */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ISO 8601 timestamp with an explicit offset, split into its local date,
 * local time-of-day digits, and offset
 */
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** A due date as the Runa API stores it */
export interface DueDateInput {
  dueDate: string | null;
  dueHasTime: boolean;
}

/**
 * Map a due date argument to Runa's storage contract. A bare date, or a
 * timestamp at exactly midnight in its own stated offset, is an all-day due
 * date stored as UTC midnight of that calendar day. Any other timestamp is a
 * timed due date at that exact instant. Null clears the due date
 */
export const toDueDateInput = (value: string | null): DueDateInput => {
  if (value === null) return { dueDate: null, dueHasTime: false };

  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) {
    return { dueDate: `${trimmed}T00:00:00Z`, dueHasTime: false };
  }

  const match = trimmed.match(DATE_TIME);
  if (match) {
    const [, day, hours, minutes, seconds, fraction] = match;
    const isMidnight =
      hours === "00" &&
      minutes === "00" &&
      (seconds ?? "00") === "00" &&
      !/[1-9]/.test(fraction ?? "");
    if (isMidnight) return { dueDate: `${day}T00:00:00Z`, dueHasTime: false };
  }

  return { dueDate: trimmed, dueHasTime: true };
};

/**
 * Present a stored due date: an all-day due date as its `YYYY-MM-DD` day, a
 * timed one as the stored instant. The all-day day is the UTC date of the
 * nearest UTC midnight, so legacy rows stored at a local midnight (UTC-11 to
 * UTC+12) still resolve to the intended day
 */
export const presentDueDate = (
  dueDate: string | null | undefined,
  dueHasTime: boolean | null | undefined,
): string | null => {
  if (!dueDate) return null;
  if (dueHasTime) return dueDate;
  const instant = Date.parse(dueDate);
  if (Number.isNaN(instant)) return dueDate;
  return new Date(instant + HALF_DAY_MS).toISOString().slice(0, 10);
};
