import type { SourceAdapter } from "./types";
import { mockAdapter } from "./mock";
import { petconnect24Adapter } from "./petconnect24";
import { lacdaccAdapter } from "./lacdacc";
import { muttvilleAdapter } from "./muttville";
import { shelterbuddyAdapter } from "./shelterbuddy";
import { laasAdapter } from "./laas";
import { sdhumaneAdapter } from "./sdhumane";
import { sfspcaAdapter } from "./sfspca";
import { oaklandAdapter } from "./oakland";
import { adopetsAdapter } from "./adopets";
import { shelterluvAdapter } from "./shelterluv";

/**
 * adapterType (on the AdoptionSource row) → adapter implementation.
 * Sources whose adapterType has no entry here can be seeded and tracked but
 * not crawled; the runner records a failed run explaining that.
 */
export const ADAPTERS: Record<string, SourceAdapter> = {
  mock: mockAdapter,
  petconnect24: petconnect24Adapter,
  lacdacc: lacdaccAdapter,
  muttville: muttvilleAdapter,
  shelterbuddy: shelterbuddyAdapter,
  laas: laasAdapter,
  sdhumane: sdhumaneAdapter,
  sfspca: sfspcaAdapter,
  oakland: oaklandAdapter,
  adopets: adopetsAdapter,
  shelterluv: shelterluvAdapter,
};

export function getAdapter(adapterType: string): SourceAdapter | null {
  return ADAPTERS[adapterType] ?? null;
}
