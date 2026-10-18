// Observed on the public website on 2026-10-18; this is not a booking form.
export const inquiryFormV1 = {
  id: 'fotobox-bw-main',
  version: 1,
  title: 'Jetzt unverbindlich anfragen für unkomplizierten Foto-Spaß!',
  submitLabel: 'Anfrage senden',
  privacyNotice:
    'Wir speichern und verarbeiten Ihre Angaben und Daten entsprechend unserer Datenschutzerklärung um Ihre Anfrage zu bearbeiten.',
  privacyUrl: 'https://fotobox-bw.de/impressum-datenschutz/',
  fields: [
    { name: 'firstName', label: 'Vorname', type: 'text', required: true },
    { name: 'lastName', label: 'Nachname', type: 'text', required: true },
    { name: 'email', label: 'E-Mail', type: 'email', required: true },
    {
      name: 'eventDate',
      label: 'Veranstaltungsdatum',
      type: 'date',
      required: true,
    },
    { name: 'phone', label: 'Telefonnummer', type: 'tel', required: false },
    {
      name: 'location',
      label: 'Veranstaltungsort',
      type: 'text',
      required: false,
    },
    {
      name: 'package',
      label: 'Gewünschtes Fotobox-Paket',
      type: 'select',
      required: false,
      options: [
        { value: 'easy-digital', label: 'easy digital (Bilder zum Download)' },
        { value: 'easy-print', label: 'easy print (zusätzlich 200 Ausdrucke)' },
        {
          value: 'easy-print-plus',
          label: 'easy print+ (400 Ausdrucke, Drucklayout)',
        },
      ],
    },
    { name: 'comment', label: 'Kommentar', type: 'textarea', required: false },
  ],
} as const;

export type InquirySubmission = {
  formId: typeof inquiryFormV1.id;
  formVersion: typeof inquiryFormV1.version;
  fields: {
    firstName: string;
    lastName: string;
    email: string;
    eventDate: string;
    phone?: string;
    location?: string;
    package?: '' | 'easy-digital' | 'easy-print' | 'easy-print-plus';
    comment?: string;
  };
};
