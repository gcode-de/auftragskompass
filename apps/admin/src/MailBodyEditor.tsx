import { useEffect, useReducer, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Link from '@tiptap/extension-link';
import History from '@tiptap/extension-history';

// The plain-language meaning of every offered placeholder follows the actual
// render sites in packages/core/src/mail-content.ts (docs/mail-editor.md):
// values come from structured fields only, and a known placeholder without a
// value stays visible instead of being silently emptied. Exported so a test
// can prove the offer matches `mailPlaceholders` of the core package.
export const mailPlaceholderOffers = [
  {
    name: 'contact',
    label: 'Kunde',
    meaning: 'Name des Hauptkontakts',
    description:
      'Ersetzt durch den Namen des Hauptkontakts, zum Beispiel Alex Beispiel.',
  },
  {
    name: 'contactFirstName',
    label: 'Kontakt-Vorname',
    meaning: 'Vorname des Hauptkontakts',
    description:
      'Ersetzt durch den hinterlegten Vornamen des Hauptkontakts, zum Beispiel Erika. Ohne hinterlegten Vornamen bleibt die Stelle sichtbar.',
  },
  {
    name: 'event',
    label: 'Veranstaltung',
    meaning: 'Name der Veranstaltung',
    description:
      'Ersetzt durch den Namen der Veranstaltung, zum Beispiel Fiktives Sommerfest.',
  },
  {
    name: 'date',
    label: 'Datum',
    meaning: 'Datum der Veranstaltung',
    description:
      'Ersetzt durch das Datum der Veranstaltung, zum Beispiel 26.10.2030.',
  },
  {
    name: 'location',
    label: 'Ort',
    meaning: 'Ort der Veranstaltung',
    description:
      'Ersetzt durch den Ort der Veranstaltung, zum Beispiel Beispielsaal. Ohne hinterlegten Ort bleibt die Stelle sichtbar.',
  },
  {
    name: 'eventType',
    label: 'Veranstaltungsart',
    meaning: 'Art der Veranstaltung',
    description: 'Ersetzt durch die Art der Veranstaltung, zum Beispiel Feier.',
  },
  {
    name: 'package',
    label: 'Paket',
    meaning: 'Name des gebuchten Pakets',
    description:
      'Ersetzt durch den Namen des gebuchten Pakets, zum Beispiel Paket Beispiel.',
  },
  {
    name: 'total',
    label: 'Gesamtbetrag',
    meaning: 'Bruttosumme des Dokuments',
    description:
      'Ersetzt durch die Bruttosumme des Dokuments mit Euro-Zeichen, zum Beispiel 119,00 €.',
  },
  {
    name: 'documentLink',
    label: 'Dokumentlink',
    meaning: 'Verweis in die Verwaltung',
    description:
      'Ersetzt durch einen Verweis auf das Dokument in der Verwaltung.',
  },
] as const;

// The editor produces exactly the mail allowlist (docs/mail-editor.md):
// paragraphs, emphasis, lists and links - nothing else. The server sanitizes
// again regardless. The extensions are module-level so `useEditor` never sees
// churn and never resets or steals focus on an unrelated re-render.
const mailExtensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  BulletList,
  OrderedList,
  ListItem,
  Link.configure({
    openOnClick: false,
    protocols: ['https', 'http', 'mailto'],
  }),
  History,
];

/**
 * MAIL-EDITOR-01: the formatted body editor of the document mail. It owns its
 * toolbar (real buttons, `aria-pressed`, 44px), the BKP015.10-style placeholder
 * picker (a described choice plus a separate insert action - selecting alone
 * never edits) and the link row. An empty editor reports `''`, so the send
 * path can fall back to the documented default text.
 */
export function MailBodyEditor({
  value,
  onChange,
  disabled = false,
  label = 'Begleittext',
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const editor = useEditor(
    {
      extensions: mailExtensions,
      content: value,
      editable: !disabled,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': label,
          'aria-multiline': 'true',
          class: 'mail-body-editor',
        },
      },
      onUpdate: ({ editor: current }) => {
        onChange(current.isEmpty ? '' : current.getHTML());
      },
    },
    // Recreate only when the label changes (never in practice); this keeps
    // the instance manager away from its per-render `setOptions` path, which
    // would steal the focus back after the picker inserted text.
    [label],
  );
  const [, force] = useReducer((count: number) => count + 1, 0),
    [pickerOpen, setPickerOpen] = useState(false),
    [selected, setSelected] = useState(''),
    [notice, setNotice] = useState(''),
    [linkOpen, setLinkOpen] = useState(false),
    [href, setHref] = useState(''),
    pickerToggle = useRef<HTMLButtonElement>(null);
  // Toolbar state follows every transaction, so `aria-pressed` never lies.
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', force);
    return () => {
      editor.off('transaction', force);
    };
  }, [editor]);
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  const chosen = mailPlaceholderOffers.find((offer) => offer.name === selected);
  function run(command: (editor: Editor) => boolean) {
    if (editor) command(editor);
  }
  function insertPlaceholder() {
    if (!editor || !chosen) return;
    // The last cursor position in the body, not the picker, is the target -
    // and the focus stays there so the user keeps writing (BKP015.10).
    editor.chain().focus().insertContent(`{{${chosen.name}}}`).run();
    setNotice(`{{${chosen.name}}} eingefügt.`);
    setSelected('');
    setPickerOpen(false);
  }
  const panelId = 'mail-placeholder-panel',
    descriptionId = 'mail-placeholder-description';
  return (
    <div className="mail-body-editor-block">
      <div
        className="mail-editor-toolbar"
        role="group"
        aria-label="Text formatieren"
      >
        <button
          type="button"
          className="secondary-action"
          aria-pressed={editor?.isActive('bold') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleBold().run())}
        >
          Fett
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-pressed={editor?.isActive('italic') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleItalic().run())}
        >
          Kursiv
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-pressed={editor?.isActive('underline') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleUnderline().run())}
        >
          Unterstrichen
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-pressed={editor?.isActive('bulletList') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
        >
          Aufzählung
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-pressed={editor?.isActive('orderedList') ?? false}
          disabled={disabled}
          onClick={() =>
            run((e) => e.chain().focus().toggleOrderedList().run())
          }
        >
          Nummerierung
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-expanded={linkOpen}
          disabled={disabled}
          onClick={() => {
            const wasOpen = linkOpen;
            setLinkOpen(!wasOpen);
            if (!wasOpen) setHref(editor?.getAttributes('link').href ?? '');
          }}
        >
          Link
        </button>
      </div>
      {linkOpen && (
        <div
          className="mail-editor-link-row"
          role="group"
          aria-label="Link bearbeiten"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setLinkOpen(false);
          }}
        >
          <label>
            Linkziel
            <input
              type="text"
              inputMode="url"
              maxLength={500}
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-action"
            disabled={!href.trim()}
            onClick={() =>
              run((e) =>
                e
                  .chain()
                  .focus()
                  .extendMarkRange('link')
                  .setLink({ href: href.trim() })
                  .run(),
              )
            }
          >
            Link setzen
          </button>
          <button
            type="button"
            className="tertiary-action"
            disabled={!editor?.isActive('link')}
            onClick={() =>
              run((e) =>
                e.chain().focus().extendMarkRange('link').unsetLink().run(),
              )
            }
          >
            Link entfernen
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      {/* Explicit user requirement, same interaction as the document template
      picker (BKP015.10): a described choice and a separate insert action. */}
      <div className="mail-placeholder-picker">
        <button
          ref={pickerToggle}
          type="button"
          className="secondary-action"
          aria-expanded={pickerOpen}
          aria-controls={panelId}
          onClick={() => setPickerOpen(!pickerOpen)}
        >
          {pickerOpen ? 'Platzhalterauswahl schließen' : 'Platzhalter einfügen'}
        </button>
        {pickerOpen && (
          <div
            id={panelId}
            role="group"
            aria-label="Platzhalter für den Begleittext"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              setPickerOpen(false);
              pickerToggle.current?.focus();
            }}
          >
            <label>
              Platzhalter
              <select
                value={selected}
                aria-describedby={descriptionId}
                onChange={(event) => {
                  setSelected(event.currentTarget.value);
                  setNotice('');
                }}
              >
                <option value="">Platzhalter auswählen</option>
                {mailPlaceholderOffers.map((offer) => (
                  <option key={offer.name} value={offer.name}>
                    {offer.label} — {offer.meaning}
                  </option>
                ))}
              </select>
            </label>
            <p id={descriptionId}>
              {chosen
                ? chosen.description
                : 'Wähle einen Platzhalter aus, um seine Bedeutung zu lesen.'}
            </p>
            <button
              type="button"
              className="secondary-action"
              disabled={!chosen}
              onClick={insertPlaceholder}
            >
              Einfügen
            </button>
          </div>
        )}
        {notice && <p className="document-hint">{notice}</p>}
      </div>
    </div>
  );
}
