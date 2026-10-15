export function parseHundredths(input: string): number {
  const value = input.trim();
  if (!/^\d{1,14}(?:[.,]\d{1,2})?$/.test(value))
    throw new Error('Ungültiger Dezimalwert');
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Ungültiger Dezimalwert');
  return Number(amount);
}
export function formatHundredths(value: number): string {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}
