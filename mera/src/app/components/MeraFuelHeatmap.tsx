import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, ZoomIn, ZoomOut } from "lucide-react";
import { loadMapboxGl } from "../lib/loadMapboxGl";
import malawiBoundary from "../data/malawiBoundary.json";

const MAPBOX_TOKEN = String(import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE_URL =
  String(
    import.meta.env.VITE_MAPBOX_STYLE_URL || "mapbox://styles/mapbox/dark-v11",
  ).trim() || "mapbox://styles/mapbox/dark-v11";
const MALAWI_CENTER: [number, number] = [34.35, -13.35];
const MALAWI_BOUNDS: [[number, number], [number, number]] = [
  [32.35, -17.4],
  [36.25, -9.1],
];
const SOURCE_ID = "mera-fuel-heatmap-source";
const BASE_HEAT_LAYER_ID = "mera-fuel-heatmap-availability-heat";
const HEAT_LAYER_ID = "mera-fuel-heatmap-shortage-heat";
const MASK_SOURCE_ID = "mera-malawi-heatmap-mask-source";
const BORDER_SOURCE_ID = "mera-malawi-border-source";
const MASK_LAYER_ID = "mera-malawi-heatmap-mask";
const BORDER_LAYER_ID = "mera-malawi-border";
const DOT_LAYER_ID = "mera-fuel-heatmap-dots";
const WORLD_MASK_RING: Array<[number, number]> = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90],
];

const severityColor: Record<string, string> = {
  normal: "#32db64",
  low: "#ffd21f",
  high: "#ff991f",
  critical: "#ff3434",
  no_data: "#8b98a9",
};

const severityLabels: Array<[string, string]> = [
  ["normal", "Normal"],
  ["low", "Low"],
  ["high", "High"],
  ["critical", "Critical"],
  ["no_data", "No Data"],
];

function number(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidLngLat(lng: number, lat: number) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ringArea(ring: Array<[number, number]>) {
  return ring.reduce((total, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return total + point[0] * next[1] - next[0] * point[1];
  }, 0);
}

function orientRing(ring: Array<[number, number]>, clockwise: boolean) {
  const isClockwise = ringArea(ring) < 0;
  return isClockwise === clockwise ? ring : [...ring].reverse();
}

function boundaryExteriorRings(boundary: any) {
  const feature = boundary?.type === "FeatureCollection"
    ? boundary.features?.[0]
    : boundary;
  const geometry = feature?.geometry || feature;
  if (geometry?.type === "Polygon") {
    return geometry.coordinates.slice(0, 1);
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon: any) => polygon?.[0])
      .filter(Boolean);
  }
  return [];
}

function buildMalawiMask(boundary: any) {
  const holes = boundaryExteriorRings(boundary).map((ring: any) =>
    orientRing(ring, true),
  );
  return featureCollection([
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [orientRing(WORLD_MASK_RING, false), ...holes],
      },
    },
  ]);
}

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeState(value: any) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function severityForRow(row: any) {
  const explicit = String(row?.severity || "")
    .trim()
    .toLowerCase();
  if (severityColor[explicit]) return explicit;

  const availability = normalizeState(
    row?.availability_status ?? row?.availabilityStatus,
  );
  const petrol = normalizeState(row?.petrol_status ?? row?.petrolStatus);
  const diesel = normalizeState(row?.diesel_status ?? row?.dieselStatus);

  if (
    availability === "DRY" ||
    availability === "OUT_OF_STOCK" ||
    (petrol === "DRY" && diesel === "DRY")
  )
    return "critical";
  if (availability === "LIMITED" || petrol === "DRY" || diesel === "DRY")
    return "high";
  if (
    petrol === "LOW" ||
    diesel === "LOW" ||
    petrol === "LIMITED" ||
    diesel === "LIMITED"
  )
    return "low";
  if (
    availability === "UNKNOWN" ||
    availability === "OFFLINE" ||
    availability === ""
  )
    return "no_data";
  return "normal";
}

function scoreForRow(row: any, severity: string) {
  const explicit = number(row?.severityScore ?? row?.severity_score, NaN);
  if (Number.isFinite(explicit)) return clamp(explicit, 0, 100);
  if (severity === "critical") return 95;
  if (severity === "high") return 72;
  if (severity === "low") return 48;
  if (severity === "normal") return 18;
  return 10;
}

function availabilityWeightForSeverity(severity: string) {
  if (severity === "normal") return 0.34;
  if (severity === "no_data") return 0.18;
  return 0.2;
}

function shortageWeightForSeverity(severity: string) {
  if (severity === "critical") return 1;
  if (severity === "high") return 0.74;
  if (severity === "low") return 0.44;
  return 0;
}

function normalizeHeatmapPoint(row: any, index: number) {
  const lat = number(row?.latitude ?? row?.lat, NaN);
  const lng = number(row?.longitude ?? row?.lng, NaN);
  if (!isValidLngLat(lng, lat)) return null;

  const severity = severityForRow(row);
  const score = scoreForRow(row, severity);
  const name = row?.name || row?.station_name || row?.stationName || "Station";
  const district = row?.city || row?.district || "Unknown";

  return {
    id: row?.public_id || row?.publicId || `${name}-${index}`,
    name,
    district,
    coordinates: [lng, lat] as [number, number],
    availability:
      row?.availability_status || row?.availabilityStatus || "UNKNOWN",
    petrol: row?.petrol_status || row?.petrolStatus || "UNKNOWN",
    diesel: row?.diesel_status || row?.dieselStatus || "UNKNOWN",
    severity,
    score,
    availabilityWeight: availabilityWeightForSeverity(severity),
    shortageWeight: shortageWeightForSeverity(severity),
    color: severityColor[severity] || severityColor.no_data,
  };
}

function featureCollection(features: any[]) {
  return {
    type: "FeatureCollection",
    features,
  };
}

const MALAWI_MASK_DATA = buildMalawiMask(malawiBoundary);
const MALAWI_BORDER_DATA = malawiBoundary as any;

function popupHtml(properties: any) {
  return `
    <div class="mera-heatmap-popup-content">
      <strong>${escapeHtml(properties.name)}</strong>
      <span>${escapeHtml(properties.district)}</span>
      <dl>
        <div><dt>Availability</dt><dd>${escapeHtml(properties.availability)}</dd></div>
        <div><dt>Petrol</dt><dd>${escapeHtml(properties.petrol)}</dd></div>
        <div><dt>Diesel</dt><dd>${escapeHtml(properties.diesel)}</dd></div>
      </dl>
    </div>
  `;
}

function fitMapToPoints(
  map: any,
  points: Array<{ coordinates: [number, number] }>,
) {
  if (!points.length) {
    map.flyTo({ center: MALAWI_CENTER, zoom: 5.65, duration: 500 });
    return;
  }

  const lngs = points.map((point) => point.coordinates[0]);
  const lats = points.map((point) => point.coordinates[1]);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];

  map.fitBounds(bounds, {
    maxZoom: points.length === 1 ? 9 : 7.8,
    padding: { top: 96, right: 72, bottom: 72, left: 72 },
    duration: 650,
  });
}

export function MeraFuelHeatmap({
  rows = [],
  title = "Fuel Shortage Heatmap",
  className = "",
}: {
  rows: any[];
  title?: string;
  className?: string;
}) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any | null>(null);
  const popupRef = useRef<any | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const hasFitBoundsRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState("");

  const points = useMemo(
    () =>
      rows.map(normalizeHeatmapPoint).filter(Boolean) as Array<
        ReturnType<typeof normalizeHeatmapPoint> & Record<string, any>
      >,
    [rows],
  );
  const missingCoordinateCount = Math.max(0, rows.length - points.length);

  const data = useMemo(
    () =>
      featureCollection(
        points.map((point) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: point.coordinates,
          },
          properties: {
            id: point.id,
            name: point.name,
            district: point.district,
            availability: point.availability,
            petrol: point.petrol,
            diesel: point.diesel,
            severity: point.severity,
            score: point.score,
            availabilityWeight: point.availabilityWeight,
            shortageWeight: point.shortageWeight,
            color: point.color,
          },
        })),
      ),
    [points],
  );

  useEffect(() => {
    setMapReady(false);
    setLoadError("");

    if (!mapNode.current || mapRef.current) return undefined;

    if (!MAPBOX_TOKEN) {
      setLoadError("Missing VITE_MAPBOX_TOKEN in the MERA .env file.");
      return undefined;
    }

    let cancelled = false;
    let onWindowResize: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    loadMapboxGl()
      .then((mapboxgl) => {
        if (cancelled || !mapNode.current) return;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        const map = new mapboxgl.Map({
          container: mapNode.current,
          style: MAPBOX_STYLE_URL,
          center: MALAWI_CENTER,
          zoom: 5.65,
          minZoom: 4.2,
          maxZoom: 12,
          maxBounds: MALAWI_BOUNDS,
          attributionControl: false,
          pitch: 0,
          bearing: 0,
        });

        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();

        map.on("error", (event: any) => {
          if (cancelled) return;
          const message = event?.error?.message || "Mapbox map error";
          setLoadError(
            String(message).includes("api.mapbox.com")
              ? "Mapbox map tiles could not be loaded. Check the token and allowed URLs."
              : message,
          );
        });

        map.once("load", () => {
          if (cancelled) return;

          try {
            map.addSource(SOURCE_ID, {
              type: "geojson",
              data: featureCollection([]),
            });

            map.addLayer({
              id: BASE_HEAT_LAYER_ID,
              type: "heatmap",
              source: SOURCE_ID,
              paint: {
                "heatmap-weight": [
                  "interpolate",
                  ["linear"],
                  ["get", "availabilityWeight"],
                  0,
                  0,
                  1,
                  1,
                ],
                "heatmap-intensity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  4,
                  0.78,
                  7,
                  1.08,
                  10,
                  1.35,
                ],
                "heatmap-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  4,
                  22,
                  7,
                  50,
                  10,
                  88,
                ],
                "heatmap-opacity": 0.58,
                "heatmap-color": [
                  "interpolate",
                  ["linear"],
                  ["heatmap-density"],
                  0,
                  "rgba(50,219,100,0)",
                  0.18,
                  "rgba(50,219,100,0.22)",
                  0.55,
                  "rgba(50,219,100,0.38)",
                  1,
                  "rgba(50,219,100,0.5)",
                ],
              },
            });

            map.addLayer({
              id: HEAT_LAYER_ID,
              type: "heatmap",
              source: SOURCE_ID,
              filter: [
                "match",
                ["get", "severity"],
                ["low", "high", "critical"],
                true,
                false,
              ],
              paint: {
                "heatmap-weight": [
                  "interpolate",
                  ["linear"],
                  ["get", "shortageWeight"],
                  0,
                  0,
                  1,
                  1,
                ],
                "heatmap-intensity": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  4,
                  1.3,
                  7,
                  2.4,
                  10,
                  3.3,
                ],
                "heatmap-radius": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  4,
                  28,
                  7,
                  66,
                  10,
                  112,
                ],
                "heatmap-opacity": 0.84,
                "heatmap-color": [
                  "interpolate",
                  ["linear"],
                  ["heatmap-density"],
                  0,
                  "rgba(255,210,31,0)",
                  0.12,
                  "rgba(255,210,31,0.42)",
                  0.32,
                  "rgba(255,210,31,0.7)",
                  0.55,
                  "rgba(255,153,31,0.82)",
                  0.78,
                  "rgba(255,52,52,0.93)",
                  1,
                  "rgba(174,24,24,0.98)",
                ],
              },
            });

          map.addSource(MASK_SOURCE_ID, {
            type: "geojson",
            data: MALAWI_MASK_DATA,
          });

          map.addSource(BORDER_SOURCE_ID, {
            type: "geojson",
            data: MALAWI_BORDER_DATA,
          });

          map.addLayer({
            id: MASK_LAYER_ID,
            type: "fill",
            source: MASK_SOURCE_ID,
            paint: {
              "fill-color": "#f7fbff",
              "fill-opacity": 0.86,
            },
          });

          map.addLayer({
            id: DOT_LAYER_ID,
            type: "circle",
            source: SOURCE_ID,
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "score"],
                0,
                4.5,
                100,
                8.5,
              ],
              "circle-color": [
                "match",
                ["get", "severity"],
                "normal",
                severityColor.normal,
                "low",
                severityColor.low,
                "high",
                severityColor.high,
                "critical",
                severityColor.critical,
                severityColor.no_data,
              ],
              "circle-opacity": 0.95,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1.6,
              "circle-stroke-opacity": 0.95,
            },
          });

          map.addLayer({
            id: BORDER_LAYER_ID,
            type: "line",
            source: BORDER_SOURCE_ID,
            paint: {
              "line-color": "#6f8191",
              "line-opacity": 0.72,
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                4,
                0.8,
                8,
                1.4,
                11,
                2.2,
              ],
            },
          });

          map.on("mouseenter", DOT_LAYER_ID, () => {
            map.getCanvas().style.cursor = "pointer";
          });

          map.on("mouseleave", DOT_LAYER_ID, () => {
            map.getCanvas().style.cursor = "";
          });

          map.on("click", DOT_LAYER_ID, (event: any) => {
            const feature = event?.features?.[0];
            const coordinates = feature?.geometry?.coordinates?.slice();
            if (!coordinates) return;

            popupRef.current?.remove();
            popupRef.current = new mapboxgl.Popup({
              closeButton: true,
              closeOnClick: true,
              className: "mera-heatmap-popup",
              offset: 14,
            })
              .setLngLat(coordinates)
              .setHTML(popupHtml(feature.properties || {}))
              .addTo(map);
          });

          setMapReady(true);
          setLoadError("");
          map.resize();
          window.setTimeout(() => {
            if (!cancelled) {
              map.resize();
            }
          }, 160);
          window.requestAnimationFrame(() => {
            if (!cancelled) map.resize();
          });
          } catch (error) {
            setLoadError(`Map initialization error: ${error}`);
          }
        });

        onWindowResize = () => map.resize();
        window.addEventListener("resize", onWindowResize);
        if ("ResizeObserver" in window && mapNode.current) {
          resizeObserver = new ResizeObserver(() => {
            map.resize();
          });
          resizeObserver.observe(mapNode.current);
        }
        mapRef.current = map;

        loadTimeoutRef.current = window.setTimeout(() => {
          if (cancelled || map.isStyleLoaded()) return;
          setLoadError(
            "Mapbox did not finish loading. Check token scope and allowed URLs in Mapbox.",
          );
        }, 8000);
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(error?.message || "Unable to load Mapbox GL resources.");
      });

    return () => {
      cancelled = true;
      if (loadTimeoutRef.current) window.clearTimeout(loadTimeoutRef.current);
      if (onWindowResize) window.removeEventListener("resize", onWindowResize);
      resizeObserver?.disconnect();
      popupRef.current?.remove();
      popupRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const source = mapRef.current.getSource(SOURCE_ID);
    if (source?.setData) source.setData(data);

    const fitWhenSized = () => {
      if (!mapRef.current) return;
      mapRef.current.resize();
      const rect = mapNode.current?.getBoundingClientRect();
      if (!hasFitBoundsRef.current && rect && rect.width > 0 && rect.height > 0) {
        fitMapToPoints(mapRef.current, points);
        hasFitBoundsRef.current = true;
      }
    };

    fitWhenSized();
    const fitTimer = window.setTimeout(fitWhenSized, 220);
    return () => window.clearTimeout(fitTimer);
  }, [data, mapReady, points]);

  const statusMessage =
    loadError ||
    (!rows.length
      ? "Waiting for live station availability from the MERA feed."
      : "") ||
    (!points.length
      ? "No stations with valid coordinates are available for this map."
      : "") ||
    (!mapReady ? "Loading Mapbox heatmap." : "");

  return (
    <section
      className={`relative h-[360px] min-h-[360px] w-full overflow-hidden rounded-[5px] border border-[#142332] bg-[#030b12] text-white shadow-[var(--mera-shadow-card)] ${className}`}
      style={{ minHeight: 360 }}
    >
      <div
        ref={mapNode}
        className="mera-mapbox-surface absolute inset-0 z-0 h-full min-h-[360px] w-full bg-[#030b12]"
        style={{ width: "100%", height: "100%", minHeight: 360 }}
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(180deg,rgba(2,8,17,0.08),rgba(2,8,17,0.34))]" />

      <div className="absolute left-4 top-4 z-10 flex items-center gap-3">
        <h2 className="text-[14px] font-semibold uppercase tracking-[-0.02em]">
          {title}
        </h2>
        <span className="inline-flex h-5 items-center gap-1.5 rounded-[4px] border border-[#1f6f45] bg-[#0a2a1e] px-2 text-[9px] font-bold text-[#55e489] shadow-sm">
          <span className="size-2 rounded-full bg-[var(--mera-success)]" />
          Live
        </span>
      </div>

      <div className="absolute left-4 top-[48px] z-10 w-[112px] rounded-[5px] border border-[#213345] bg-[#07131f]/92 p-2.5 shadow-xl backdrop-blur">
        <div className="mb-2 text-[10px] font-bold text-white">Shortage Level</div>
        {severityLabels.map(([key, label]) => (
          <div
            key={key}
            className="mb-1.5 flex items-center gap-2 text-[9px] font-medium text-[#cbd6e2] last:mb-0"
          >
            <span
              className="size-3 rounded-full ring-1 ring-[var(--mera-panel-border)]"
              style={{ backgroundColor: severityColor[key] }}
            />
            {label}
          </div>
        ))}
      </div>

      {statusMessage ? (
        <div className="absolute inset-x-4 top-24 z-20 rounded-[5px] border border-[#213345] bg-[#07131f]/92 px-3 py-2 text-[10px] font-semibold text-[#cbd6e2] shadow-sm backdrop-blur">
          {statusMessage}
        </div>
      ) : null}

      {missingCoordinateCount ? (
        <div className="absolute bottom-4 left-4 z-10 max-w-[340px] rounded-[5px] border border-[#213345] bg-[#07131f]/90 px-3 py-2 text-[10px] font-semibold text-[#cbd6e2] shadow-sm backdrop-blur">
          {missingCoordinateCount} station
          {missingCoordinateCount === 1 ? "" : "s"} missing coordinates and not
          shown.
        </div>
      ) : null}

      <div className="absolute right-3 top-[168px] z-10 overflow-hidden rounded-[5px] border border-[#213345] bg-[#07131f]/90 shadow-xl backdrop-blur">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn({ duration: 220 })}
          disabled={!mapReady}
          className="grid size-8 place-items-center text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom in"
        >
          <ZoomIn className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut({ duration: 220 })}
          disabled={!mapReady}
          className="grid size-8 place-items-center border-y border-[#213345] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom out"
        >
          <ZoomOut className="size-5" />
        </button>
        <button
          type="button"
          onClick={() =>
            mapRef.current && fitMapToPoints(mapRef.current, points)
          }
          disabled={!mapReady}
          className="grid size-8 place-items-center text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Recenter"
        >
          <Gauge className="size-5" />
        </button>
      </div>
    </section>
  );
}
