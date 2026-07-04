import type { GeocodePrecision } from "./types";

/**
 * Phase-one geocoding is entirely offline: shelter/campus coordinates come
 * from the source registry or adapter campus maps, with static CA city/county
 * centroid fallbacks. No external geocoding service is called. The
 * geocode_cache table exists so a real provider can slot in later without
 * re-resolving anything.
 *
 * All coordinates below are approximate (map-display quality, not navigation).
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
}

/** Approximate centroids for CA cities Scout's sources and mock data use. */
export const CA_CITY_COORDS: Record<string, [number, number]> = {
  "san francisco": [37.7749, -122.4194],
  oakland: [37.8044, -122.2712],
  berkeley: [37.8715, -122.273],
  richmond: [37.9358, -122.3477],
  novato: [38.1074, -122.5697],
  "san jose": [37.3382, -121.8863],
  milpitas: [37.4323, -121.8996],
  burlingame: [37.5841, -122.3661],
  "san mateo": [37.5629, -122.3255],
  "san martin": [37.085, -121.6103],
  gilroy: [37.0058, -121.5683],
  "santa cruz": [36.9741, -122.0308],
  watsonville: [36.9102, -121.7569],
  sacramento: [38.5816, -121.4944],
  stockton: [37.9577, -121.2908],
  fresno: [36.7378, -119.7871],
  bakersfield: [35.3733, -119.0187],
  "san luis obispo": [35.2828, -120.6596],
  "santa barbara": [34.4208, -119.6982],
  ventura: [34.2805, -119.2945],
  "los angeles": [34.0522, -118.2437],
  "long beach": [33.7701, -118.1937],
  downey: [33.94, -118.1326],
  "baldwin park": [34.0854, -117.9606],
  carson: [33.8317, -118.282],
  gardena: [33.8883, -118.3089],
  castaic: [34.4889, -118.6229],
  lancaster: [34.6868, -118.1542],
  palmdale: [34.5794, -118.1165],
  "agoura hills": [34.1533, -118.7615],
  "van nuys": [34.1867, -118.4483],
  chatsworth: [34.2572, -118.6016],
  "san pedro": [33.7361, -118.2922],
  riverside: [33.9806, -117.3755],
  "jurupa valley": [33.9972, -117.4855],
  "san bernardino": [34.1083, -117.2898],
  "san diego": [32.7157, -117.1611],
  escondido: [33.1192, -117.0864],
  oceanside: [33.1959, -117.3795],
  "el cajon": [32.7948, -116.9625],
  "santa rosa": [38.4404, -122.7141],
  napa: [38.2975, -122.2869],
  fairfield: [38.2494, -122.04],
  vallejo: [38.1041, -122.2566],
  concord: [37.978, -122.0311],
  hayward: [37.6688, -122.0808],
  fremont: [37.5485, -121.9886],
  "palm springs": [33.8303, -116.5453],
  irvine: [33.6846, -117.8265],
  "santa ana": [33.7455, -117.8677],
};

/** Approximate centroids for CA counties Scout cares about. */
export const CA_COUNTY_COORDS: Record<string, [number, number]> = {
  "san francisco": [37.7599, -122.4148],
  alameda: [37.6469, -121.889],
  "contra costa": [37.9191, -121.9277],
  marin: [38.0834, -122.7633],
  sonoma: [38.5779, -122.9888],
  napa: [38.5025, -122.2654],
  solano: [38.3105, -121.9018],
  "santa clara": [37.2318, -121.6951],
  "san mateo": [37.4337, -122.4014],
  "santa cruz": [37.0454, -122.0095],
  monterey: [36.2168, -121.3542],
  "san benito": [36.6058, -121.075],
  sacramento: [38.4747, -121.3542],
  yolo: [38.6864, -121.9018],
  placer: [39.0916, -120.8039],
  "el dorado": [38.7787, -120.5247],
  "san joaquin": [37.9349, -121.2713],
  fresno: [36.7581, -119.6493],
  kern: [35.3433, -118.7296],
  "san luis obispo": [35.3102, -120.4358],
  "santa barbara": [34.6725, -120.0158],
  ventura: [34.3705, -119.1391],
  "los angeles": [34.3209, -118.2247],
  orange: [33.7031, -117.7609],
  riverside: [33.7437, -115.9938],
  "san bernardino": [34.8414, -116.1785],
  "san diego": [33.0284, -116.7702],
  imperial: [33.0114, -115.4734],
};

export function cityCoords(city: string | null | undefined): GeoPoint | null {
  if (!city) return null;
  const c = CA_CITY_COORDS[city.trim().toLowerCase()];
  return c ? { latitude: c[0], longitude: c[1], precision: "city" } : null;
}

export function countyCoords(county: string | null | undefined): GeoPoint | null {
  if (!county) return null;
  const key = county.trim().toLowerCase().replace(/\s+county$/, "");
  const c = CA_COUNTY_COORDS[key];
  return c ? { latitude: c[0], longitude: c[1], precision: "county" } : null;
}

export interface LocationInput {
  latitude?: number | null;
  longitude?: number | null;
  geocodePrecision?: GeocodePrecision | null;
  city?: string | null;
  county?: string | null;
}

export interface SourceLocation {
  latitude: number | null;
  longitude: number | null;
  geocodePrecision: GeocodePrecision;
  city: string | null;
  county: string | null;
}

/**
 * Resolve a dog's map position with honest precision, in order:
 *  1. adapter-provided coordinates (dog- or campus-level),
 *  2. the source's own shelter coordinates,
 *  3. dog's city centroid, 4. source city centroid,
 *  5. dog's county centroid, 6. source county centroid,
 *  7. unknown (no coordinates — the UI must tolerate this).
 */
export function resolveDogLocation(
  dog: LocationInput,
  source: SourceLocation
): GeoPoint | { latitude: null; longitude: null; precision: "unknown" } {
  if (dog.latitude != null && dog.longitude != null) {
    return {
      latitude: dog.latitude,
      longitude: dog.longitude,
      precision: dog.geocodePrecision ?? "campus",
    };
  }
  if (source.latitude != null && source.longitude != null) {
    return {
      latitude: source.latitude,
      longitude: source.longitude,
      precision: source.geocodePrecision === "unknown" ? "campus" : source.geocodePrecision,
    };
  }
  const city = cityCoords(dog.city) ?? cityCoords(source.city);
  if (city) return city;
  const county = countyCoords(dog.county) ?? countyCoords(source.county);
  if (county) return county;
  return { latitude: null, longitude: null, precision: "unknown" };
}

/** Great-circle distance in miles. */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
