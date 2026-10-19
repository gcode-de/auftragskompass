import { describe, expect, test } from 'vitest';
import {
  assertTemplateText,
  DocumentTemplateError,
  renderTemplate,
  templateTokens,
} from '../../packages/core/src/document-templates.js';

describe('templateTokens', () => {
  test('extracts every placeholder name in order', () => {
    expect(templateTokens('Hallo {{contact}}, Termin {{ date }}')).toEqual([
      'contact',
      'date',
    ]);
  });
  test('ignores text without placeholders', () => {
    expect(templateTokens('Nur Text, keine Klammern.')).toEqual([]);
  });
});

describe('assertTemplateText', () => {
  test('accepts every documented placeholder across all fields', () => {
    expect(() =>
      assertTemplateText(
        'Angebot für {{contact}}',
        'Event {{event}} am {{date}} in {{location}}',
        '{{eventType}} {{package}} {{total}} {{documentLink}}',
      ),
    ).not.toThrow();
  });
  test('rejects an unknown placeholder instead of leaving it to the customer', () => {
    expect(() => assertTemplateText('Hallo {{kontakt}}')).toThrow(
      DocumentTemplateError,
    );
  });
});

describe('renderTemplate', () => {
  const values = {
    contact: 'Fictional Contact',
    event: 'Fictional Event',
    date: '27.10.2030',
    location: 'Fictional Hall',
    eventType: 'Hochzeit',
    package: 'Fotobox-Paket',
    total: '1.299,00 €',
    documentLink: 'https://fictional.example.invalid/d/1',
  };
  test('replaces every placeholder with its supplied value', () => {
    expect(
      renderTemplate('{{contact}} feiert am {{date}} in {{location}}.', values),
    ).toBe('Fictional Contact feiert am 27.10.2030 in Fictional Hall.');
  });
  test('replaces a repeated placeholder everywhere', () => {
    expect(renderTemplate('{{event}} / {{event}}', values)).toBe(
      'Fictional Event / Fictional Event',
    );
  });
  test('tolerates surrounding whitespace inside the braces', () => {
    expect(renderTemplate('Hallo {{ contact }}', values)).toBe(
      'Hallo Fictional Contact',
    );
  });
  test('rejects rendering when a referenced value is missing', () => {
    expect(() => renderTemplate('Hallo {{contact}}', {})).toThrow(
      DocumentTemplateError,
    );
  });
  test('leaves text without placeholders untouched', () => {
    expect(renderTemplate('Keine Platzhalter.', values)).toBe(
      'Keine Platzhalter.',
    );
  });
});
