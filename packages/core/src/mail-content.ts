import sanitizeHtml from 'sanitize-html';
import { templatePlaceholders } from './document-templates.js';
import { formatDocumentDate, formatMinorUnits } from './document-totals.js';

// MAIL-EDITOR-01: the mail body contract. The editor produces the documented
// allowlist, but nothing here trusts the client: the server sanitizes, the
// server resolves placeholders and the server derives the text alternative.
// The placeholder syntax is the existing one of the document templates; the
// only addition is `{{contactFirstName}}` (the contact's own first name).

export const mailPlaceholders = [
  ...templatePlaceholders,
  'contactFirstName',
] as const;
export type MailPlaceholder = (typeof mailPlaceholders)[number];

export class MailContentError extends Error {
  constructor(readonly reason: 'invalid_content') {
    super('Mail content rejected');
  }
}

// Deliberately broader than the document token pattern: every `{{…}}` run
// must name a known placeholder. A typo like `{{contact_first_name}}` is
// rejected instead of travelling to the customer as literal text.
const token = /{{[^{}]*}}/g;

function nameOf(match: string): string {
  return match.slice(2, -2).trim();
}

export function assertMailPlaceholders(...texts: string[]): void {
  for (const text of texts)
    for (const match of text.match(token) ?? [])
      if (!(mailPlaceholders as readonly string[]).includes(nameOf(match)))
        throw new MailContentError('invalid_content');
}

/**
 * Replaces every known placeholder whose value exists. A known placeholder
 * without a value stays visible (transparent instead of silently emptied) and
 * is reported in `missing`; an unknown run is left as it is (the assertion
 * above is the gate that rejects it).
 */
export function resolveMailPlaceholders(
  text: string,
  values: Partial<Record<MailPlaceholder, string>>,
): { text: string; missing: MailPlaceholder[] } {
  const missing: MailPlaceholder[] = [];
  const resolved = text.replace(token, (match) => {
    const name = nameOf(match);
    if (!(mailPlaceholders as readonly string[]).includes(name)) return match;
    const value = values[name as MailPlaceholder];
    if (value === undefined) {
      if (!missing.includes(name as MailPlaceholder))
        missing.push(name as MailPlaceholder);
      return match;
    }
    return value;
  });
  return { text: resolved, missing };
}

/** Escapes one placeholder value for insertion into mail HTML. */
export function escapeMailHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The mail allowlist, exactly as documented in docs/mail-editor.md: text
// structure and emphasis only, links with safe schemes, nothing else. The
// pattern follows sanitizeNotes in events.ts.
export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'h2',
      'h3',
      'blockquote',
      'ul',
      'ol',
      'li',
      'a',
    ],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
  });
}

const namedEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // A non-breaking space is a formatting artifact; the plain-text
  // alternative says space.
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g,
    (match, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body[1] === 'x'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return namedEntities[body.toLowerCase()] ?? match;
    },
  );
}

/**
 * Resolves a plain-text subject: every value is flattened to one line first,
 * so no placeholder value can ever inject a header line.
 */
export function resolveMailSubject(
  subject: string,
  values: Partial<Record<MailPlaceholder, string>>,
): { subject: string; missing: MailPlaceholder[] } {
  const flat = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      value.replace(/[\r\n\t]+/g, ' '),
    ]),
  ) as Partial<Record<MailPlaceholder, string>>;
  const resolved = resolveMailPlaceholders(subject, flat);
  return { subject: resolved.text, missing: resolved.missing };
}

/**
 * The structured sources one document mail may name. Every value below comes
 * from a stored field; nothing is guessed from a composite name.
 */
export type MailValueSources = {
  /** Admin origin for {{documentLink}}; empty means the link has no value. */
  origin: string;
  // MAIL-EVENT-02: null for a free mail; total and link then have no value.
  document: { id: string; grossMinor: number } | null;
  contact?: { name: string; firstName: string } | null;
  event?: {
    name: string;
    eventDate: string | null;
    venue: string | null;
    venueOverride: boolean;
    locationName: string | null;
    eventTypeName: string | null;
    packageName: string | null;
  } | null;
  /** Tenant timezone for {{date}}. */
  timezone: string;
};

export function mailPlaceholderValues(
  sources: MailValueSources,
): Partial<Record<MailPlaceholder, string>> {
  const values: Partial<Record<MailPlaceholder, string>> = {};
  if (sources.document) {
    values.total = formatMinorUnits(sources.document.grossMinor) + ' €';
    if (sources.origin)
      values.documentLink =
        sources.origin + '/#document-' + sources.document.id;
  }
  if (sources.contact) {
    values.contact = sources.contact.name;
    if (sources.contact.firstName)
      values.contactFirstName = sources.contact.firstName;
  }
  const event = sources.event;
  if (event) {
    values.event = event.name;
    if (event.eventDate)
      values.date = formatDocumentDate(
        new Date(event.eventDate + 'T12:00:00Z'),
        sources.timezone,
      );
    // The effective place, exactly like the documents: the free-text venue
    // when overridden (an emptied one stays missing), else the stock name.
    if (event.venueOverride) {
      const place = event.venue?.trim();
      if (place) values.location = place;
    } else if (event.locationName) values.location = event.locationName;
    if (event.eventTypeName) values.eventType = event.eventTypeName;
    if (event.packageName) values.package = event.packageName;
  }
  return values;
}

/**
 * The plain-text alternative, derived on the server from already sanitized
 * mail HTML (run `sanitizeMailHtml` first; raw HTML may break the scanner).
 * Documented rules: `<br>` is a line break, `</p>` and headings separate
 * blocks with one blank line, list items get `- ` or counting `1. `
 * prefixes, quotes carry the conventional `> ` marker per line, a link
 * becomes `Text (URL)` unless the text already is the URL, entities decode,
 * and the result carries no trailing spaces and at most one blank line.
 */
export function mailBodyTextFromHtml(html: string): string {
  const lines: string[] = [];
  let current = '';
  let quoteDepth = 0;
  const lists: { ordered: boolean; count: number }[] = [];
  // Inside a quote every non-empty line carries the conventional marker;
  // blank separator lines stay blank so the blocks remain readable.
  const pushLine = (line: string) =>
    lines.push(quoteDepth > 0 && line ? '> '.repeat(quoteDepth) + line : line);
  const anchors: { href: string; mark: number }[] = [];
  for (const part of html.split(/(<[^>]*>)/)) {
    if (!part) continue;
    if (part.startsWith('<')) {
      const match = /^<\s*(\/?)\s*([a-zA-Z0-9]+)[^>]*>/.exec(part);
      if (!match) continue;
      const closing = match[1] === '/',
        tag = match[2]!.toLowerCase();
      if (tag === 'br') {
        pushLine(current);
        current = '';
      } else if (tag === 'p' || tag === 'h2' || tag === 'h3') {
        if (closing) {
          pushLine(current);
          current = '';
          lines.push('');
        }
      } else if (tag === 'blockquote') {
        if (current.trim()) {
          pushLine(current);
          current = '';
        }
        if (closing) {
          pushLine(current);
          current = '';
          quoteDepth = Math.max(0, quoteDepth - 1);
          lines.push('');
        } else quoteDepth += 1;
      } else if (tag === 'ul' || tag === 'ol') {
        if (current.trim()) {
          pushLine(current);
          current = '';
        }
        if (closing) {
          lists.pop();
          lines.push('');
        } else lists.push({ ordered: tag === 'ol', count: 0 });
      } else if (tag === 'li') {
        if (closing) {
          pushLine(current);
          current = '';
        } else {
          if (current.trim()) pushLine(current);
          const list = lists[lists.length - 1];
          if (list?.ordered) {
            list.count += 1;
            current = `${list.count}. `;
          } else current = '- ';
        }
      } else if (tag === 'a') {
        if (closing) {
          const anchor = anchors.pop();
          if (anchor) {
            const text = current.slice(anchor.mark);
            if (text.trim() && text.trim() !== anchor.href)
              current += ` (${anchor.href})`;
          }
        } else {
          const href = /href="([^"]*)"/.exec(part)?.[1] ?? '';
          anchors.push({ href: decodeEntities(href), mark: current.length });
        }
      }
      continue;
    }
    current += decodeEntities(part);
  }
  if (current.trim()) pushLine(current);
  return (
    lines
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      // NBSP from the editor's DOM never reaches the text alternative.
      .replace(/\u00a0/g, ' ')
      .trim()
  );
}
