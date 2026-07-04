import type { RunStatus } from "@/lib/types";

/**
 * Rule-based (no AI) 0..1 trust score for a source run. Deliberately simple:
 * start from 1.0 and subtract for each observed reliability problem, with
 * hard floors for zero-dog and failed runs. Rounded to 2 decimals.
 */

export interface ConfidenceInputs {
  status: RunStatus;
  dogsFound: number;
  paginationCompleted: boolean | null;
  detailExtractionCompleted: boolean | null;
  detailsAttempted: number;
  detailsFailed: number;
  totalReportedBySource: number | null;
  countMismatch: boolean;
  /** listings whose dedupe key fell back below source_animal_id */
  listingsMissingStableIds: number;
  photosPresent: number;
  originalUrlsPresent: number;
  warningsCount: number;
}

export function confidenceScore(i: ConfidenceInputs): number {
  if (i.status === "failed" || i.status === "blocked") return 0;
  if (i.dogsFound === 0) return 0.1;

  let score = 1.0;
  if (i.paginationCompleted !== true) score -= 0.3;
  if (i.countMismatch) score -= 0.15;
  if (i.detailExtractionCompleted !== true) score -= 0.1;
  if (i.detailsAttempted > 0) {
    score -= Math.min(0.2, (i.detailsFailed / i.detailsAttempted) * 0.5);
  }
  const weakRatio = i.listingsMissingStableIds / i.dogsFound;
  if (weakRatio > 0.05) score -= Math.min(0.25, weakRatio * 0.5);
  const photoRatio = i.photosPresent / i.dogsFound;
  if (photoRatio < 0.8) score -= 0.05;
  const urlRatio = i.originalUrlsPresent / i.dogsFound;
  if (urlRatio < 1) score -= 0.2;
  if (i.warningsCount > 0) score -= Math.min(0.1, i.warningsCount * 0.02);

  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}
