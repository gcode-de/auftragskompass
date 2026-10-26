import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { database } from './database.js';
import { documentLayouts, tenants } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import {
  DocumentPdfError,
  renderDocumentPdf,
  type PdfRenderer,
} from './document-pdf.js';
import { StorageError, type StorageAdapter } from './storage.js';
import {
  DocumentTotalsError,
  documentTotals,
  formatDocumentDate,
  formatMinorUnits,
  type TotalsLine,
} from './document-totals.js';
import { validityDate } from './document-snapshot.js';
import {
  assertTemplateText,
  documentTemplateFields,
  DocumentTemplateError,
  renderTemplate,
  type DocumentTemplateInput,
  type TemplatePlaceholder,
} from './document-templates.js';

export class DocumentLayoutError extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'conflict'
      | 'invalid_logo'
      | 'logo_too_large'
      | 'missing_reference'
      | 'invalid_template'
      | 'preview_failed',
  ) {
    super('Document layout rejected');
  }
}

export const logoLimit = 512 * 1024;

// The declared media type only counts when the bytes agree with it; otherwise
// a renamed text file would end up inside a customer-facing PDF.
export function assertLogo(
  bytes: Buffer,
  declared: string,
): 'image/png' | 'image/jpeg' {
  if (!Buffer.isBuffer(bytes) || !bytes.byteLength)
    throw new DocumentLayoutError('invalid_logo');
  if (bytes.byteLength > logoLimit)
    throw new DocumentLayoutError('logo_too_large');
  const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    sniffed = png ? 'image/png' : jpeg ? 'image/jpeg' : null;
  if (!sniffed || sniffed !== declared)
    throw new DocumentLayoutError('invalid_logo');
  return sniffed;
}

export type DocumentLayoutInput = {
  senderName: string;
  senderStreet: string;
  senderPostalCode: string;
  senderCity: string;
  primaryColor: string;
  textColor: string;
  fontFamily: 'system' | 'sans' | 'serif';
  showPageNumbers: boolean;
  showPositionNumbers: boolean;
  /**
   * BKP019.c2: the printed reference of a correction - a print option, never a
   * stored layout field. `documents.ts` builds it per render and the snapshot
   * forwards the layout object unchanged, so a document without a reference
   * keeps byte-identical HTML. `save` strips it, and no route accepts it.
   */
  correctionReference?: DocumentCorrectionReference;
};

/**
 * What a correction prints about the document it corrects. Every amount is a
 * magnitude in minor units, exactly like the stored ones; the direction is what
 * turns them into a credit or a follow-up charge.
 */
export type DocumentCorrectionReference = {
  /** Number of the corrected document, e.g. `RE-2030-0001`. */
  number: string;
  /** Its issue date, already formatted the way the PDF prints dates. */
  date: string;
  direction: 'credit' | 'debit';
  /** The corrected document's gross. */
  sourceGrossMinor: number;
  /** This correction's own gross. */
  correctionGrossMinor: number;
  /** What stays open after this correction. */
  correctedGrossMinor: number;
};

const fontStacks: Record<DocumentLayoutInput['fontFamily'], string> = {
  system: 'system-ui, "Segoe UI", sans-serif',
  sans: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
};

const fictionalPreviewLayout: DocumentLayoutInput = {
  senderName: 'Fiktive Inhaltsvorschau',
  senderStreet: 'Example Street 1',
  senderPostalCode: '12345',
  senderCity: 'Example Town',
  primaryColor: '#444444',
  textColor: '#1b1b1b',
  fontFamily: 'system',
  showPageNumbers: false,
  showPositionNumbers: true,
};

// Every interpolated value goes through this before it reaches markup.
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function lines(html: string): string {
  return escapeHtml(html).replace(/\r?\n/g, '<br>');
}

// Basis points to a plain percentage: 1900 -> '19', 750 -> '7,50'.
function percent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100),
    rest = basisPoints % 100;
  return rest ? `${whole},${String(rest).padStart(2, '0')}` : String(whole);
}

export type DocumentLineInput = TotalsLine & {
  description: string;
  unit: string;
};
export type DocumentRenderInput = {
  layout: DocumentLayoutInput;
  documentNumber: string;
  issuedAt: Date;
  validUntil?: string;
  timeZone: string;
  recipientName: string;
  recipientAddress: string;
  subject: string;
  introText: string;
  outroText: string;
  lines: readonly DocumentLineInput[];
  values: Partial<Record<TemplatePlaceholder, string>>;
  logoDataUri?: string;
};

// Deterministic by construction: no clock, no locale lookup beyond the tenant
// timezone, and prices formatted by hand rather than by Intl currency.
export function renderDocumentHtml(input: DocumentRenderInput): string {
  const { layout } = input,
    totals = documentTotals(input.lines),
    // BKP019.c2: a credit note prints the signed sum of the same magnitudes it
    // stores - the negation happens here, never in `document-totals` and never
    // in the row. Positive amounts stay positive for a debit.
    reference = layout.correctionReference,
    sign = reference?.direction === 'credit' ? -1 : 1,
    printed = (minor: number) => sign * minor,
    rows = input.lines.map((line, index) => {
      const computed = totals.lines[index]!,
        cells = [
          ...(layout.showPositionNumbers ? [String(index + 1)] : []),
          escapeHtml(line.description),
          `${line.quantity} ${escapeHtml(line.unit)}`,
          formatMinorUnits(line.unitPriceMinor),
          line.discountBasisPoints
            ? percent(line.discountBasisPoints) + ' %'
            : '',
          formatMinorUnits(computed.grossMinor),
        ];
      return `    <tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
    }),
    head = [
      ...(layout.showPositionNumbers ? ['Pos.'] : []),
      'Beschreibung',
      'Menge',
      'Einzelpreis',
      'Rabatt',
      'Gesamt',
    ],
    taxRows =
      totals.taxGroups.length > 1
        ? totals.taxGroups
            .map(
              (group) =>
                `      <tr><td>Umsatzsteuer ${percent(
                  group.taxBasisPoints,
                )} %</td><td>${formatMinorUnits(printed(group.taxMinor))} €</td></tr>`,
            )
            .join('\n')
        : `      <tr><td>Umsatzsteuer ${percent(
            totals.taxGroups[0]?.taxBasisPoints ?? 0,
          )} %</td><td>${formatMinorUnits(printed(totals.taxMinor))} €</td></tr>`;
  const pageNumbers = layout.showPageNumbers
    ? `      @page {
        @bottom-right {
          content: "Seite " counter(page) " von " counter(pages);
          color: ${layout.primaryColor};
          font-family: ${fontStacks[layout.fontFamily]};
          font-size: 8pt;
          padding-right: 16mm;
        }
      }
`
    : '';
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(input.documentNumber)}</title>
    <style>
      body { color: ${layout.textColor}; font-family: ${fontStacks[layout.fontFamily]}; font-size: 11pt; margin: 18mm 16mm; }
      h1 { color: ${layout.primaryColor}; font-size: 15pt; margin: 6mm 0 3mm; }
      .sender { border-bottom: 1px solid ${layout.primaryColor}; font-size: 8pt; padding-bottom: 1mm; }
      .meta { display: flex; justify-content: space-between; margin-bottom: 4mm; }
      table { border-collapse: collapse; width: 100%; }
      th { border-bottom: 1px solid ${layout.primaryColor}; text-align: left; }
      td, th { padding: 1.5mm 1mm; }
      td:last-child, th:last-child, .totals td:last-child { text-align: right; }
      .totals { margin-top: 3mm; margin-left: auto; width: 60mm; }
${pageNumbers}      .logo { display: block; max-height: 18mm; margin-bottom: 2mm; }
    </style>
  </head>
  <body>
${
  input.logoDataUri
    ? `    <img class="logo" src="${escapeHtml(input.logoDataUri)}" alt="">\n`
    : ''
}    <p class="sender">${[
    layout.senderName,
    layout.senderStreet,
    layout.senderPostalCode + ' ' + layout.senderCity,
  ]
    .map(escapeHtml)
    .join(' · ')}</p>
    <address>${lines(input.recipientName + '\n' + input.recipientAddress)}</address>
    <div class="meta">
      <p>Nummer ${escapeHtml(input.documentNumber)}</p>
      <p>Datum ${formatDocumentDate(input.issuedAt, input.timeZone)}</p>
    </div>
${
  reference
    ? `    <p>Korrektur zu ${escapeHtml(reference.number)} vom ${escapeHtml(reference.date)}</p>\n`
    : ''
}${
    input.validUntil
      ? `    <p>Gültig bis ${escapeHtml(input.validUntil)}</p>\n`
      : ''
  }    <h1>${escapeHtml(renderTemplate(input.subject, input.values))}</h1>
    <p>${lines(renderTemplate(input.introText, input.values))}</p>
    <table>
      <thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>
      <tbody>
${rows.join('\n')}
      </tbody>
    </table>
    <table class="totals">
      <tr><td>Netto</td><td>${formatMinorUnits(printed(totals.netMinor))} €</td></tr>
${taxRows}
      <tr><td>Brutto</td><td>${formatMinorUnits(printed(totals.grossMinor))} €</td></tr>
    </table>
${
  reference
    ? `    <table class="totals">
      <tr><td>Rechnungsbetrag</td><td>${formatMinorUnits(reference.sourceGrossMinor)} €</td></tr>
      <tr><td>${
        reference.direction === 'credit'
          ? 'Offene Gutschrift'
          : 'Nachberechnung'
      }</td><td>${formatMinorUnits(
        printed(reference.correctionGrossMinor),
      )} €</td></tr>
      <tr><td>Korrigierter Betrag</td><td>${formatMinorUnits(
        reference.correctedGrossMinor,
      )} €</td></tr>
    </table>\n`
    : ''
}    <p>${lines(renderTemplate(input.outroText, input.values))}</p>
  </body>
</html>
`;
}

export function documentLayoutRepository(
  pool: Pool,
  tenantId: string,
  store: StorageAdapter,
) {
  const scope = eq(documentLayouts.tenantId, tenantId);
  return {
    async get() {
      const [row] = await database(pool)
        .select()
        .from(documentLayouts)
        .where(scope);
      return row ?? null;
    },
    async save(actorId: string, input: DocumentLayoutInput, version?: number) {
      return database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [old] = await tx.select().from(documentLayouts).where(scope);
        if (!old && version !== undefined)
          throw new DocumentLayoutError('not_found');
        if (old && old.version !== version)
          throw new DocumentLayoutError('conflict');
        // BKP019.c2: the correction reference is a per-render print option, not
        // a layout column. The stored values are therefore listed explicitly
        // instead of spreading the input.
        const values = {
          senderName: input.senderName.trim(),
          senderStreet: input.senderStreet,
          senderPostalCode: input.senderPostalCode,
          senderCity: input.senderCity,
          primaryColor: input.primaryColor,
          textColor: input.textColor,
          fontFamily: input.fontFamily,
          showPageNumbers: input.showPageNumbers,
          showPositionNumbers: input.showPositionNumbers,
          version: (old?.version ?? 0) + 1,
        };
        const [row] = old
          ? await tx
              .update(documentLayouts)
              .set(values)
              .where(scope)
              .returning()
          : await tx
              .insert(documentLayouts)
              .values({ ...values, tenantId })
              .returning();
        await appendAudit(tx, tenantId, 'document_layout.updated', actorId);
        return row!;
      });
    },
    async preview(
      actorId: string,
      input: DocumentLayoutInput,
      render: PdfRenderer,
    ) {
      const context = await database(pool).transaction(async (tx) => {
        await tx.execute(
          sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
        );
        await requireAdministrator(tx, tenantId, actorId);
        const [tenant] = await tx
            .select({ timeZone: tenants.timezone })
            .from(tenants)
            .where(eq(tenants.id, tenantId)),
          [layout] = await tx
            .select({
              logoKey: documentLayouts.logoKey,
              logoMediaType: documentLayouts.logoMediaType,
            })
            .from(documentLayouts)
            .where(scope);
        if (!tenant) throw new DocumentLayoutError('missing_reference');
        return {
          timeZone: tenant.timeZone,
          logoKey: layout?.logoKey,
          logoMediaType: layout?.logoMediaType,
        };
      });
      let logoDataUri: string | undefined;
      if (context.logoKey && context.logoMediaType) {
        try {
          const logo = await store.read(context.logoKey);
          logoDataUri = `data:${context.logoMediaType};base64,${logo.toString('base64')}`;
        } catch (error) {
          throw new DocumentLayoutError(
            error instanceof StorageError && error.reason === 'missing'
              ? 'missing_reference'
              : 'preview_failed',
          );
        }
      }
      const html = renderDocumentHtml({
        layout: input,
        documentNumber: 'VORSCHAU',
        issuedAt: new Date('2030-10-26T10:00:00.000Z'),
        timeZone: context.timeZone,
        recipientName: 'Beispielkunde',
        recipientAddress: 'Beispielstraße 1\n12345 Beispielstadt',
        subject: 'Beispielangebot',
        introText: 'Vielen Dank für Ihre Anfrage.',
        outroText: 'Wir freuen uns auf Ihre Rückmeldung.',
        lines: [
          {
            description: 'Beispielposition',
            unit: 'Stück',
            quantity: 1,
            unitPriceMinor: 10000,
            taxBasisPoints: 1900,
            discountBasisPoints: 0,
          },
        ],
        values: {},
        ...(logoDataUri ? { logoDataUri } : {}),
      });
      try {
        return await renderDocumentPdf(html, render);
      } catch (error) {
        if (error instanceof DocumentPdfError)
          throw new DocumentLayoutError('preview_failed');
        throw error;
      }
    },
    async previewTemplate(
      actorId: string,
      input: DocumentTemplateInput,
      render: PdfRenderer,
    ) {
      await database(pool).transaction(async (tx) => {
        await tx.execute(
          sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
        );
        await requireAdministrator(tx, tenantId, actorId);
      });
      try {
        assertTemplateText(input.subject, input.introText, input.outroText);
        const issuedAt = new Date('2030-10-26T10:00:00.000Z'),
          timeZone = 'Europe/Berlin',
          totals = documentTotals(input.positions),
          values: Partial<Record<TemplatePlaceholder, string>> = {
            contact: 'Alex Beispiel',
            event: 'Fiktives Sommerfest',
            date: formatDocumentDate(issuedAt, timeZone),
            location: 'Beispielsaal',
            eventType: 'Feier',
            package: 'Paket Beispiel',
            total: `${formatMinorUnits(totals.grossMinor)} €`,
            documentLink: 'https://example.invalid/vorschau',
          };
        return await renderDocumentPdf(
          renderDocumentHtml({
            layout: fictionalPreviewLayout,
            documentNumber: 'VORSCHAU',
            issuedAt,
            ...(input.kind === 'offer'
              ? {
                  validUntil: validityDate(
                    issuedAt,
                    input.validityDays,
                    timeZone,
                  )
                    .toString()
                    .split('-')
                    .reverse()
                    .join('.'),
                }
              : {}),
            timeZone,
            recipientName: 'Alex Beispiel',
            recipientAddress: 'Beispielweg 7\n12345 Beispielstadt',
            subject: input.subject,
            introText: input.introText,
            outroText: input.outroText,
            lines: input.positions,
            values,
          }),
          render,
        );
      } catch (error) {
        if (error instanceof DocumentTemplateError) throw error;
        if (error instanceof DocumentTotalsError)
          throw new DocumentLayoutError('invalid_template');
        if (error instanceof DocumentPdfError)
          throw new DocumentLayoutError('preview_failed');
        throw error;
      }
    },
    // The logo lives outside the row: the bytes go to the storage adapter and
    // the layout only keeps the derived key and media type.
    // Keep old and uncertain-upload bytes: checkpoints and in-flight renders
    // may still reference them. Unique keys make failed writes harmless.
    async saveLogo(actorId: string, bytes: Buffer, declared: string) {
      const mediaType = assertLogo(bytes, declared),
        key = `logo-${tenantId}-${randomUUID()}.${mediaType === 'image/png' ? 'png' : 'jpg'}`;
      return database(pool).transaction(async (tx) => {
        await lockTenant(tx, tenantId);
        await requireAdministrator(tx, tenantId, actorId);
        const [old] = await tx.select().from(documentLayouts).where(scope);
        if (!old) throw new DocumentLayoutError('not_found');
        await store.put(key, bytes);
        const [updated] = await tx
          .update(documentLayouts)
          .set({
            logoKey: key,
            logoMediaType: mediaType,
            version: old.version + 1,
          })
          .where(scope)
          .returning();
        await appendAudit(tx, tenantId, 'document_layout.updated', actorId);
        return updated!;
      });
    },
  };
}

export function registerDocumentLayoutRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
  store: StorageAdapter,
  render: PdfRenderer,
) {
  const repo = documentLayoutRepository(pool, tenantId, store);
  // Raw image bodies never pass through JSON; the parser limit is the first
  // size guard, the repository repeats it for direct callers.
  for (const type of ['image/png', 'image/jpeg'])
    if (!app.hasContentTypeParser(type))
      app.addContentTypeParser(
        type,
        { parseAs: 'buffer', bodyLimit: logoLimit },
        (_request, body, done) => done(null, body),
      );
  const fields = {
    senderName: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      pattern: '\\S',
    },
    senderStreet: { type: 'string', maxLength: 120 },
    senderPostalCode: { type: 'string', maxLength: 20 },
    senderCity: { type: 'string', maxLength: 80 },
    primaryColor: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
    textColor: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
    fontFamily: { type: 'string', enum: ['system', 'sans', 'serif'] },
    showPageNumbers: { type: 'boolean' },
    showPositionNumbers: { type: 'boolean' },
  };
  const version = { type: 'integer', minimum: 1 };
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof AccessError)
      return reply.code(403).send({ error: 'forbidden' });
    if (error instanceof DocumentTemplateError)
      return reply.code(400).send({ error: error.reason });
    if (error instanceof DocumentLayoutError) {
      if (error.reason === 'not_found')
        return reply.code(404).send({ error: 'not_found' });
      if (error.reason === 'conflict')
        return reply.code(409).send({ error: 'conflict' });
      if (error.reason === 'missing_reference')
        return reply.code(404).send({ error: 'missing_reference' });
      if (error.reason === 'preview_failed')
        return reply.code(500).send({ error: 'preview_failed' });
      if (error.reason === 'invalid_template')
        return reply.code(400).send({ error: 'invalid_template' });
      // The parser limit already rejects oversized bodies, so a size error
      // here can only come from a direct repository caller.
      return reply.code(400).send({ error: error.reason });
    }
    throw error;
  }
  app.get('/api/v1/document-layout', async (_request, reply) => {
    const row = await repo.get();
    return row ?? reply.code(404).send({ error: 'not_found' });
  });
  app.post<{ Body: DocumentLayoutInput }>(
    '/api/v1/document-layout',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(fields),
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(await repo.save(request.authSession!.userId, request.body));
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Body: DocumentLayoutInput & { version: number } }>(
    '/api/v1/document-layout',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: [...Object.keys(fields), 'version'],
          properties: { ...fields, version },
        },
      },
    },
    async (request, reply) => {
      try {
        return await repo.save(
          request.authSession!.userId,
          request.body,
          request.body.version,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Body: DocumentLayoutInput }>(
    '/api/v1/document-layout/preview',
    {
      preValidation: async (request, reply) => {
        const body = request.body;
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length !== Object.keys(fields).length ||
          Object.keys(fields).some((field) => !(field in body))
        )
          return reply.code(400).send({ error: 'invalid_layout' });
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(fields),
          properties: fields,
        },
      },
    },
    async (request, reply) => {
      try {
        const pdf = await repo.preview(
          request.authSession!.userId,
          request.body,
          render,
        );
        return reply
          .type('application/pdf')
          .header('Cache-Control', 'no-store')
          .header('Content-Disposition', 'inline; filename="VORSCHAU.pdf"')
          .send(pdf.bytes);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.post<{ Body: DocumentTemplateInput }>(
    '/api/v1/document-templates/preview',
    {
      preValidation: async (request, reply) => {
        const body = request.body;
        const input = body as Record<string, unknown> | null;
        const fields = Object.keys(documentTemplateFields);
        const positionFields = [
          'description',
          'quantity',
          'unit',
          'unitPriceMinor',
          'taxBasisPoints',
          'discountBasisPoints',
        ];
        const validPosition = (position: unknown) => {
          if (
            !position ||
            typeof position !== 'object' ||
            Array.isArray(position)
          )
            return false;
          const row = position as Record<string, unknown>;
          const keys = Object.keys(row);
          return (
            keys.every(
              (key) => positionFields.includes(key) || key === 'productId',
            ) &&
            positionFields.every((key) => key in row) &&
            typeof row.description === 'string' &&
            typeof row.unit === 'string' &&
            [
              'quantity',
              'unitPriceMinor',
              'taxBasisPoints',
              'discountBasisPoints',
            ].every((key) => typeof row[key] === 'number') &&
            (!('productId' in row) ||
              row.productId === null ||
              typeof row.productId === 'string')
          );
        };
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length !== fields.length ||
          fields.some((field) => !Object.hasOwn(input, field)) ||
          !['kind', 'name', 'subject', 'introText', 'outroText', 'state'].every(
            (field) => typeof input[field] === 'string',
          ) ||
          typeof input.validityDays !== 'number' ||
          !Array.isArray(input.positions) ||
          !input.positions.every(validPosition)
        )
          return reply.code(400).send({ error: 'invalid_template' });
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(documentTemplateFields),
          properties: documentTemplateFields,
        },
      },
    },
    async (request, reply) => {
      try {
        const pdf = await repo.previewTemplate(
          request.authSession!.userId,
          request.body,
          render,
        );
        return reply
          .type('application/pdf')
          .header('Cache-Control', 'no-store')
          .header('Content-Disposition', 'inline; filename="VORSCHAU.pdf"')
          .send(pdf.bytes);
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
  app.put<{ Body: Buffer }>(
    '/api/v1/document-layout/logo',
    async (request, reply) => {
      try {
        const declared = String(request.headers['content-type'] ?? '')
          .split(';')[0]!
          .trim()
          .toLowerCase();
        return await repo.saveLogo(
          request.authSession!.userId,
          request.body,
          declared,
        );
      } catch (error) {
        return failure(error, reply);
      }
    },
  );
}
