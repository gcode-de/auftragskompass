import { Fragment, useState } from 'react';
export type OriginalInquiry = {
  formId: string;
  formVersion: number;
  receivedAt: string;
  fields: { label: string; value: string }[];
  privacyNotice: string;
  privacyUrl: string;
};
export function WebsiteInquiry({
  eventId,
  timeZone,
}: {
  eventId: string;
  timeZone?: string | undefined;
}) {
  const [original, setOriginal] = useState<OriginalInquiry | null>(null),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false);
  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(
        '/api/v1/events/' + eventId + '/website-inquiry',
      );
      if (!response.ok) throw new Error();
      setOriginal((await response.json()) as OriginalInquiry);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <details
      className="website-inquiry"
      onToggle={(event) => {
        if (event.currentTarget.open && !original && !loading && !failed)
          void load();
      }}
    >
      <summary>Website-Anfrage</summary>
      <p>
        Die Angaben beim Absenden. Spätere Änderungen am Kontakt oder Event
        verändern diese Originalanfrage nicht.
      </p>
      {original ? (
        <OriginalInquiryContents original={original} timeZone={timeZone} />
      ) : failed ? (
        <div role="alert">
          <p>
            Originalanfrage konnte nicht geladen werden. Bitte Anmeldung und
            Verbindung prüfen und erneut versuchen.
          </p>
          <button onClick={() => void load()}>
            Originalanfrage erneut laden
          </button>
        </div>
      ) : (
        <p role="status">Originalanfrage wird geladen …</p>
      )}
    </details>
  );
}

export function OriginalInquiryContents({
  original,
  timeZone,
}: {
  original: OriginalInquiry;
  timeZone?: string | undefined;
}) {
  return (
    <>
      <p>
        Formular {original.formId} · Version {original.formVersion} · Eingang:{' '}
        <time dateTime={original.receivedAt}>
          {new Intl.DateTimeFormat('de-DE', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone,
          }).format(new Date(original.receivedAt))}
        </time>
      </p>
      <dl>
        {original.fields.map((field) => (
          <Fragment key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value || 'Nicht angegeben'}</dd>
          </Fragment>
        ))}
      </dl>
      <p>{original.privacyNotice}</p>
      <a href={original.privacyUrl}>Damals verlinkte Datenschutzerklärung</a>
    </>
  );
}
