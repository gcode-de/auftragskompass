// UI-BKP-11: one price basis per document, like Bookitup's Brutto/Netto
// switch. Switching converts an entered amount so the totals stay the same up
// to cent rounding; it never silently reinterprets a gross price as net.
// Integer cents and basis points only, rounded half up, never floating point.
export function convertMinor(
  minor: number,
  taxBasisPoints: number,
  to: 'gross' | 'net',
): number {
  const amount = BigInt(minor),
    factor = 10000n + BigInt(taxBasisPoints),
    [numerator, denominator] =
      to === 'gross' ? [amount * factor, 10000n] : [amount * 10000n, factor],
    rounded = (numerator * 2n + denominator) / (denominator * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Betrag zu groß');
  return Number(rounded);
}
