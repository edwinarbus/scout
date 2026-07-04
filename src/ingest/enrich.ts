import sharp from "sharp";
import { and, eq, isNotNull } from "drizzle-orm";
import type { ScoutDb } from "@/db";
import { dogAiEnrichment, dogListings } from "@/db/schema";
import { createStructured, VISION_MODEL, type JsonSchema } from "@/lib/anthropic";
import { ageBucketFromMonths } from "@/lib/normalize";

/**
 * Precomputed Claude vision enrichment.
 *
 * For each dog we analyze exactly ONE image (its primary/cover photo),
 * downscaled and re-encoded to a small JPEG before sending — this is both a
 * cost control (far fewer image tokens) and the reason the batch is run in
 * advance rather than on every page view. Results are cached by the dog's
 * photoHash, so re-running only re-analyzes dogs whose photo actually changed.
 *
 * Each call is grounded with the dog's own shelter-reported breed/sex/size/age
 * (see DogVisionContext) so the read is specific to that dog rather than
 * generic scene narration, and the prompt explicitly excludes any people or
 * objects in frame — the model describes the dog only.
 *
 * Output is model inference from a single photo and is stored/labeled as such
 * — it never overwrites shelter-provided fields.
 */

/** Longest-edge pixels + JPEG quality for the compressed image sent to Claude. */
const IMAGE_MAX_EDGE = 512;
const IMAGE_QUALITY = 72;
const IMAGE_FETCH_TIMEOUT_MS = 20_000;
/** A browser UA — some shelter image CDNs 403 unknown clients. */
const IMAGE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const VISION_SYSTEM_PROMPT = `You are a careful visual describer for a personal dog-adoption search tool.

You are given one photo of a shelter dog, plus the shelter's own reported facts about the dog (breed, sex, size, age) when known. This is a visual impression from one image, NOT a veterinary assessment or a definitive breed determination. Rules:
- Describe ONLY the dog's own body and coat. Completely ignore any people, hands, leashes, collars, harnesses, tags, clothing or costumes, toys, furniture, other animals, or background elements in the photo — never mention or describe them, even in passing.
- Use the shelter-reported facts to ground your read (a "senior chihuahua mix" and a "puppy shepherd mix" should read differently), but do not just restate them. Add what the PHOTO shows beyond those facts: coat condition, posture, expression, distinguishing marks or features, apparent energy level — not a repeat of size/color/age already on file.
- Avoid generic filler that could describe almost any dog (e.g. "looks happy and relaxed") unless something specific and visible in this exact photo supports it.
- Use "unknown" for any field you are not confident about. Never guess.
- Do not state breed. (The shelter's own breed label is tracked separately.)
- If no dog is clearly visible, or the image is unusable, set dog_visible=false and photo_quality accordingly, and leave other fields "unknown"/empty.
- tags: short lowercase adjectives describing the DOG ITSELF that a person might actually search for — e.g. "scruffy", "fluffy", "curly", "smooth-coat", "senior-looking", "puppy-looking", "athletic", "stocky", "one-eye", "floppy-ears". Never tag a collar, leash, harness, clothing, or any other object — only the dog's own physical or temperament traits. Only include tags clearly supported by the image.
- apparent_colors: visible coat colors, lowercase (e.g. "black", "white", "tan", "brindle", "merle") — your own independent visual read.
- apparent_size: rough impression from the image alone; "unknown" if the photo gives no scale.
- visual_description: one or two plain sentences on this specific dog's look and demeanor. No people, no breed claims, no invented backstory, no filler that isn't grounded in what's visible.
- confidence: your overall 0-1 confidence in this read.`;

export const VISION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dog_visible: { type: "boolean" },
    photo_quality: {
      type: "string",
      enum: ["clear", "blurry", "multiple_dogs", "no_dog_visible", "unknown"],
    },
    coat_length: {
      type: "string",
      enum: ["short", "medium", "long", "hairless", "unknown"],
    },
    coat_texture: {
      type: "string",
      enum: ["smooth", "wiry", "curly", "fluffy", "scruffy", "unknown"],
    },
    apparent_colors: { type: "array", items: { type: "string" } },
    apparent_size: {
      type: "string",
      enum: ["tiny", "small", "medium", "large", "giant", "unknown"],
    },
    tags: { type: "array", items: { type: "string" } },
    visual_description: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "dog_visible",
    "photo_quality",
    "coat_length",
    "coat_texture",
    "apparent_colors",
    "apparent_size",
    "tags",
    "visual_description",
    "confidence",
  ],
};

export interface VisionResult {
  dog_visible: boolean;
  photo_quality: string;
  coat_length: string;
  coat_texture: string;
  apparent_colors: string[];
  apparent_size: string;
  tags: string[];
  visual_description: string;
  confidence: number;
}

/** Fetch an image and compress to a small JPEG; returns base64 (no data: prefix). */
export async function fetchAndCompressImage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": IMAGE_UA, Accept: "image/*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(input)
      .rotate() // respect EXIF orientation
      .resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: IMAGE_QUALITY })
      .toBuffer();
    return jpeg.toString("base64");
  } finally {
    clearTimeout(timer);
  }
}

const clamp01 = (n: unknown): number | null => {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
};
const norm = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim().toLowerCase();
  return t && t !== "unknown" ? t : null;
};

/** Shelter-reported facts passed alongside the photo, to ground (not replace) the visual read. */
export interface DogVisionContext {
  breed: string | null;
  sex: string | null;
  size: string | null;
  ageBucket: string | null;
}

export function formatContextLine(ctx: DogVisionContext): string {
  const parts = [
    ctx.breed && `breed: ${ctx.breed}`,
    ctx.sex && `sex: ${ctx.sex}`,
    ctx.ageBucket && `age: ${ctx.ageBucket}`,
    ctx.size && `size: ${ctx.size}`,
  ].filter((p): p is string => !!p);
  return parts.length
    ? `Shelter-reported facts about this dog: ${parts.join(", ")}.`
    : "No shelter-reported facts are available for this dog.";
}

/** Analyze one already-compressed image; returns the raw structured result. */
export async function analyzeImage(
  base64Jpeg: string,
  context: DogVisionContext
): Promise<VisionResult> {
  return createStructured<VisionResult>({
    model: VISION_MODEL,
    maxTokens: 700,
    system: VISION_SYSTEM_PROMPT,
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64Jpeg },
      },
      { type: "text", text: `${formatContextLine(context)}\n\nDescribe this dog photo.` },
    ],
    schema: VISION_SCHEMA,
  });
}

export interface EnrichOptions {
  now?: Date;
  limit?: number;
  sourceId?: string;
  force?: boolean; // re-analyze even if a cached read for the same photo exists
  concurrency?: number;
  log?: (msg: string) => void;
}

export interface EnrichSummary {
  candidates: number;
  analyzed: number;
  skippedCached: number;
  skippedNoPhoto: number;
  failed: number;
  noDogVisible: number;
}

interface Candidate {
  id: string;
  primaryPhotoUrl: string | null;
  photoHash: string | null;
}

/** Which dogs need (re)analysis: have a photo, and no fresh cached read. */
export function selectCandidates<C extends Candidate>(
  listings: C[],
  existing: Map<string, { photoHash: string | null }>,
  force: boolean
): { toAnalyze: C[]; skippedCached: number; skippedNoPhoto: number } {
  let skippedCached = 0;
  let skippedNoPhoto = 0;
  const toAnalyze: C[] = [];
  for (const l of listings) {
    if (!l.primaryPhotoUrl) {
      skippedNoPhoto++;
      continue;
    }
    const prev = existing.get(l.id);
    // Cached and the photo hasn't changed → skip (unless forced).
    if (!force && prev && prev.photoHash === l.photoHash) {
      skippedCached++;
      continue;
    }
    toAnalyze.push(l);
  }
  return { toAnalyze, skippedCached, skippedNoPhoto };
}

/**
 * Backstop against object/accessory tags (e.g. "yellow-collar") slipping
 * through despite the prompt instructions — matched by word, so it also
 * catches hyphenated compounds like "yellow-collar" or "red-bandana".
 */
const NON_DOG_TAG_WORDS = new Set([
  "collar",
  "leash",
  "harness",
  "muzzle",
  "cone",
  "bandana",
  "scarf",
  "sweater",
  "coat",
  "jacket",
  "costume",
  "outfit",
  "shirt",
  "vest",
  "bow",
  "bowtie",
  "tag",
  "toy",
  "ball",
  "bowl",
  "crate",
  "kennel",
  "cage",
  "blanket",
  "bed",
  "chain",
  "fence",
  "person",
  "human",
  "hand",
  "handler",
]);

export function isDogCharacteristicTag(tag: string): boolean {
  const words = tag.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && !words.some((w) => NON_DOG_TAG_WORDS.has(w));
}

/**
 * Same backstop as isDogCharacteristicTag, but for the free-text
 * visual_description: the "ignore people" prompt rule isn't 100% reliable on
 * its own (confirmed live — one description read "...being held up by a
 * person"), and a sentence can't be word-filtered without reading broken, so
 * a match here drops the whole description rather than trying to edit it.
 * Deliberately excludes ambiguous verbs like "held" (as in "tail held high",
 * a legitimate dog-posture phrase) — only unambiguous person-nouns.
 */
const PERSON_MENTION_PATTERN =
  /\b(person|people|human|hands?|handlers?|women?|men|volunteers?|staff|owners?)\b/i;

export function isPersonFreeDescription(text: string): boolean {
  return !PERSON_MENTION_PATTERN.test(text);
}

export function mapVisionToRow(
  candidate: Candidate,
  result: VisionResult,
  now: Date
): typeof dogAiEnrichment.$inferInsert {
  return {
    dogListingId: candidate.id,
    photoHash: candidate.photoHash,
    imageUrl: candidate.primaryPhotoUrl,
    model: VISION_MODEL,
    analyzedAt: now,
    coatLength: norm(result.coat_length),
    coatTexture: norm(result.coat_texture),
    apparentColors: (result.apparent_colors ?? []).map((c) => c.toLowerCase().trim()).filter(Boolean),
    apparentSize: norm(result.apparent_size),
    tags: (result.tags ?? [])
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean)
      .filter(isDogCharacteristicTag),
    visualDescription:
      result.dog_visible && result.visual_description && isPersonFreeDescription(result.visual_description)
        ? result.visual_description.trim() || null
        : null,
    photoQuality: norm(result.photo_quality),
    confidence: clamp01(result.confidence),
    rawResponse: result as unknown as Record<string, unknown>,
  };
}

/** Run the enrichment batch. Bounded concurrency; cached by photoHash. */
export async function enrichDogs(db: ScoutDb, opts: EnrichOptions = {}): Promise<EnrichSummary> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((m: string) => console.log(m));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 8));

  const listings = db
    .select({
      id: dogListings.id,
      primaryPhotoUrl: dogListings.primaryPhotoUrl,
      photoHash: dogListings.photoHash,
      breedNormalized: dogListings.breedNormalized,
      sex: dogListings.sex,
      sizeNormalized: dogListings.sizeNormalized,
      ageMonthsEstimate: dogListings.ageMonthsEstimate,
    })
    .from(dogListings)
    .where(
      opts.sourceId
        ? and(eq(dogListings.sourceId, opts.sourceId), isNotNull(dogListings.primaryPhotoUrl))
        : isNotNull(dogListings.primaryPhotoUrl)
    )
    .all();

  const existing = new Map(
    db
      .select({ dogListingId: dogAiEnrichment.dogListingId, photoHash: dogAiEnrichment.photoHash })
      .from(dogAiEnrichment)
      .all()
      .map((r) => [r.dogListingId, { photoHash: r.photoHash }])
  );

  const { toAnalyze, skippedCached, skippedNoPhoto } = selectCandidates(
    listings,
    existing,
    !!opts.force
  );
  const queue = opts.limit ? toAnalyze.slice(0, opts.limit) : toAnalyze;

  log(
    `Enrichment (${VISION_MODEL}): ${queue.length} to analyze` +
      ` (${skippedCached} cached, ${skippedNoPhoto} no photo, ${listings.length} total with photos)`
  );

  const summary: EnrichSummary = {
    candidates: queue.length,
    analyzed: 0,
    skippedCached,
    skippedNoPhoto,
    failed: 0,
    noDogVisible: 0,
  };

  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const c = queue[cursor++];
      try {
        const b64 = await fetchAndCompressImage(c.primaryPhotoUrl!);
        const result = await analyzeImage(b64, {
          breed: c.breedNormalized,
          sex: c.sex,
          size: c.sizeNormalized,
          ageBucket: ageBucketFromMonths(c.ageMonthsEstimate),
        });
        const row = mapVisionToRow(c, result, now);
        db.insert(dogAiEnrichment)
          .values(row)
          .onConflictDoUpdate({ target: dogAiEnrichment.dogListingId, set: row })
          .run();
        summary.analyzed++;
        if (!result.dog_visible) summary.noDogVisible++;
        if (summary.analyzed % 25 === 0) {
          log(`  … ${summary.analyzed}/${queue.length} analyzed`);
        }
      } catch (err) {
        summary.failed++;
        log(`  ✗ ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  log(
    `Done: ${summary.analyzed} analyzed (${summary.noDogVisible} no clear dog), ${summary.failed} failed.`
  );
  return summary;
}
