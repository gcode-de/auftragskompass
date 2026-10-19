import type { Pool } from 'pg';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { database } from './database.js';
import { documentLayouts } from './schema.js';
import { AccessError, lockTenant, requireAdministrator } from './access.js';
import { appendAudit } from './audit.js';
import {
  renderTemplate,
  type TemplatePlaceholder,
} from './document-templates.js';
import {
  documentTotals,
  formatDocumentDate,
  formatMinorUnits,
  type TotalsLine,
} from './document-totals.js';

export class DocumentLayoutError extends Error {
  constructor(readonly reason: 'not_found' | 'conflict') {
    super('Document layout rejected');
  }
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
};

const fontStacks: Record<DocumentLayoutInput['fontFamily'], string> = {
  system: 'system-ui, "Segoe UI", sans-serif',
  sans: '"Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
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
  timeZone: string;
  recipientName: string;
  recipientAddress: string;
  subject: string;
  introText: string;
  outroText: string;
  lines: readonly DocumentLineInput[];
  values: Partial<Record<TemplatePlaceholder, string>>;
};

// Deterministic by construction: no clock, no locale lookup beyond the tenant
// timezone, and prices formatted by hand rather than by Intl currency.
export function renderDocumentHtml(input: DocumentRenderInput): string {
  const { layout } = input,
    totals = documentTotals(input.lines),
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
                )} %</td><td>${formatMinorUnits(group.taxMinor)} €</td></tr>`,
            )
            .join('\n')
        : `      <tr><td>Umsatzsteuer ${percent(
            totals.taxGroups[0]?.taxBasisPoints ?? 0,
          )} %</td><td>${formatMinorUnits(totals.taxMinor)} €</td></tr>`;
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
      .page-numbers { color: ${layout.primaryColor}; font-size: 8pt; text-align: right; }
    </style>
  </head>
  <body>
    <p class="sender">${[
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
    <h1>${escapeHtml(renderTemplate(input.subject, input.values))}</h1>
    <p>${lines(renderTemplate(input.introText, input.values))}</p>
    <table>
      <thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>
      <tbody>
${rows.join('\n')}
      </tbody>
    </table>
    <table class="totals">
      <tr><td>Netto</td><td>${formatMinorUnits(totals.netMinor)} €</td></tr>
${taxRows}
      <tr><td>Brutto</td><td>${formatMinorUnits(totals.grossMinor)} €</td></tr>
    </table>
    <p>${lines(renderTemplate(input.outroText, input.values))}</p>
${
  layout.showPageNumbers
    ? '    <p class="page-numbers">Seite 1</p>'
    : '    <div class="page-numbers" hidden></div>'
}
  </body>
</html>
`;
}

export function documentLayoutRepository(pool: Pool, tenantId: string) {
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
        if (old && old.version !== version)
          throw new DocumentLayoutError('conflict');
        const values = {
          ...input,
          senderName: input.senderName.trim(),
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
  };
}

export function registerDocumentLayoutRoutes(
  app: FastifyInstance,
  pool: Pool,
  tenantId: string,
) {
  const repo = documentLayoutRepository(pool, tenantId);
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
    if (error instanceof DocumentLayoutError)
      return reply
        .code(error.reason === 'conflict' ? 409 : 404)
        .send({ error: error.reason });
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
}
