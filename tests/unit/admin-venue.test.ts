import { expect, test } from 'vitest';
import {
  initialVenueText,
  legacyPlaceText,
  shownVenue,
  venueMaxLength,
  venuePayload,
} from '../../apps/admin/src/venue.js';

const place = {
  id: 'fictional-place',
  name: 'Fictional Hall',
  state: 'active',
  street: 'Fictional Street 5',
  postalCode: '12345',
  city: 'Fictional Town',
  country: 'DE',
};

test('the legacy place is shown with every stored address part', () => {
  expect(legacyPlaceText(place)).toBe(
    'Fictional Hall\nFictional Street 5\n12345 Fictional Town\nDE',
  );
  expect(legacyPlaceText({ id: 'x', name: 'Only name', state: 'active' })).toBe(
    'Only name',
  );
  expect(legacyPlaceText(undefined)).toBe('');
});

test('the field starts from the effective place only', () => {
  expect(initialVenueText(null, place)).toBe('');
  expect(
    initialVenueText(
      { venue: null, venueOverride: false, locationId: 'fictional-place' },
      place,
    ),
  ).toBe('Fictional Hall\nFictional Street 5\n12345 Fictional Town\nDE');
  expect(
    initialVenueText(
      { venue: null, venueOverride: false, locationId: 'other-place' },
      place,
    ),
  ).toBe('');
  expect(
    initialVenueText(
      {
        venue: 'Fictional Terrace',
        venueOverride: true,
        locationId: 'fictional-place',
      },
      place,
    ),
  ).toBe('Fictional Terrace');
  expect(
    initialVenueText(
      { venue: '', venueOverride: true, locationId: 'fictional-place' },
      place,
    ),
  ).toBe('');
});

test('the visible place resolves exactly one source', () => {
  expect(
    shownVenue(
      { venue: null, venueOverride: false, locationId: 'fictional-place' },
      place,
    ),
  ).toBe('Fictional Hall');
  expect(
    shownVenue(
      {
        venue: 'Fictional Terrace',
        venueOverride: true,
        locationId: 'fictional-place',
      },
      place,
    ),
  ).toBe('Fictional Terrace');
  expect(
    shownVenue(
      { venue: '', venueOverride: true, locationId: 'fictional-place' },
      place,
    ),
  ).toBe('');
});

test('payloads only carry the place when the field was edited', () => {
  expect(venueMaxLength).toBe(1000);
  expect(venuePayload('Fictional Hall', false)).toEqual({});
  expect(venuePayload('', true)).toEqual({ venue: '', venueOverride: true });
});
