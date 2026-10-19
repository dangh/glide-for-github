/** Built-in before/after sample for the options page's live preview: two hunks, one modified line, additions, deletions. */
import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs';

export const SAMPLE_FILE_NAME = 'examples/birdwatching.ts';

const BEFORE = `export interface Sighting {
  species: string;
  count: number;
  place: string;
}

export function describe(sighting: Sighting): string {
  return \`\${sighting.species}: \${sighting.count} spotted\`;
}

export function speciesSeen(sightings: readonly Sighting[]): string[] {
  return [...new Set(sightings.map((sighting) => sighting.species))];
}

export function busiestSpot(sightings: readonly Sighting[]): string | undefined {
  const counts = new Map<string, number>();
  for (const sighting of sightings) {
    counts.set(sighting.place, (counts.get(sighting.place) ?? 0) + sighting.count);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function notebook(sightings: readonly Sighting[], place: string): string {
  const nearby = sightings.filter((sighting) => sighting.place === place);
  return nearby.map(describe).join('\\n');
}
`;

const AFTER = `export interface Sighting {
  species: string;
  count: number;
  place: string;
  notes?: string;
}

export function describe(sighting: Sighting): string {
  const summary = \`\${sighting.species}: \${sighting.count} spotted\`;
  return sighting.notes ? \`\${summary} (\${sighting.notes})\` : summary;
}

export function speciesSeen(sightings: readonly Sighting[]): string[] {
  return [...new Set(sightings.map((sighting) => sighting.species))];
}

export function busiestSpot(sightings: readonly Sighting[]): string | undefined {
  const counts = new Map<string, number>();
  for (const sighting of sightings) {
    counts.set(sighting.place, (counts.get(sighting.place) ?? 0) + sighting.count);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function notebook(sightings: readonly Sighting[], place: string): string {
  const nearby = sightings.filter((sighting) => sighting.place.toLowerCase() === place.toLowerCase());
  return nearby.map(describe).join('\\n') || 'No birds spotted here yet.';
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
