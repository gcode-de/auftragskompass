const maxMinor = BigInt(Number.MAX_SAFE_INTEGER);

export function grossProductPrice(
  priceMinor: number,
  priceBasis: string,
  taxBasisPoints: number,
): number {
  if (
    !Number.isSafeInteger(priceMinor) ||
    priceMinor < 0 ||
    !Number.isInteger(taxBasisPoints) ||
    taxBasisPoints < 0 ||
    taxBasisPoints > 10000 ||
    (priceBasis !== 'net' && priceBasis !== 'gross')
  )
    throw new Error('Invalid product price');
  if (priceBasis === 'gross') return priceMinor;
  const gross =
    (BigInt(priceMinor) * BigInt(10000 + taxBasisPoints) + 5000n) / 10000n;
  if (gross > maxMinor)
    throw new Error('Product gross price exceeds safe range');
  return Number(gross);
}
