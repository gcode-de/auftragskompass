import { useEffect, useId, useState } from 'react';
type Definition = {
  title: string;
  privacyNotice: string;
  privacyUrl: string;
  fields: {
    name: string;
    label: string;
    type: 'text' | 'email' | 'date' | 'tel' | 'select' | 'textarea';
    required: boolean;
    options?: { value: string; label: string }[];
  }[];
};
export function InquiryPreview() {
  const id = useId();
  const [definition, setDefinition] = useState<Definition | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void fetch('/api/v1/website-inquiries/form-definition')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const value = (await response.json()) as Definition;
        if (active) setDefinition(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <section className="inquiry-preview" aria-label="Website-Formularvorschau">
      <h2>Website-Formular prüfen</h2>
      <p>
        Vorschau der acht Felder von fotobox-bw.de. Diese Ansicht sendet keine
        Anfrage und speichert keine Eingaben.
      </p>
      <p>Inhalte bearbeiten und mehrere Formulare verwalten folgen später.</p>
      {!definition ? (
        failed ? (
          <div role="alert">
            <p>
              Das Formular konnte nicht geladen werden. Bitte erneut versuchen.
            </p>
            <button onClick={() => setRevision((value) => value + 1)}>
              Erneut laden
            </button>
          </div>
        ) : (
          <p role="status">Formular wird geladen …</p>
        )
      ) : (
        <form
          onChange={() => setChecked(false)}
          onSubmit={(event) => {
            event.preventDefault();
            setChecked(true);
          }}
        >
          <fieldset>
            <legend>{definition.title}</legend>
            <p id={id + '-required'}>
              Mit * markierte Felder sind Pflichtangaben.
            </p>
            {definition.fields.map((field) => (
              <div
                key={field.name}
                className={
                  ['package', 'comment'].includes(field.name)
                    ? 'inquiry-field inquiry-wide'
                    : 'inquiry-field'
                }
              >
                <label htmlFor={id + '-' + field.name}>
                  {field.label}
                  {field.required ? ' *' : ' (optional)'}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={id + '-' + field.name}
                    name={field.name}
                    required={field.required}
                    maxLength={5000}
                    rows={4}
                  />
                ) : field.type === 'select' ? (
                  <select
                    id={id + '-' + field.name}
                    name={field.name}
                    required={field.required}
                    defaultValue=""
                  >
                    <option value="">Noch nicht entschieden</option>
                    {field.options!.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id + '-' + field.name}
                    name={field.name}
                    type={field.type}
                    required={field.required}
                    maxLength={
                      (
                        {
                          firstName: 100,
                          lastName: 100,
                          email: 254,
                          phone: 60,
                          location: 200,
                        } as Record<string, number>
                      )[field.name]
                    }
                    pattern={
                      ['firstName', 'lastName'].includes(field.name)
                        ? '.*\\S.*'
                        : undefined
                    }
                    aria-describedby={
                      field.required ? id + '-required' : undefined
                    }
                  />
                )}
              </div>
            ))}
            <p>
              {definition.privacyNotice}{' '}
              <a href={definition.privacyUrl}>Datenschutzerklärung</a>
            </p>
          </fieldset>
          <div>
            <button type="submit">Eingaben prüfen</button>
          </div>
          {checked && (
            <p role="status">
              Die Eingaben erfüllen die Browserprüfung. Diese Vorschau hat
              nichts versendet.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
