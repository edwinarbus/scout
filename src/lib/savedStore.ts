"use client";

/**
 * The owner's "hearted" shortlist, kept in localStorage so it survives reloads
 * and is instant to read (no round-trip). We store a small snapshot of each dog
 * (enough to render the saved list + link out) alongside the id, since a saved
 * dog may not be in the currently-loaded result set. Heart toggles also sync to
 * the server best-effort (for the overnight watch features), but this store is
 * the source of truth for the heart state and the saved panel.
 */

export interface SavedDog {
  id: string;
  name: string | null;
  photo: string | null;
  breed: string | null;
  city: string | null;
  url: string;
  savedAt: number;
}

const KEY = "scout:saved-dogs";
export const SAVED_EVENT = "scout:saved-changed";

export function getSaved(): SavedDog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedDog[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function isSaved(id: string): boolean {
  return getSaved().some((d) => d.id === id);
}

function write(list: SavedDog[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — the in-memory event still fires for this session */
  }
  window.dispatchEvent(new CustomEvent(SAVED_EVENT));
}

/** Toggle a dog in the shortlist. Returns the new saved state. */
export function toggleSaved(dog: Omit<SavedDog, "savedAt">): boolean {
  const list = getSaved();
  const i = list.findIndex((d) => d.id === dog.id);
  if (i >= 0) {
    list.splice(i, 1);
    write(list);
    return false;
  }
  write([{ ...dog, savedAt: Date.now() }, ...list]);
  return true;
}

export function removeSaved(id: string): void {
  write(getSaved().filter((d) => d.id !== id));
}
