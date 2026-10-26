// BKP011.1: the reading contact record shows the stored value as its visible
// text and only escapes what would change the meaning of a link. Nothing here
// rewrites a number, splits a name or invents an address part.

/** RFC 6068: `@`, `.`, `+` and `-` stay literal, so a mail client receives the
 * address the operator stored. Only characters that would break the URI or
 * allow a header injection are percent-encoded. */
export function mailtoHref(email: string): string {
  const address = email.trim();
  if (!address) return '';
  return (
    'mailto:' +
    address.replace(/[%?#&"<>\s]/g, (character) =>
      encodeURIComponent(character),
    )
  );
}

/** A dialler link keeps the stored number; only formatting characters are
 * dropped. This slice deliberately does not normalise a national trunk prefix
 * – the stored value reaches the dialler unchanged. */
export function telHref(phone: string): string {
  const number = phone.replace(/[^+0-9]/g, '');
  return number ? 'tel:' + number : '';
}

/** German region name for a stored ISO code; an unknown code stays visible
 * instead of turning into an empty or generic label. */
let regionNames: Intl.DisplayNames | null = null,
  unknownRegion: string | null = null;
export function countryLabel(code: string): string {
  const value = code.trim();
  if (!value) return '';
  const upper = value.toUpperCase();
  try {
    regionNames ??= new Intl.DisplayNames('de', { type: 'region' });
    // ICU answers every well-formed pair, so the reserved `ZZ` names the label
    // it uses for "no region" – that label never replaces the stored code.
    unknownRegion ??= regionNames.of('ZZ') ?? '';
    const label = regionNames.of(upper);
    return label && label !== upper && label !== unknownRegion ? label : value;
  } catch {
    return value;
  }
}

/** The address block of the reading record: only stored parts, in the order
 * street, postal code plus town, country. A record without a street or town
 * has no address at all, so a stored country alone never pretends otherwise. */
export function addressLines(contact: {
  street: string;
  postalCode: string;
  city: string;
  country: string;
}): string[] {
  const street = contact.street.trim(),
    town = [contact.postalCode, contact.city]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
  if (!street && !town) return [];
  return [street, town, countryLabel(contact.country)].filter(Boolean);
}
