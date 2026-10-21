import { expect, test } from 'vitest';
import {
  effectiveVenue,
  resolveVenueWrite,
  venueMaxLength,
} from '../../packages/core/src/venue.js';

const legacy = {
  venue: null as string | null,
  venueOverride: false,
  locationId: 'fictional-location',
};

test('a booking without a place has no freeform venue', () => {
  expect(resolveVenueWrite({ locationId: null })).toEqual({
    venue: null,
    venueOverride: false,
  });
  expect(resolveVenueWrite({ locationId: null, venue: '' })).toEqual({
    venue: '',
    venueOverride: true,
  });
  expect(
    resolveVenueWrite({ locationId: null, venue: '  Fictional Hall  ' }),
  ).toEqual({
    venue: 'Fictional Hall',
    venueOverride: true,
  });
});

test('an old full write without the new properties keeps the stored place', () => {
  const stored = {
    venue: 'Fictional Hall\nSide entrance',
    venueOverride: true,
    locationId: 'fictional-location',
  };
  expect(
    resolveVenueWrite({ locationId: 'fictional-location' }, stored),
  ).toEqual({
    venue: 'Fictional Hall\nSide entrance',
    venueOverride: true,
  });
});

test('an explicit clear stays cleared and never falls back to legacy data', () => {
  const stored = {
    venue: 'Fictional Hall',
    venueOverride: true,
    locationId: 'fictional-location',
  };
  expect(
    resolveVenueWrite(
      { locationId: 'fictional-location', venue: '', venueOverride: true },
      stored,
    ),
  ).toEqual({
    venue: '',
    venueOverride: true,
  });
  expect(
    effectiveVenue({ venue: '', venueOverride: true }, 'Fictional legacy hall'),
  ).toBeNull();
  expect(
    effectiveVenue(
      { venue: '   ', venueOverride: true },
      'Fictional legacy hall',
    ),
  ).toBeNull();
});

test('a changed legacy link wins while the freeform text is retained', () => {
  const stored = {
    venue: 'Fictional Hall',
    venueOverride: true,
    locationId: 'fictional-location',
  };
  expect(
    resolveVenueWrite({ locationId: 'fictional-other-location' }, stored),
  ).toEqual({ venue: 'Fictional Hall', venueOverride: false });
});

test('explicit boundary values are applied verbatim', () => {
  const stored = {
    venue: 'Fictional Hall',
    venueOverride: true,
    locationId: null,
  };
  expect(
    resolveVenueWrite(
      { locationId: null, venue: null, venueOverride: false },
      stored,
    ),
  ).toEqual({
    venue: null,
    venueOverride: false,
  });
  expect(
    resolveVenueWrite(
      { locationId: null, venue: 'Fictional New Hall' },
      stored,
    ),
  ).toEqual({
    venue: 'Fictional New Hall',
    venueOverride: true,
  });
  expect(
    resolveVenueWrite(
      { locationId: null, venue: 'Fictional Hall', venueOverride: false },
      stored,
    ),
  ).toEqual({
    venue: 'Fictional Hall',
    venueOverride: false,
  });
});

test('the effective place resolves one source only', () => {
  expect(effectiveVenue(legacy, 'Fictional legacy hall')).toBe(
    'Fictional legacy hall',
  );
  expect(effectiveVenue(legacy, '')).toBeNull();
  expect(
    effectiveVenue(
      { venue: 'Fictional Hall', venueOverride: true },
      'Fictional legacy hall',
    ),
  ).toBe('Fictional Hall');
});

test('a place longer than the documented bound is rejected', () => {
  expect(venueMaxLength).toBe(1000);
  expect(() =>
    resolveVenueWrite({
      locationId: null,
      venue: 'x'.repeat(venueMaxLength + 1),
    }),
  ).toThrow('venue_too_long');
  expect(
    resolveVenueWrite({ locationId: null, venue: 'ü'.repeat(venueMaxLength) })
      .venue,
  ).toHaveLength(venueMaxLength);
});
