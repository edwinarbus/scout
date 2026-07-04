"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import type { Point } from "geojson";
import type { DogView } from "@/lib/dogView";
import { dogColor, sourceUncertain } from "./ui";

const CA_BOUNDS: [[number, number], [number, number]] = [
  [-125.5, 32.0],
  [-113.6, 42.3],
];

// A little roomier than CA so fitBounds(CA) isn't fought by maxBounds, but tight
// enough that the camera can never wander off to other states / the whole US.
const CA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-127.5, 31.0],
  [-112.0, 43.4],
];

/** Bounding box of the dogs that have coordinates (null if none) — so the map
 *  frames exactly where the results are (an Oakland search zooms to Oakland). */
function boundsOfDogs(dogs: DogView[]): [[number, number], [number, number]] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  let n = 0;
  for (const d of dogs) {
    if (d.latitude == null || d.longitude == null) continue;
    n++;
    minLng = Math.min(minLng, d.longitude);
    maxLng = Math.max(maxLng, d.longitude);
    minLat = Math.min(minLat, d.latitude);
    maxLat = Math.max(maxLat, d.latitude);
  }
  if (!n) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/** Minimal raster fallback if the vector style fails/stalls (offline, CDN hiccup). */
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

function toGeoJSON(dogs: DogView[]) {
  return {
    type: "FeatureCollection" as const,
    features: dogs
      .filter((d) => d.latitude != null && d.longitude != null)
      .map((d) => ({
        type: "Feature" as const,
        properties: {
          id: d.id,
          color: dogColor(d).color,
          uncertain: sourceUncertain(d) ? 1 : 0,
          name: d.name ?? "Unknown",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [d.longitude!, d.latitude!],
        },
      })),
  };
}

export default function MapView({
  dogs,
  selectedId,
  onSelect,
}: {
  dogs: DogView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const userMovedRef = useRef(false);
  const dogsRef = useRef(dogs);
  dogsRef.current = dogs;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fitRef = useRef<(duration: number) => void>(() => {});

  // init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      bounds: boundsOfDogs(dogs) ?? CA_BOUNDS,
      fitBoundsOptions: { padding: 48, maxZoom: 11 },
      maxBounds: CA_MAX_BOUNDS,
      minZoom: 4.6,
      attributionControl: { compact: true },
    });

    // Frame the current dogs (or CA if none) — used on init, resize, and data
    // changes, until the user takes the camera over.
    const fitData = (duration: number) => {
      const b = boundsOfDogs(dogsRef.current) ?? CA_BOUNDS;
      map.fitBounds(b, { padding: 48, maxZoom: 11, duration });
    };
    fitRef.current = fitData;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    mapRef.current = map;
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __scoutMap?: MlMap }).__scoutMap = map;
    }

    // If the vector style hasn't arrived within 8s (CDN hiccup, offline),
    // swap to a self-contained raster style so dogs still render.
    const styleFallbackTimer = setTimeout(() => {
      if (!loadedRef.current && !map.isStyleLoaded()) {
        map.setStyle(FALLBACK_STYLE);
      }
    }, 8000);

    // The flex container reaches its final size after hydration/layout, which
    // can be later than map construction AND later than the style 'load'
    // event. Keep re-fitting California on container resizes until the user
    // takes over (drag/zoom/selection).
    map.on("dragstart", () => (userMovedRef.current = true));
    map.on("wheel", () => (userMovedRef.current = true));
    const ro = new ResizeObserver(() => {
      map.resize();
      if (!userMovedRef.current) fitData(0);
    });
    ro.observe(containerRef.current);

    // Sources/layers must survive style swaps (e.g. the raster fallback):
    // "load" fires only for the first style, and isStyleLoaded() can lag
    // behind reality — so attach opportunistically (try/catch) and retry on
    // "styledata" and "idle" until it sticks.
    const ensureLayers = () => {
      if (loadedRef.current || map.getSource("dogs")) return;
      try {
        map.addSource("dogs", {
          type: "geojson",
          data: toGeoJSON(dogsRef.current),
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 26,
        });
      } catch {
        return; // style not ready yet — a later load/styledata/idle event retries
      }
      map.resize();
      if (!userMovedRef.current) fitData(0);

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "dogs",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#c2703e",
          "circle-opacity": 0.88,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25, 200, 31],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "dogs",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Montserrat Medium", "Open Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "dog-points",
        type: "circle",
        source: "dogs",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 7,
          "circle-stroke-width": ["case", ["==", ["get", "uncertain"], 1], 2.5, 1.5],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "uncertain"], 1],
            "#dc2626",
            "#ffffff",
          ],
        },
      });
      map.addLayer({
        id: "dog-selected",
        type: "circle",
        source: "dogs",
        filter: ["==", ["get", "id"], "__none__"],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": 11,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#29201a",
        },
      });

      loadedRef.current = true;
    };
    map.on("load", ensureLayers);
    map.on("styledata", ensureLayers);
    map.on("idle", ensureLayers);

    // Delegated layer events can be registered before the layers exist.
    map.on("click", "clusters", async (e: MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const clusterId = features[0]?.properties?.cluster_id;
      const src = map.getSource("dogs") as maplibregl.GeoJSONSource;
      if (clusterId == null) return;
      const zoom = await src.getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: (features[0].geometry as Point).coordinates as [number, number],
        zoom,
      });
    });
    map.on("click", "dog-points", (e: MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["dog-points"] })[0];
      const id = f?.properties?.id as string | undefined;
      if (id) onSelectRef.current(id);
    });
    for (const layer of ["clusters", "dog-points"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    return () => {
      clearTimeout(styleFallbackTimer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // data updates — gate on source presence, not load flags (attach can race
  // the first data fetch; ensureLayers seeds from dogsRef for the other order)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("dogs") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(toGeoJSON(dogs));
    // Re-frame to the new result set (unless the user has grabbed the camera).
    if (!userMovedRef.current) fitRef.current(500);
  }, [dogs]);

  // selection highlight + fly to
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("dog-selected", ["==", ["get", "id"], selectedId ?? "__none__"]);
    if (selectedId) {
      userMovedRef.current = true; // selection owns the camera from here on
      const dog = dogs.find((d) => d.id === selectedId);
      if (dog?.latitude != null && dog?.longitude != null) {
        map.flyTo({
          center: [dog.longitude, dog.latitude],
          zoom: Math.max(map.getZoom(), 10),
          duration: 700,
        });
      }
    }
  }, [selectedId]); // dogs intentionally omitted: selection drives the camera, data updates don't

  return <div ref={containerRef} className="h-full w-full" />;
}
