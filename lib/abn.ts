/**
 * ABN checksum validation (ATO-published algorithm):
 * subtract 1 from the first digit, then the weighted sum of all 11 digits
 * with weights [10,1,3,5,7,9,11,13,15,17,19] must be divisible by 89.
 * Used to warn (never block) on likely typos.
 */
const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function cleanAbn(input: string): string {
  return String(input).replace(/[\s-]/g, "");
}

export function isValidAbn(input: string): boolean {
  const abn = cleanAbn(input);
  if (!/^\d{11}$/.test(abn)) return false;
  const digits = abn.split("").map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((acc, d, i) => acc + d * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** "51824753556" -> "51 824 753 556" */
export function formatAbn(input: string): string {
  const abn = cleanAbn(input);
  if (!/^\d{11}$/.test(abn)) return input;
  return `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8, 11)}`;
}
