import { useEffect, useId, useRef, useState } from 'react';
import {
  inquiryFormV1,
  phonePattern,
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
type FieldName = keyof InquirySubmission['fields'];
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const phone = new RegExp(phonePattern);
function fieldError(control: Control): string | undefined {
  if (
    control.validity.valueMissing ||
    (control.required && !control.value.trim())
  )
    return 'Bitte füllen Sie dieses Pflichtfeld aus.';
  if (control.name === 'phone' && !phone.test(control.value))
    return 'Bitte geben Sie eine Telefonnummer mit Ziffern und üblichen Sonderzeichen ein.';
  if (control.validity.typeMismatch && control.name === 'email')
    return 'Bitte geben Sie eine gültige E-Mail-Adresse ein.';
  if (control.name === 'eventDate' && !control.validity.valid)
    return 'Bitte geben Sie ein gültiges Datum ein.';
  if (!control.validity.valid) return 'Bitte prüfen Sie Ihre Eingabe.';
  return undefined;
}
export function InquiryForm({ gatewayOrigin }: { gatewayOrigin: string }) {
  const id = useId(),
    attempt = useRef<ReturnType<typeof createInquirySubmission> | null>(null),
    active = useRef(true),
    focusError = useRef<Control | null>(null),
    feedback = useRef<HTMLParagraphElement>(null);
  const [state, setState] = useState<
      'editing' | 'sending' | 'uncertain' | 'received'
    >('editing'),
    [error, setError] = useState<InquiryClientError['reason'] | null>(null),
    [fieldErrors, setFieldErrors] = useState<
      Partial<Record<FieldName, string>>
    >({});
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (error || state === 'received') feedback.current?.focus();
  }, [error, state]);
  useEffect(() => {
    focusError.current?.focus();
    focusError.current = null;
  }, [fieldErrors]);
  if (state === 'received')
    return (
      <section className="ak-inquiry" aria-label="Fotobox-Anfrage">
        <p role="status" ref={feedback} tabIndex={-1} className="ak-feedback">
          Vielen Dank. Ihre Anfrage ist eingegangen. Wir melden uns innerhalb
          von 24 Stunden!
        </p>
      </section>
    );
  return (
    <section className="ak-inquiry" aria-label="Fotobox anfragen">
      <form
        noValidate
        aria-busy={state === 'sending'}
        onBlur={(event) => {
          const control = event.target as unknown as Control;
          if (
            !inquiryFormV1.fields.some((field) => field.name === control.name)
          )
            return;
          setFieldErrors((previous) => ({
            ...previous,
            [control.name]: fieldError(control),
          }));
        }}
        onInput={(event) => {
          const control = event.target as unknown as Control;
          if (
            !inquiryFormV1.fields.some((field) => field.name === control.name)
          )
            return;
          setFieldErrors((previous) =>
            control.value || previous[control.name as FieldName]
              ? { ...previous, [control.name]: fieldError(control) }
              : previous,
          );
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (state === 'sending') return;
          const form = event.currentTarget;
          if (!attempt.current) {
            const errors: Partial<Record<FieldName, string>> = {};
            for (const field of inquiryFormV1.fields) {
              const control = form.elements.namedItem(field.name) as Control;
              const message = fieldError(control);
              if (message) errors[field.name] = message;
            }
            const firstName = form.elements.namedItem('firstName') as Control;
            const lastName = form.elements.namedItem('lastName') as Control;
            if (
              Array.from(firstName.value.trim() + ' ' + lastName.value.trim())
                .length > 200
            )
              errors.lastName =
                'Vor- und Nachname dürfen zusammen höchstens 200 Zeichen lang sein.';
            const first = inquiryFormV1.fields.find(
              (field) => errors[field.name],
            );
            if (first) {
              focusError.current = form.elements.namedItem(
                first.name,
              ) as Control;
              setFieldErrors(errors);
              return;
            }
            setFieldErrors(errors);
          }
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
                  {field.name === 'comment'
                    ? 'Details zur Veranstaltung'
                    : field.label}
                  {field.required ? ' *' : ' (optional)'}
                </label>
                {field.type === 'textarea' ? (
                  <textarea
                    id={id + '-' + field.name}
                    name={field.name}
                    readOnly={state === 'uncertain'}
                    rows={4}
                    maxLength={lengths[field.name]}
                    aria-invalid={fieldErrors[field.name] ? true : undefined}
                    aria-describedby={
                      fieldErrors[field.name]
                        ? id + '-' + field.name + '-error'
                        : undefined
                    }
                  />
                ) : field.type === 'select' ? (
                  <>
                    <select
                      id={id + '-' + field.name}
                      name={field.name}
                      defaultValue=""
                      disabled={state === 'uncertain'}
                      aria-invalid={fieldErrors[field.name] ? true : undefined}
                      aria-describedby={
                        fieldErrors[field.name]
                          ? id + '-' + field.name + '-error'
                          : undefined
                      }
                    >
                      <option value="">Noch nicht entschieden</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
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
                      [
                        field.required ? id + '-required' : '',
                        fieldErrors[field.name]
                          ? id + '-' + field.name + '-error'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                    aria-invalid={fieldErrors[field.name] ? true : undefined}
                  />
                )}
                {fieldErrors[field.name] && (
                  <p
                    className="ak-field-error"
                    id={id + '-' + field.name + '-error'}
                  >
                    {fieldErrors[field.name]}
                  </p>
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
