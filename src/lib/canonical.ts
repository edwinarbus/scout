import { isPlaceholderName } from "./normalize";

/**
 * Canonical dedupe grouping.
 *
 * Sources cross-post the same dog (a county dog also listed by a rescue, a
 * relisted dog with a new id, the same feed surfaced twice). Per project
 * policy we are deliberately aggressive: if two listings are remotely
 * similar, we'd rather show one card with two source links than two cards
 * for one dog. The cost of over-merging is a card that says "also listed
 * at ..."; the cost of under-merging is duplicate dogs — we prefer the former.
 *
 * Merge rules (union-find):
 *  1. Identical primary photo URL → same dog (strongest signal).
 *  2. Same source + same normalized name + compatible sex + overlapping breed
 *     tokens → same dog (relisting with a new id).
 *  3. Across sources: same normalized name (not a placeholder/id-style name)
 *     + compatible sex + (breed tokens overlap OR either breed unknown)
 *     + compatible age → same dog.
 *
 * Placeholder names ("A5786773", "Puppy", "Unknown") never merge across
 * sources — within a source they still merge only on identical animal id,
 * which the natural key already guarantees.
 */

export interface CanonicalInput {
  id: string;
  sourceId: string;
  name: string | null; // normalized name
  sex: string | null;
  breedTokens: string[];
  ageMonthsEstimate: number | null;
  primaryPhotoUrl: string | null;
  lastSeenAt: Date;
  hasPhoto: boolean;
  bioLength: number;
  isActive: boolean;
}

export interface CanonicalGroup {
  mergeKey: string;
  displayListingId: string;
  listingIds: string[];
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

function sexCompatible(a: string | null, b: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x === "unknown" || y === "unknown") return true;
  return x === y;
}

function breedOverlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.some((t) => b.includes(t));
}

/** Ages compatible if unknown on either side, or within 24 months. */
function ageCompatible(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return Math.abs(a - b) <= 24;
}

class UnionFind {
  parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export function buildCanonicalGroups(listings: CanonicalInput[]): CanonicalGroup[] {
  const uf = new UnionFind();
  for (const l of listings) uf.find(l.id);

  // Rule 1: identical primary photo URL — but never through shared
  // placeholder images ("no photo available"), which would chain unrelated
  // dogs together. A URL used by 3+ listings is treated as a placeholder
  // regardless of its filename.
  const photoCounts = new Map<string, number>();
  for (const l of listings) {
    const key = l.primaryPhotoUrl?.trim();
    if (key) photoCounts.set(key, (photoCounts.get(key) ?? 0) + 1);
  }
  const PLACEHOLDER = /no[-_ ]?(image|pic|photo)|placeholder|default[-_.]|generic\.(svg|png|jpg)/i;
  const byPhoto = new Map<string, string>();
  for (const l of listings) {
    const key = l.primaryPhotoUrl?.trim();
    if (!key || PLACEHOLDER.test(key) || (photoCounts.get(key) ?? 0) > 2) continue;
    const prev = byPhoto.get(key);
    if (prev) uf.union(prev, l.id);
    else byPhoto.set(key, l.id);
  }

  // Rules 2 & 3: name-based merging. Bucket by name to keep this O(n·bucket).
  const byName = new Map<string, CanonicalInput[]>();
  for (const l of listings) {
    const n = norm(l.name);
    if (!n) continue;
    const arr = byName.get(n) ?? [];
    arr.push(l);
    byName.set(n, arr);
  }
  for (const [, group] of byName) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!sexCompatible(a.sex, b.sex)) continue;
        const sameSource = a.sourceId === b.sourceId;
        if (sameSource) {
          // Relisting within a source: require breed token overlap
          // (or both unknown) so "Bella the chihuahua" ≠ "Bella the husky".
          const overlap =
            breedOverlap(a.breedTokens, b.breedTokens) ||
            (!a.breedTokens.length && !b.breedTokens.length);
          if (overlap) uf.union(a.id, b.id);
        } else {
          // Cross-source: skip placeholder/id-style names entirely.
          if (isPlaceholderName(a.name) || isPlaceholderName(b.name)) continue;
          const breedsOk =
            breedOverlap(a.breedTokens, b.breedTokens) ||
            !a.breedTokens.length ||
            !b.breedTokens.length;
          if (breedsOk && ageCompatible(a.ageMonthsEstimate, b.ageMonthsEstimate)) {
            uf.union(a.id, b.id);
          }
        }
      }
    }
  }

  // Collect groups and pick a display listing:
  // active > has photo > longer bio > most recently seen.
  const byRoot = new Map<string, CanonicalInput[]>();
  for (const l of listings) {
    const root = uf.find(l.id);
    const arr = byRoot.get(root) ?? [];
    arr.push(l);
    byRoot.set(root, arr);
  }

  const groups: CanonicalGroup[] = [];
  for (const [, members] of byRoot) {
    const sorted = [...members].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (a.hasPhoto !== b.hasPhoto) return a.hasPhoto ? -1 : 1;
      if (a.bioLength !== b.bioLength) return b.bioLength - a.bioLength;
      return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
    });
    const display = sorted[0];
    groups.push({
      mergeKey: buildMergeKey(display),
      displayListingId: display.id,
      listingIds: members.map((m) => m.id).sort(),
    });
  }
  return groups;
}

function buildMergeKey(l: CanonicalInput): string {
  return [norm(l.name) || "unnamed", norm(l.sex) || "?", l.breedTokens[0] ?? "?"].join("|");
}
