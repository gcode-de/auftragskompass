import { useEffect, useReducer, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import Blockquote from '@tiptap/extension-blockquote';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Strike from '@tiptap/extension-strike';
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
// paragraphs and headings, emphasis and strike, quotes, lists, hard breaks
// and links - nothing else. The server sanitizes again regardless. Enter
// splits the blocks (a new paragraph with the usual spacing), Shift+Enter
// inserts a hard break inside the same block (no spacing) - both come with
// the extensions below and are covered by the E2E. The extensions are
// module-level so `useEditor` never sees churn and never resets or steals
// focus on an unrelated re-render.
const mailExtensions = [
  Document,
  Paragraph,
  Text,
  Bold,
  Italic,
  Underline,
  Strike,
  Heading.configure({ levels: [2, 3] }),
  Blockquote,
  HardBreak,
  BulletList,
  OrderedList,
  ListItem,
  Link.configure({
    openOnClick: false,
    protocols: ['https', 'http', 'mailto'],
  }),
  History,
];

// One consistent icon language: the navigation's 24x24 stroke geometry
// (Lucide, ISC) rendered at the house stroke weight.
const toolIconPaths = {
  bold: [
    'M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8',
  ],
  italic: ['M19 4H10', 'M14 20H5', 'M15 4L9 20'],
  underline: ['M6 4v6a6 6 0 0 0 12 0V4', 'M4 20h16'],
  strike: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
  heading2: [
    'M4 12h8',
    'M4 18V6',
    'M12 18V6',
    'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1',
  ],
  heading3: [
    'M4 12h8',
    'M4 18V6',
    'M12 18V6',
    'M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2',
    'M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2',
  ],
  quote: [
    'M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
    'M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z',
  ],
  bulletList: [
    'M3 5h.01',
    'M3 12h.01',
    'M3 19h.01',
    'M8 5h13',
    'M8 12h13',
    'M8 19h13',
  ],
  orderedList: [
    'M11 5h10',
    'M11 12h10',
    'M11 19h10',
    'M4 4h1v5',
    'M4 9h2',
    'M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02',
  ],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
  undo: [
    'M9 14 4 9l5-5',
    'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11',
  ],
  redo: [
    'm15 14 5-5-5-5',
    'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13',
  ],
};

function ToolIcon({ icon }: { icon: keyof typeof toolIconPaths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {toolIconPaths[icon].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

function ToolButton({
  icon,
  label,
  pressed,
  expanded,
  disabled,
  onClick,
}: {
  icon: keyof typeof toolIconPaths;
  label: string;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mail-editor-tool"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      disabled={disabled}
      onClick={onClick}
    >
      <ToolIcon icon={icon} />
    </button>
  );
}

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
  replaceKey = 0,
  withPlaceholderPicker = true,
  placeholderOffers = mailPlaceholderOffers,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  label?: string;
  /**
   * MAIL-UX-02: bump to replace the document from outside (applying a
   * template, opening another draft). After mount the editor owns its
   * content - a changed `value` alone never touches the typed text, so a
   * stale render can never overwrite or reorder what was typed (the root
   * of the old picker-insert watch item).
   */
  replaceKey?: number;
  /**
   * MAIL-EVENT-01: a free mail has no document to resolve placeholders
   * against, so its editor offers no placeholder picker - the tokens would
   * travel out literally. Defaults to the document behaviour.
   */
  withPlaceholderPicker?: boolean;
  /** MAIL-SIG-01: the signature editor offers its own token (the logo). */
  placeholderOffers?: readonly {
    name: string;
    label: string;
    meaning: string;
    description: string;
  }[];
}) {
  // What this component last reported or was given; only an outside change
  // replaces the document, so typing is never overwritten.
  const emitted = useRef(value);
  const editor = useEditor(
    {
      // SSR-safe: the first render carries no editor yet, so the toolbar's
      // inactive fallbacks are real code paths instead of dead branches.
      immediatelyRender: false,
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
        emitted.current = current.isEmpty ? '' : current.getHTML();
        onChange(emitted.current);
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
    pickerToggle = useRef<HTMLButtonElement>(null),
    savedBodyPos = useRef<number | null>(null);
  // MAIL-UX-02: the document is replaced only on an explicit `replaceKey`
  // bump (template load, new draft) - never by a value echo. A stale render
  // that races the editor can therefore not reorder or truncate typed text,
  // which reset the caret to the start and made inserts land wrongly (the
  // root of the old picker-insert watch item, seen again in an E2E race).
  const appliedReplaceKey = useRef(replaceKey);
  useEffect(() => {
    if (!editor || appliedReplaceKey.current === replaceKey) return;
    appliedReplaceKey.current = replaceKey;
    emitted.current = value;
    editor.commands.setContent(value || '<p></p>', { emitUpdate: false });
  }, [editor, value, replaceKey]);
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
  const chosen = placeholderOffers.find((offer) => offer.name === selected);
  function run(command: (editor: Editor) => boolean) {
    if (editor) command(editor);
  }
  function insertPlaceholder() {
    if (!editor || !chosen) return;
    // BKP015.10: the target is the last caret position in the body - taken
    // when the picker opened, never the picker's own focus. The position is
    // written explicitly and the DOM focus returns synchronously: the
    // deferred `focus()` of a command chain left a window in which the
    // picker unmounted (focus fell to the page) and the browser's refocus
    // caret landed at the document start - the root of inserts landing
    // wrongly. A plain insert then continued from there and reordered text.
    const text = `{{${chosen.name}}}`,
      at = savedBodyPos.current ?? editor.state.selection.from;
    editor
      .chain()
      .insertContentAt({ from: at, to: at }, text)
      .setTextSelection(at + text.length)
      .run();
    editor.view.focus();
    setNotice(`${text} eingefügt.`);
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
        <ToolButton
          icon="bold"
          label="Fett"
          pressed={editor?.isActive('bold') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleBold().run())}
        />
        <ToolButton
          icon="italic"
          label="Kursiv"
          pressed={editor?.isActive('italic') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleItalic().run())}
        />
        <ToolButton
          icon="underline"
          label="Unterstrichen"
          pressed={editor?.isActive('underline') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleUnderline().run())}
        />
        <ToolButton
          icon="strike"
          label="Durchgestrichen"
          pressed={editor?.isActive('strike') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleStrike().run())}
        />
        <ToolButton
          icon="heading2"
          label="Überschrift 2"
          pressed={editor?.isActive('heading', { level: 2 }) ?? false}
          disabled={disabled}
          onClick={() =>
            run((e) => e.chain().focus().toggleHeading({ level: 2 }).run())
          }
        />
        <ToolButton
          icon="heading3"
          label="Überschrift 3"
          pressed={editor?.isActive('heading', { level: 3 }) ?? false}
          disabled={disabled}
          onClick={() =>
            run((e) => e.chain().focus().toggleHeading({ level: 3 }).run())
          }
        />
        <ToolButton
          icon="quote"
          label="Zitat"
          pressed={editor?.isActive('blockquote') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleBlockquote().run())}
        />
        <ToolButton
          icon="bulletList"
          label="Aufzählung"
          pressed={editor?.isActive('bulletList') ?? false}
          disabled={disabled}
          onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}
        />
        <ToolButton
          icon="orderedList"
          label="Nummerierung"
          pressed={editor?.isActive('orderedList') ?? false}
          disabled={disabled}
          onClick={() =>
            run((e) => e.chain().focus().toggleOrderedList().run())
          }
        />
        <ToolButton
          icon="link"
          label="Link"
          expanded={linkOpen}
          disabled={disabled}
          onClick={() => {
            const wasOpen = linkOpen;
            setLinkOpen(!wasOpen);
            if (!wasOpen) setHref(editor?.getAttributes('link').href ?? '');
          }}
        />
        <ToolButton
          icon="undo"
          label="Rückgängig"
          disabled={disabled || !(editor?.can().undo() ?? false)}
          onClick={() => run((e) => e.chain().focus().undo().run())}
        />
        <ToolButton
          icon="redo"
          label="Wiederholen"
          disabled={disabled || !(editor?.can().redo() ?? false)}
          onClick={() => run((e) => e.chain().focus().redo().run())}
        />
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
      {withPlaceholderPicker && (
        <div className="mail-placeholder-picker">
          <button
            ref={pickerToggle}
            type="button"
            className="secondary-action"
            aria-expanded={pickerOpen}
            aria-controls={panelId}
            onClick={() => {
              if (!pickerOpen && editor)
                savedBodyPos.current = editor.state.selection.from;
              setPickerOpen(!pickerOpen);
            }}
          >
            {pickerOpen
              ? 'Platzhalterauswahl schließen'
              : 'Platzhalter einfügen'}
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
                  {placeholderOffers.map((offer) => (
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
      )}
    </div>
  );
}
