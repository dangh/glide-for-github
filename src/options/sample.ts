/** Built-in before/after sample for the options page's live preview: two hunks, one modified line, additions, deletions. */
import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs';

export const SAMPLE_FILE_NAME = 'src/pricing.ts';

const BEFORE = `import { fetchRates } from './rates';

export interface Fare {
  base: number;
  taxes: number;
  currency: string;
}

const DEFAULT_CURRENCY = 'USD';

export function total(fare: Fare): number {
  return fare.base + fare.taxes;
}

export function format(fare: Fare): string {
  const amount = total(fare).toFixed(2);
  return \`\${fare.currency} \${amount}\`;
}

export function isFree(fare: Fare): boolean {
  return total(fare) === 0;
}

export async function convert(fare: Fare, to: string): Promise<Fare> {
  const rates = await fetchRates(fare.currency);
  const rate = rates[to];
  return { base: fare.base * rate, taxes: fare.taxes * rate, currency: to };
}

export function cheapest(fares: Fare[]): Fare | undefined {
  return fares.sort((a, b) => total(a) - total(b))[0];
}
`;

const AFTER = `import { fetchRates } from './rates';

export interface Fare {
  base: number;
  taxes: number;
  fees: number;
  currency: string;
}

const DEFAULT_CURRENCY = 'USD';

export function total(fare: Fare): number {
  return fare.base + fare.taxes + fare.fees;
}

export function format(fare: Fare): string {
  const amount = total(fare).toFixed(2);
  return \`\${fare.currency} \${amount}\`;
}

export function isFree(fare: Fare): boolean {
  return total(fare) === 0;
}

export async function convert(fare: Fare, to: string): Promise<Fare> {
  const rates = await fetchRates(fare.currency);
  const rate = rates[to] ?? 1;
  return { base: fare.base * rate, taxes: fare.taxes * rate, fees: fare.fees * rate, currency: to };
}

export function cheapest(fares: readonly Fare[]): Fare | undefined {
  return [...fares].sort((a, b) => total(a) - total(b))[0];
}
`;

let diff: FileDiffMetadata | undefined;

/** The sample as Pierre diff metadata (parsed once). */
export function buildSampleDiff(): FileDiffMetadata {
  diff ??= parseDiffFromFile(
    { name: SAMPLE_FILE_NAME, contents: BEFORE, cacheKey: 'sample:before' },
    { name: SAMPLE_FILE_NAME, contents: AFTER, cacheKey: 'sample:after' },
  );
  return diff;
}
