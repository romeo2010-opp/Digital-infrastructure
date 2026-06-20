import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Layers3, ZoomIn, ZoomOut } from "lucide-react";
import { loadMapboxGl } from "../lib/loadMapboxGl";
import malawiBoundary from "../data/malawiBoundary.json";

const MAPBOX_TOKEN = String(import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE_URL =
  String(
    import.meta.env.VITE_MAPBOX_STYLE_URL || "mapbox://styles/mapbox/light-v11",
  ).trim() || "mapbox://styles/mapbox/light-v11";
const MALAWI_CENTER: [number, number] = [34.35, -13.35];
const MALAWI_BOUNDS: [[number, number], [number, number]] = [
  [32.35, -17.4],
  [36.25, -9.1],
];
const MALAWI_DEFAULT_ZOOM = 6.05;
const MALAWI_EMPTY_ZOOM = 6.15;
const LOAD_TIMEOUT_MS = 15000;
const SOURCE_ID = "mera-fuel-heatmap-source";
const AVAILABILITY_SURFACE_SOURCE_ID = "mera-fuel-availability-surface-source";
const AVAILABILITY_SURFACE_LAYER_ID = "mera-fuel-availability-surface";
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
const AVAILABILITY_SURFACE_WIDTH = 260;
const AVAILABILITY_SURFACE_HEIGHT = 560;
const AVAILABILITY_SURFACE_RADIUS_DEGREES = 0.86;
const AVAILABILITY_SURFACE_SIGMA_DEGREES = 0.34;
const TRANSPARENT_IMAGE_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const AVAILABILITY_SURFACE_COORDINATES: Array<[number, number]> = [
  [MALAWI_BOUNDS[0][0], MALAWI_BOUNDS[1][1]],
  [MALAWI_BOUNDS[1][0], MALAWI_BOUNDS[1][1]],
  [MALAWI_BOUNDS[1][0], MALAWI_BOUNDS[0][1]],
  [MALAWI_BOUNDS[0][0], MALAWI_BOUNDS[0][1]],
];

const availabilityColor: Record<string, string> = {
  available: "#1D9E75",
  moderate: "#FACC15",
  low: "#EF9F27",
  critical: "#EF9F27",
  dry: "#E24B4A",
  no_data: "#64748B",
};

const severityColor: Record<string, string> = {
  normal: availabilityColor.available,
  moderate: availabilityColor.moderate,
  low: availabilityColor.low,
  high: availabilityColor.low,
  critical: availabilityColor.dry,
  dry: availabilityColor.dry,
  no_data: availabilityColor.no_data,
};

const availabilityLegend: Array<[string, string, string]> = [
  ["dry", "Dry", availabilityColor.dry],
  ["low", "Low", availabilityColor.low],
  ["moderate", "Moderate", availabilityColor.moderate],
  ["available", "Available", availabilityColor.available],
];

const statusLegend: Array<[string, string, string]> = [
  ["available", "Available", availabilityColor.available],
  ["moderate", "Moderate", availabilityColor.moderate],
  ["low", "Low", availabilityColor.low],
  ["dry", "Dry", availabilityColor.dry],
];

const availabilitySurfaceColorStops: Array<[number, [number, number, number]]> = [
  [0, [226, 75, 74]],
  [20, [226, 75, 74]],
  [45, [239, 159, 39]],
  [70, [250, 204, 21]],
  [100, [29, 158, 117]],
];

const layerOptions = [
  ["availability", "Fuel Availability"],
  ["queue", "Queue Congestion"],
  ["complaints", "Complaint Density"],
  ["stockRisk", "Stock Depletion"],
  ["hoarding", "Hoarding Suspicion"],
  ["deliveryDelay", "Delivery Delay"],
  ["offline", "Offline Stations"],
  ["price", "Price Compliance"],
  ["inspection", "Inspection Coverage"],
  ["districtStress", "District Stress"],
] as const;

function number(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truthy(value: any) {
  return value === true || value === "true" || value === "1" || Number(value) === 1;
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

function normalizeStatusKey(value: any) {
  return normalizeState(value).replace(/[\s-]+/g, "_");
}

const availableStates = new Set(["AVAILABLE", "NORMAL", "IN_STOCK", "INSTOCK", "FULL"]);
const moderateStates = new Set(["MODERATE", "MEDIUM"]);
const lowStates = new Set(["LOW", "LIMITED"]);
const criticalStates = new Set(["CRITICAL", "CRITICAL_LOW", "CRITICALLY_LOW"]);
const dryStates = new Set(["DRY", "OUT_OF_STOCK", "OUTOFSTOCK", "NO_STOCK", "EMPTY"]);
const noDataStates = new Set(["", "UNKNOWN", "OFFLINE", "NO_DATA", "N_A", "NA", "NULL"]);

function availabilityCategoryForRow(row: any) {
  const explicit = normalizeStatusKey(
    row?.availabilityCategory ?? row?.availability_category,
  ).toLowerCase();
  if (["available", "moderate", "low", "critical", "dry", "no_data"].includes(explicit)) {
    return explicit;
  }
  if (explicit === "limited") return "low";
  if (explicit === "critically_low" || explicit === "critical_low") return "critical";
  if (explicit === "out_of_stock") return "dry";

  const availability = normalizeStatusKey(
    row?.availability_status ?? row?.availabilityStatus,
  );
  const fuelStates = [
    normalizeStatusKey(row?.petrol_status ?? row?.petrolStatus),
    normalizeStatusKey(row?.diesel_status ?? row?.dieselStatus),
  ];
  const knownFuelStates = fuelStates.filter((state) => !noDataStates.has(state));
  const states = [availability, ...fuelStates];
  const hasState = (set: Set<string>) => states.some((state) => set.has(state));

  if (
    dryStates.has(availability) ||
    (knownFuelStates.length > 0 && knownFuelStates.every((state) => dryStates.has(state)))
  ) {
    return "dry";
  }
  if (hasState(criticalStates)) return "critical";
  if (lowStates.has(availability) || knownFuelStates.some((state) => lowStates.has(state) || dryStates.has(state))) {
    return "low";
  }
  if (hasState(moderateStates)) return "moderate";
  if (availableStates.has(availability) || knownFuelStates.some((state) => availableStates.has(state))) {
    return "available";
  }

  const severity = String(row?.severity || "").trim().toLowerCase();
  if (severity === "normal") return "available";
  if (severity === "moderate") return "moderate";
  if (severity === "low" || severity === "high") return "low";
  if (severity === "critical") return "dry";

  return "no_data";
}

function availabilityScoreForCategory(category: string) {
  if (category === "available") return 100;
  if (category === "moderate") return 70;
  if (category === "low") return 45;
  if (category === "critical") return 25;
  if (category === "dry") return 0;
  return null;
}

function shortageContributionForCategory(category: string) {
  if (category === "moderate") return 0.2;
  if (category === "low") return 0.45;
  if (category === "critical") return 0.75;
  if (category === "dry") return 1;
  return 0;
}

function severityForAvailabilityCategory(category: string) {
  if (category === "available") return "normal";
  if (category === "moderate") return "moderate";
  if (category === "low" || category === "critical") return "low";
  if (category === "dry") return "critical";
  return "no_data";
}

function markerStatusForRow(row: any, severity: string, availabilityCategory = "") {
  const explicit = String(row?.markerStatus || row?.marker_status || row?.status || "")
    .trim()
    .toLowerCase();
  if (explicit.includes("critical")) return "Critical Risk";
  if (explicit.includes("investigation")) return "Under Investigation";
  if (explicit.includes("offline")) return "Offline";
  if (explicit.includes("dry")) return "Dry";
  if (explicit.includes("congested")) return "Congested";
  if (explicit.includes("low")) return "Low Stock";
  if (explicit.includes("moderate")) return "Moderate Stock";
  if (explicit.includes("available")) return "Available";
  if (availabilityCategory === "dry") return "Dry";
  if (availabilityCategory === "critical") return "Critical Stock";
  if (availabilityCategory === "low") return "Low Stock";
  if (availabilityCategory === "moderate") return "Moderate Stock";
  if (availabilityCategory === "available") return "Available";
  if (availabilityCategory === "no_data") return "Offline";
  if (severity === "critical") return "Dry";
  if (severity === "moderate") return "Moderate Stock";
  if (severity === "high") return "Congested";
  if (severity === "low") return "Low Stock";
  if (severity === "no_data") return "Offline";
  return "Available";
}

function weightForLayer(row: any, severity: string, layer: string, shortageContribution: number) {
  const risk = number(row?.riskScore ?? row?.risk_score ?? row?.score, 0) / 100;
  const queue = number(row?.queueLength ?? row?.queue_length ?? row?.active_queue_count, 0);
  const complaints = number(row?.complaints24h ?? row?.complaints_24h ?? row?.complaintCount, 0);
  const wait = number(row?.averageWaitTime ?? row?.avgWaitMinutes ?? row?.avg_wait_minutes, 0);
  const shortage = shortageContribution;
  if (layer === "availability") return 0;
  if (layer === "queue") return clamp(queue / 90 + wait / 180, 0, 1);
  if (layer === "complaints") return clamp(complaints / 8, 0, 1);
  if (layer === "stockRisk") return shortage;
  if (layer === "hoarding") return clamp(risk, 0, 1);
  if (layer === "deliveryDelay") return clamp(number(row?.deliveryDelayHours ?? row?.delivery_delay_hours, 0) / 24 + risk * 0.35, 0, 1);
  if (layer === "offline") return markerStatusForRow(row, severity) === "Offline" ? 1 : 0;
  if (layer === "price") return clamp(number(row?.priceMismatch ?? row?.mismatchAmount, 0) / 200, 0, 1);
  if (layer === "inspection") return clamp(1 - number(row?.inspectionCoverage ?? row?.inspection_coverage, 0), 0, 1) || risk * 0.45;
  if (layer === "districtStress") return clamp(risk * 0.7 + shortage * 0.3, 0, 1);
  return shortage;
}

function severityForRow(row: any) {
  const availabilityCategory = availabilityCategoryForRow(row);
  if (availabilityCategory !== "no_data") return severityForAvailabilityCategory(availabilityCategory);

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
  if (severity === "moderate") return 34;
  if (severity === "normal") return 18;
  return 10;
}

function normalizeHeatmapPoint(row: any, index: number, activeLayer = "availability") {
  const lat = number(row?.latitude ?? row?.lat, NaN);
  const lng = number(row?.longitude ?? row?.lng, NaN);
  if (!isValidLngLat(lng, lat)) return null;

  const availabilityCategory = availabilityCategoryForRow(row);
  const availabilityScore = availabilityScoreForCategory(availabilityCategory);
  const shortageContribution = shortageContributionForCategory(availabilityCategory);
  const severity = severityForRow(row);
  const score = scoreForRow(row, severity);
  const markerStatus = markerStatusForRow(row, severity, availabilityCategory);
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
    owner: row?.owner || row?.omc || row?.operator_name || "Unknown OMC",
    queueLength: number(row?.queueLength ?? row?.queue_length ?? row?.active_queue_count, 0),
    averageWaitTime: number(row?.averageWaitTime ?? row?.avgWaitMinutes ?? row?.avg_wait_minutes, 0),
    riskScore: number(row?.riskScore ?? row?.risk_score ?? score, score),
    openCases: number(row?.openCases ?? row?.open_cases, 0),
    openFlags: number(row?.openFlags ?? row?.open_flags, 0),
    maxFlagSeverity: row?.maxFlagSeverity || row?.max_flag_severity || "",
    latestDeliveryTime: row?.latestDeliveryTime || row?.latest_delivery_time || "",
    deliveryVerified: truthy(row?.deliveryVerified ?? row?.delivery_verified),
    deliveredLitresSinceBaseline: number(row?.deliveredLitresSinceBaseline ?? row?.delivered_litres_since_baseline, 0),
    totalLiveLitres: number(row?.totalLiveLitres ?? row?.total_live_litres, NaN),
    totalCapacityLitres: number(row?.totalCapacityLitres ?? row?.total_capacity_litres, NaN),
    lastUpdate: row?.lastUpdate || row?.latest_status_at || row?.updated_at || row?.status_updated_at || row?.created_at || "",
    markerStatus,
    severity,
    score,
    availabilityCategory,
    availabilityScore,
    shortageContribution,
    activeWeight: weightForLayer(row, severity, activeLayer, shortageContribution),
    color: availabilityColor[availabilityCategory] || availabilityColor.no_data,
  };
}

function colorForAvailabilitySurfaceScore(score: number): [number, number, number] {
  for (let index = 1; index < availabilitySurfaceColorStops.length; index += 1) {
    const [previousScore, previousColor] = availabilitySurfaceColorStops[index - 1];
    const [nextScore, nextColor] = availabilitySurfaceColorStops[index];
    if (score <= nextScore) {
      const progress = clamp((score - previousScore) / Math.max(1, nextScore - previousScore), 0, 1);
      return [
        Math.round(previousColor[0] + (nextColor[0] - previousColor[0]) * progress),
        Math.round(previousColor[1] + (nextColor[1] - previousColor[1]) * progress),
        Math.round(previousColor[2] + (nextColor[2] - previousColor[2]) * progress),
      ];
    }
  }

  return availabilitySurfaceColorStops[availabilitySurfaceColorStops.length - 1][1];
}

function buildAvailabilitySurfaceImage(points: Array<ReturnType<typeof normalizeHeatmapPoint> & Record<string, any>>) {
  if (typeof document === "undefined") return "";

  const knownPoints = points
    .filter((point) => Number.isFinite(Number(point.availabilityScore)))
    .map((point) => ({
      lng: point.coordinates[0],
      lat: point.coordinates[1],
      score: Number(point.availabilityScore),
    }));

  if (!knownPoints.length) return "";

  const canvas = document.createElement("canvas");
  canvas.width = AVAILABILITY_SURFACE_WIDTH;
  canvas.height = AVAILABILITY_SURFACE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return "";

  const [[minLng, minLat], [maxLng, maxLat]] = MALAWI_BOUNDS;
  const width = AVAILABILITY_SURFACE_WIDTH;
  const height = AVAILABILITY_SURFACE_HEIGHT;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  const cosLat = Math.cos((MALAWI_CENTER[1] * Math.PI) / 180);
  const radius = AVAILABILITY_SURFACE_RADIUS_DEGREES;
  const radiusSq = radius * radius;
  const sigmaSq2 = 2 * AVAILABILITY_SURFACE_SIGMA_DEGREES * AVAILABILITY_SURFACE_SIGMA_DEGREES;
  const radiusLng = radius / Math.max(0.2, cosLat);
  const radiusX = Math.ceil((radiusLng / lngSpan) * (width - 1));
  const radiusY = Math.ceil((radius / latSpan) * (height - 1));
  const scoreTotals = new Float32Array(width * height);
  const weightTotals = new Float32Array(width * height);

  for (const point of knownPoints) {
    const pointX = ((point.lng - minLng) / lngSpan) * (width - 1);
    const pointY = ((maxLat - point.lat) / latSpan) * (height - 1);
    const startX = Math.max(0, Math.floor(pointX - radiusX));
    const endX = Math.min(width - 1, Math.ceil(pointX + radiusX));
    const startY = Math.max(0, Math.floor(pointY - radiusY));
    const endY = Math.min(height - 1, Math.ceil(pointY + radiusY));

    for (let y = startY; y <= endY; y += 1) {
      const lat = maxLat - (y / Math.max(1, height - 1)) * latSpan;
      const dy = lat - point.lat;

      for (let x = startX; x <= endX; x += 1) {
        const lng = minLng + (x / Math.max(1, width - 1)) * lngSpan;
        const dx = (lng - point.lng) * cosLat;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > radiusSq) continue;

        const weight = Math.exp(-distanceSq / sigmaSq2);
        const pixelIndex = y * width + x;
        scoreTotals[pixelIndex] += point.score * weight;
        weightTotals[pixelIndex] += weight;
      }
    }
  }

  const image = context.createImageData(width, height);
  for (let pixelIndex = 0; pixelIndex < weightTotals.length; pixelIndex += 1) {
    const weight = weightTotals[pixelIndex];
    if (weight < 0.015) continue;

    const score = scoreTotals[pixelIndex] / weight;
    const [red, green, blue] = colorForAvailabilitySurfaceScore(score);
    const dataIndex = pixelIndex * 4;
    image.data[dataIndex] = red;
    image.data[dataIndex + 1] = green;
    image.data[dataIndex + 2] = blue;
    image.data[dataIndex + 3] = Math.round(clamp(weight / 0.8, 0, 1) * 196);
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function featureCollection(features: any[]) {
  return {
    type: "FeatureCollection",
    features,
  };
}

const MALAWI_MASK_DATA = buildMalawiMask(malawiBoundary);
const MALAWI_BORDER_DATA = malawiBoundary as any;

function projectToFallbackMap([lng, lat]: [number, number]) {
  const [[minLng, minLat], [maxLng, maxLat]] = MALAWI_BOUNDS;
  return {
    x: clamp(((lng - minLng) / (maxLng - minLng)) * 100, 0, 100),
    y: clamp((1 - (lat - minLat) / (maxLat - minLat)) * 100, 0, 100),
  };
}

function fallbackBoundaryPaths(boundary: any) {
  return boundaryExteriorRings(boundary)
    .map((ring: any) =>
      ring
        .map((coordinate: [number, number], index: number) => {
          const point = projectToFallbackMap(coordinate);
          return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
        })
        .join(" "),
    )
    .filter(Boolean);
}

const FALLBACK_BOUNDARY_PATHS = fallbackBoundaryPaths(malawiBoundary);

function FallbackStationMap({
  points,
}: {
  points: Array<ReturnType<typeof normalizeHeatmapPoint> & Record<string, any>>;
}) {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden bg-[var(--mera-map-bg)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(216,210,199,0.14),rgba(36,36,33,0)_62%)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {FALLBACK_BOUNDARY_PATHS.map((path, index) => (
          <path
            key={`${path}-${index}`}
            d={`${path} Z`}
            fill="rgba(42, 42, 38, 0.82)"
            stroke="rgba(216, 210, 199, 0.74)"
            strokeWidth="0.7"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {points.map((point, index) => {
        const position = projectToFallbackMap(point.coordinates);
        const size = clamp(8 + point.riskScore / 12, 9, 18);
        return (
          <div
            key={point.id || `${point.name}-${index}`}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
          >
            <div
              className="rounded-full border border-white/90 shadow-none"
              style={{ width: size, height: size, backgroundColor: point.color }}
            />
            <div className="pointer-events-none absolute left-1/2 top-full mt-2 hidden min-w-[150px] -translate-x-1/2 rounded-md border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-2 py-1.5 text-[10px] font-medium text-[var(--mera-panel-text-muted)] shadow-xl group-hover:block">
              <div className="truncate text-[var(--mera-panel-text)]">{point.name}</div>
              <div className="mt-0.5 text-[var(--mera-panel-text-muted)]">{point.district} - Risk {point.riskScore}</div>
            </div>
          </div>
        );
      })}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--mera-map-bg)] to-transparent" />
    </div>
  );
}

function formatPopupInteger(value: any, fallback = "0") {
  const parsed = number(value, NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed).toLocaleString();
}

function formatPopupLitres(value: any) {
  const parsed = number(value, NaN);
  if (!Number.isFinite(parsed)) return "Unknown";
  return `${Math.round(parsed).toLocaleString()} L`;
}

function formatPopupFuelOnHand(properties: any) {
  const live = number(properties.totalLiveLitres, NaN);
  const capacity = number(properties.totalCapacityLitres, NaN);
  if (!Number.isFinite(live) && !Number.isFinite(capacity)) return "Unknown";
  if (Number.isFinite(live) && Number.isFinite(capacity) && capacity > 0) {
    const percent = Math.round((live / capacity) * 100);
    return `${Math.round(live).toLocaleString()} L / ${Math.round(capacity).toLocaleString()} L (${percent}%)`;
  }
  if (Number.isFinite(live)) return formatPopupLitres(live);
  return `Capacity ${formatPopupLitres(capacity)}`;
}

function formatPopupDate(value: any) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPopupBoolean(value: any) {
  return truthy(value) ? "Yes" : "No";
}

function popupHtml(properties: any) {
  return `
    <div class="mera-heatmap-popup-content">
      <strong>${escapeHtml(properties.name)}</strong>
      <span>${escapeHtml(properties.district)}</span>
      <dl>
        <div><dt>Owner/OMC</dt><dd>${escapeHtml(properties.owner)}</dd></div>
        <div><dt>Availability</dt><dd>${escapeHtml(properties.availability)}</dd></div>
        <div><dt>Petrol</dt><dd>${escapeHtml(properties.petrol)}</dd></div>
        <div><dt>Diesel</dt><dd>${escapeHtml(properties.diesel)}</dd></div>
        <div><dt>Queue</dt><dd>${escapeHtml(formatPopupInteger(properties.queueLength))} vehicles</dd></div>
        <div><dt>Avg Wait</dt><dd>${escapeHtml(formatPopupInteger(properties.averageWaitTime))} min</dd></div>
        <div><dt>Open Complaints</dt><dd>${escapeHtml(formatPopupInteger(properties.openCases))}</dd></div>
        <div><dt>Active Flags</dt><dd>${escapeHtml(formatPopupInteger(properties.openFlags))}${properties.maxFlagSeverity ? ` (${escapeHtml(properties.maxFlagSeverity)})` : ""}</dd></div>
        <div><dt>Fuel On Hand</dt><dd>${escapeHtml(formatPopupFuelOnHand(properties))}</dd></div>
        <div><dt>Delivery Verified</dt><dd>${escapeHtml(formatPopupBoolean(properties.deliveryVerified))}</dd></div>
        <div><dt>Latest Delivery</dt><dd>${escapeHtml(formatPopupDate(properties.latestDeliveryTime))}</dd></div>
        <div><dt>Last Status Update</dt><dd>${escapeHtml(formatPopupDate(properties.lastUpdate))}</dd></div>
      </dl>
      <div class="mera-heatmap-popup-actions">
        <a href="/stations/${encodeURIComponent(properties.id || "")}">View Station</a>
        <a href="/compliance-flags?station=${encodeURIComponent(properties.id || "")}">Open Case</a>
        <a href="/field-inspections?station=${encodeURIComponent(properties.id || "")}">Assign Inspection</a>
      </div>
    </div>
  `;
}

function fitMapToPoints(
  map: any,
  points: Array<{ coordinates: [number, number] }>,
) {
  if (!points.length) {
    map.flyTo({ center: MALAWI_CENTER, zoom: MALAWI_EMPTY_ZOOM, duration: 500 });
    return;
  }

  const lngs = points.map((point) => point.coordinates[0]);
  const lats = points.map((point) => point.coordinates[1]);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];

  map.fitBounds(bounds, {
    maxZoom: points.length === 1 ? 9.4 : 8.35,
    padding: { top: 64, right: 42, bottom: 42, left: 42 },
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
  const mapReadyRef = useRef(false);
  const hasFitBoundsRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activeLayer, setActiveLayer] = useState<(typeof layerOptions)[number][0]>("availability");

  const points = useMemo(
    () =>
      rows.map((row, index) => normalizeHeatmapPoint(row, index, activeLayer)).filter(Boolean) as Array<
        ReturnType<typeof normalizeHeatmapPoint> & Record<string, any>
      >,
    [activeLayer, rows],
  );

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
            owner: point.owner,
            queueLength: point.queueLength,
            averageWaitTime: point.averageWaitTime,
            riskScore: point.riskScore,
            openCases: point.openCases,
            openFlags: point.openFlags,
            maxFlagSeverity: point.maxFlagSeverity,
            latestDeliveryTime: point.latestDeliveryTime,
            deliveryVerified: point.deliveryVerified,
            deliveredLitresSinceBaseline: point.deliveredLitresSinceBaseline,
            totalLiveLitres: point.totalLiveLitres,
            totalCapacityLitres: point.totalCapacityLitres,
            lastUpdate: point.lastUpdate,
            markerStatus: point.markerStatus,
            availabilityCategory: point.availabilityCategory,
            availabilityScore: point.availabilityScore,
            shortageContribution: point.shortageContribution,
            activeWeight: point.activeWeight,
            color: point.color,
          },
        })),
      ),
    [points],
  );

  const availabilitySurfaceUrl = useMemo(
    () => buildAvailabilitySurfaceImage(points),
    [points],
  );

  useEffect(() => {
    mapReadyRef.current = false;
    setMapReady(false);
    setLoadError("");

    if (!mapNode.current || mapRef.current) return undefined;

    if (!MAPBOX_TOKEN) {
      setLoadError("Missing VITE_MAPBOX_TOKEN. Showing fallback station map.");
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
          zoom: MALAWI_DEFAULT_ZOOM,
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

            map.addSource(AVAILABILITY_SURFACE_SOURCE_ID, {
              type: "image",
              url: TRANSPARENT_IMAGE_URL,
              coordinates: AVAILABILITY_SURFACE_COORDINATES,
            });

            map.addLayer({
              id: AVAILABILITY_SURFACE_LAYER_ID,
              type: "raster",
              source: AVAILABILITY_SURFACE_SOURCE_ID,
              paint: {
                "raster-opacity": 0.92,
                "raster-fade-duration": 250,
              },
            });

            map.addLayer({
              id: HEAT_LAYER_ID,
              type: "heatmap",
              source: SOURCE_ID,
              filter: ["has", "activeWeight"],
              paint: {
                "heatmap-weight": [
                  "interpolate",
                  ["linear"],
                  ["get", "activeWeight"],
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
                  "rgba(239,68,68,0)",
                  0.18,
                  "rgba(239,68,68,0.26)",
                  0.42,
                  "rgba(239,68,68,0.54)",
                  0.68,
                  "rgba(220,38,38,0.78)",
                  1,
                  "rgba(153,27,27,0.96)",
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
              "fill-color": "rgb(32,32,30)",
              "fill-opacity": 0.94,
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
                ["get", "availabilityCategory"],
                "available",
                availabilityColor.available,
                "moderate",
                availabilityColor.moderate,
                "low",
                availabilityColor.low,
                "critical",
                availabilityColor.critical,
                "dry",
                availabilityColor.dry,
                availabilityColor.no_data,
              ],
              "circle-opacity": 0.95,
              "circle-stroke-color": "rgb(255,255,255)",
              "circle-stroke-width": 1.6,
              "circle-stroke-opacity": 0.95,
            },
          });

          map.addLayer({
            id: BORDER_LAYER_ID,
            type: "line",
            source: BORDER_SOURCE_ID,
            paint: {
              "line-color": "rgb(216,210,199)",
              "line-opacity": 0.82,
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

          mapReadyRef.current = true;
          setMapReady(true);
          setLoadError("");
          if (loadTimeoutRef.current) {
            window.clearTimeout(loadTimeoutRef.current);
            loadTimeoutRef.current = null;
          }
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
          if (cancelled || mapReadyRef.current || map.isStyleLoaded()) return;
          setLoadError(
            "Mapbox did not finish loading. Showing fallback station map.",
          );
        }, LOAD_TIMEOUT_MS);
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(error?.message || "Unable to load Mapbox GL resources.");
      });

    return () => {
      cancelled = true;
      if (loadTimeoutRef.current) window.clearTimeout(loadTimeoutRef.current);
      mapReadyRef.current = false;
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

    const map = mapRef.current;
    const source = map.getSource(SOURCE_ID);
    if (source?.setData) source.setData(data);
    const availabilitySurfaceSource = map.getSource(AVAILABILITY_SURFACE_SOURCE_ID);
    if (availabilitySurfaceSource?.updateImage) {
      availabilitySurfaceSource.updateImage({
        url: availabilitySurfaceUrl || TRANSPARENT_IMAGE_URL,
        coordinates: AVAILABILITY_SURFACE_COORDINATES,
      });
    }

    const availabilityMode = activeLayer === "availability";
    if (map.getLayer(AVAILABILITY_SURFACE_LAYER_ID)) {
      map.setLayoutProperty(
        AVAILABILITY_SURFACE_LAYER_ID,
        "visibility",
        availabilityMode ? "visible" : "none",
      );
    }
    if (map.getLayer(HEAT_LAYER_ID)) {
      map.setLayoutProperty(
        HEAT_LAYER_ID,
        "visibility",
        availabilityMode ? "none" : "visible",
      );
    }

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
  }, [activeLayer, availabilitySurfaceUrl, data, mapReady, points]);

  const showFallbackMap = Boolean(loadError) && !mapReady && points.length > 0;
  const legendMode = activeLayer === "availability"
    ? "availability"
    : activeLayer === "stockRisk"
      ? "stockRisk"
      : "status";

  return (
    <section
      className={`relative h-[360px] min-h-[360px] w-full overflow-hidden rounded-md border border-[var(--mera-panel-border)] bg-[var(--mera-map-bg)] text-[var(--mera-panel-text)] shadow-none ${className}`}
      style={{ minHeight: 360 }}
    >
      {showFallbackMap ? <FallbackStationMap points={points} /> : null}
      <div
        ref={mapNode}
        className={`mera-mapbox-surface absolute inset-0 z-0 h-full min-h-[360px] w-full bg-[var(--mera-map-bg)] ${showFallbackMap ? "pointer-events-none opacity-0" : ""}`}
        style={{ width: "100%", height: "100%", minHeight: 360 }}
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(180deg,rgba(32,32,30,0.04),rgba(32,32,30,0.18))]" />

      <div className="absolute left-4 top-4 z-10 flex items-center gap-3">
        <h2 className="text-[14px] font-medium uppercase tracking-normal">
          {title}
        </h2>
        <span className="inline-flex h-5 items-center gap-1.5 rounded-md border border-[#e2e8f0] bg-[#ecfdf5] px-2 text-[9px] font-medium text-[#059669] shadow-sm">
          <span className="size-2 rounded-full bg-accent-secondary" />
          Live
        </span>
      </div>

      <div className="absolute left-4 top-[48px] z-10 w-[138px] rounded-md border border-[var(--mera-panel-border)] bg-[var(--mera-panel)]/95 p-2.5 shadow-xl backdrop-blur">
        <div className="mb-2 text-[10px] font-medium text-[var(--mera-panel-text)]">
          {legendMode === "availability" ? "Fuel Availability" : legendMode === "stockRisk" ? "Stock Depletion" : "Station Status"}
        </div>
        {legendMode === "stockRisk" ? (
          <div>
            <div className="h-3 rounded-full border border-white/20 bg-[linear-gradient(90deg,rgba(239,68,68,0.12),rgba(239,68,68,0.96))]" />
            <div className="mt-1.5 flex items-center justify-between text-[9px] font-medium text-[var(--mera-panel-text-muted)]">
              <span>Low</span>
              <span>Severe</span>
            </div>
          </div>
        ) : (
          (legendMode === "availability" ? availabilityLegend : statusLegend).map(([key, label, color]) => (
            <div
              key={key}
              className="mb-1.5 flex items-center gap-2 text-[9px] font-medium text-[var(--mera-panel-text-muted)] last:mb-0"
            >
              <span
                className="size-3 rounded-full ring-1 ring-white/40"
                style={{ backgroundColor: color }}
              />
              {label}
            </div>
          ))
        )}
      </div>

      <div className="absolute right-3 top-3 z-10 w-[220px] rounded-md border border-[var(--mera-panel-border)] bg-[var(--mera-panel)]/95 p-2.5 shadow-xl backdrop-blur">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[var(--mera-panel-text)]">
          <Layers3 className="size-3.5" />
          Map Layers
        </div>
        <div className="grid max-h-[188px] gap-1 overflow-y-auto pr-1">
          {layerOptions.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveLayer(key)}
              className={`h-7 rounded-md px-2 text-left text-[10px] font-medium transition ${
                activeLayer === key
                  ? "bg-[var(--mera-control-muted)] text-[var(--mera-panel-text)]"
                  : "text-[var(--mera-panel-text-muted)] hover:bg-[var(--mera-control-muted)] hover:text-[var(--mera-panel-text)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute right-3 bottom-3 z-10 overflow-hidden rounded-md border border-[var(--mera-panel-border)] bg-[var(--mera-panel)]/95 shadow-xl backdrop-blur">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn({ duration: 220 })}
          disabled={!mapReady}
          className="grid size-8 place-items-center text-[var(--mera-panel-text)] transition hover:bg-[var(--mera-control-muted)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Zoom in"
        >
          <ZoomIn className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut({ duration: 220 })}
          disabled={!mapReady}
          className="grid size-8 place-items-center border-y border-[var(--mera-panel-border)] text-[var(--mera-panel-text)] transition hover:bg-[var(--mera-control-muted)] disabled:cursor-not-allowed disabled:opacity-40"
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
          className="grid size-8 place-items-center text-[var(--mera-panel-text)] transition hover:bg-[var(--mera-control-muted)] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Recenter"
        >
          <Gauge className="size-5" />
        </button>
      </div>
    </section>
  );
}
