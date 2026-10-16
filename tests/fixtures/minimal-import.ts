// Entirely fictional input; never derive fixtures from production exports.
export function fictionalImport() {
  return {
    formatVersion: 1,
    source: 'bookitup',
    contacts: [
      {
        externalId: 'fictional-contact',
        data: {
          kind: 'company',
          name: 'Fictional Example Events',
          contactPerson: 'Fictional Person',
          street: '',
          postalCode: '',
          city: '',
          country: 'DE',
          email: 'fictional@example.invalid',
          phone: '',
          mobile: '',
          state: 'active',
        },
      },
    ],
    locations: [
      {
        externalId: 'fictional-location',
        data: {
          name: 'Fictional Venue',
          street: '',
          postalCode: '',
          city: '',
          country: 'DE',
          state: 'active',
        },
      },
    ],
    eventTypes: [
      {
        externalId: 'fictional-type',
        data: { name: 'Fictional celebration', position: 0, state: 'active' },
      },
    ],
    packages: [
      {
        externalId: 'fictional-package',
        data: { name: 'Fictional package', position: 0, state: 'active' },
      },
    ],
    events: [
      {
        externalId: 'fictional-event',
        data: {
          name: 'Fictional Future Event',
          status: 'Gebucht',
          eventTypeId: 'fictional-type',
          packageId: 'fictional-package',
          locationId: 'fictional-location',
          primaryContactId: 'fictional-contact',
          additionalContactIds: [] as string[],
          source: 'Fictional fixture',
          eventDate: '2030-10-27' as string | null,
          startsAt: null as string | null,
          endsAt: null as string | null,
          description: '',
          notesHtml: '',
        },
      },
    ],
  };
}
