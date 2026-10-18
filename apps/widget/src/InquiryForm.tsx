import { useEffect, useId, useRef, useState } from 'react';
import {
  inquiryFormV1,
  type InquirySubmission,
} from '@auftragskompass/core/inquiry-form-definition';
import {
  createInquirySubmission,
  InquiryClientError,
} from './inquiry-client.js';
const lengths: Partial<Record<keyof InquirySubmission['fields'], number>> = {
  firstName: 100,
  lastName: 100,
  email: 254,
  phone: 60,
  location: 200,
  comment: 5000,
};
const autocomplete: Partial<Record<keyof InquirySubmission['fields'], string>> =
  {
    firstName: 'given-name',
    lastName: 'family-name',
    email: 'email',
    phone: 'tel',
  };
const messages: Record<InquiryClientError['reason'], string> = {
  invalid:
    'Das Formular ist momentan nicht verfügbar. Bitte versuchen Sie es später erneut.',
  rejected:
    'Bitte prüfen Sie Ihre Angaben, insbesondere E-Mail-Adresse und Datum, und senden Sie die Anfrage erneut.',
  conflict:
    'Der Eingang konnte nicht eindeutig bestätigt werden. Bitte versuchen Sie denselben Versand erneut.',
  rate_limited:
    'Bitte warten Sie etwas und versuchen Sie denselben Versand erneut. Ihre Angaben bleiben hier erhalten.',
  unavailable:
    'Der Eingang ist noch unklar. Ihre Angaben bleiben auf dieser Seite erhalten. Bitte senden Sie dieselbe Anfrage erneut.',
};
export function InquiryForm({ gatewayOrigin }: { gatewayOrigin: string }) {
  const id = useId(),
    attempt = useRef<ReturnType<typeof createInquirySubmission> | null>(null),
    active = useRef(true),
    feedback = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<
      'editing' | 'sending' | 'uncertain' | 'received'
    >('editing'),
    [error, setError] = useState<InquiryClientError['reason'] | null>(null),
    [packageLabel, setPackageLabel] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (error || state === 'received') feedback.current?.focus();
  }, [error, state]);
  if (state === 'received')
    return (
      <section className="ak-inquiry" aria-label="Fotobox-Anfrage">
        <p role="status" ref={feedback} tabIndex={-1} className="ak-feedback">
          Vielen Dank. Ihre Anfrage ist eingegangen. Damit ist noch keine
          Buchung bestätigt.
        </p>
      </section>
    );
  return (
    <section className="ak-inquiry" aria-label="Fotobox anfragen">
      <form
        aria-busy={state === 'sending'}
        onSubmit={(event) => {
          event.preventDefault();
          if (state === 'sending') return;
          const form = event.currentTarget;
          try {
            if (!attempt.current) {
              const data = new FormData(form),
                fields = Object.fromEntries(
                  inquiryFormV1.fields.map((field) => [
                    field.name,
                    String(data.get(field.name) ?? ''),
                  ]),
                ) as InquirySubmission['fields'];
              attempt.current = createInquirySubmission(
                gatewayOrigin,
                fields,
                String(data.get('website') ?? ''),
              );
            }
          } catch {
            setError('invalid');
            return;
          }
          setError(null);
          setState('sending');
          void attempt.current
            .send()
            .then(() => {
              if (!active.current) return;
              form.reset();
              attempt.current = null;
              setState('received');
            })
            .catch((failure: unknown) => {
              if (!active.current) return;
              const reason =
                failure instanceof InquiryClientError
                  ? failure.reason
                  : 'unavailable';
              if (reason === 'rejected') {
                attempt.current = null;
                setState('editing');
              } else setState('uncertain');
              setError(reason);
            });
        }}
      >
        <fieldset disabled={state === 'sending'}>
          <legend>{inquiryFormV1.title}</legend>
          <p id={id + '-required'} className="ak-hint">
            Mit * markierte Felder sind Pflichtangaben.
          </p>
          <div className="ak-fields">
            {inquiryFormV1.fields.map((field) => (
              <div
                key={field.name}
                className={
                  'ak-field' +
                  (['package', 'comment'].includes(field.name)
                    ? ' ak-wide'
                    : '')
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
                    readOnly={state === 'uncertain'}
                    rows={4}
                    maxLength={lengths[field.name]}
                  />
                ) : field.type === 'select' ? (
                  <>
                    <select
                      id={id + '-' + field.name}
                      name={field.name}
                      defaultValue=""
                      disabled={state === 'uncertain'}
                      onChange={(event) =>
                        setPackageLabel(
                          event.currentTarget.value
                            ? event.currentTarget.selectedOptions[0]!.label
                            : null,
                        )
                      }
                    >
                      <option value="">Noch nicht entschieden</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {packageLabel && (
                      <p className="ak-package-choice">{packageLabel}</p>
                    )}
                  </>
                ) : (
                  <input
                    id={id + '-' + field.name}
                    name={field.name}
                    type={field.type}
                    readOnly={state === 'uncertain'}
                    required={field.required}
                    maxLength={lengths[field.name]}
                    autoComplete={autocomplete[field.name]}
                    pattern={
                      ['firstName', 'lastName'].includes(field.name)
                        ? '.*\\S.*'
                        : undefined
                    }
                    min={field.type === 'date' ? '0001-01-01' : undefined}
                    max={field.type === 'date' ? '9999-12-31' : undefined}
                    aria-describedby={
                      field.required ? id + '-required' : undefined
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <div className="ak-website" aria-hidden="true">
            <label htmlFor={id + '-website'}>Website</label>
            <input
              id={id + '-website'}
              name="website"
              type="text"
              autoComplete="off"
              tabIndex={-1}
              maxLength={200}
            />
          </div>
          <p className="ak-privacy">
            {inquiryFormV1.privacyNotice}{' '}
            <a href={inquiryFormV1.privacyUrl}>Datenschutzerklärung</a>
          </p>
        </fieldset>
        <p ref={feedback} role="alert" tabIndex={-1} className="ak-error">
          {error ? messages[error] : ''}
        </p>
        <button type="submit" disabled={state === 'sending'}>
          {state === 'sending'
            ? 'Wird gesendet …'
            : state === 'uncertain'
              ? 'Erneut senden'
              : inquiryFormV1.submitLabel}
        </button>
        <p role="status" className="ak-progress">
          {state === 'sending'
            ? 'Die Anfrage wird gesendet. Bitte lassen Sie diese Seite geöffnet.'
            : ''}
        </p>
      </form>
    </section>
  );
}
