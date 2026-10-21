export const venueMaxLength = 1000;

export type VenueInput = {
  venue?: string | null;
  venueOverride?: boolean;
  locationId: string | null;
};
export type VenueRow = {
  venue: string | null;
  venueOverride: boolean;
  locationId: string | null;
};
export type VenueState = { venue: string | null; venueOverride: boolean };

export class VenueError extends Error {
  constructor(readonly reason: 'too_long') {
    super('venue_' + reason);
  }
}

function normalized(value: string | null): string | null {
  return value === null ? null : value.trim();
}

// H034: one optional free-form place per booking. `venueOverride` records that
// the free-form value is authoritative, so an intentional clear stays empty
// instead of falling back to a legacy location record.
export function resolveVenueWrite(
  input: VenueInput,
  old?: VenueRow,
): VenueState {
  const hasVenue = input.venue !== undefined,
    hasOverride = input.venueOverride !== undefined;
  let venue: string | null, venueOverride: boolean;
  if (old) {
    venue = old.venue;
    venueOverride = old.venueOverride;
  } else {
    venue = null;
    venueOverride = false;
  }
  if (hasVenue) {
    venue = normalized(input.venue!);
    if (!hasOverride) venueOverride = venue !== null;
  }
  if (hasOverride) venueOverride = input.venueOverride!;
  // An old client that only changes the legacy link re-asserts master-data
  // authority. The stored free-form text is kept, never deleted.
  if (old && !hasVenue && !hasOverride && old.locationId !== input.locationId)
    venueOverride = false;
  if (venue !== null && venue.length > venueMaxLength)
    throw new VenueError('too_long');
  return { venue, venueOverride };
}

export function effectiveVenue(
  row: { venue: string | null; venueOverride: boolean },
  legacy: string | null | undefined,
): string | null {
  const text = (row.venueOverride ? row.venue : legacy)?.trim();
  return text ? text : null;
}
