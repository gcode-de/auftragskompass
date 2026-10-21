// Mirrors the API/DB bound for the optional free-form place (H034). The server
// is authoritative; the input bound only keeps the form honest.
export const venueMaxLength = 1000;

export type VenueChoice = {
  id: string;
  name: string;
  state: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

export type VenueEvent = {
  venue: string | null;
  venueOverride: boolean;
  locationId: string | null;
};

// Existing formatting of a legacy master-data place; nothing is parsed.
export function legacyPlaceText(place?: VenueChoice | null): string {
  if (!place) return '';
  const town = [place.postalCode ?? '', place.city ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return [place.name, place.street ?? '', town, place.country ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}

export function initialVenueText(
  row?: VenueEvent | null,
  place?: VenueChoice | null,
): string {
  if (!row) return '';
  if (row.venueOverride) return row.venue ?? '';
  return place && place.id === row.locationId ? legacyPlaceText(place) : '';
}

// A legacy place stays the effective default until the operator actually
// changes the field, so a prefilled legacy address is never silently promoted
// into a free-form copy.
export function venuePayload(text: string, send: boolean) {
  return send ? { venue: text, venueOverride: true } : {};
}

export function shownVenue(
  row: VenueEvent,
  place?: VenueChoice | null,
): string {
  if (row.venueOverride) return row.venue?.trim() ?? '';
  return place?.name ?? '';
}
