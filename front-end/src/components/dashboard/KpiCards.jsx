import { useCallback, useEffect, useMemo, useState } from "react";
import { reportsData } from "../../config/dataSource";
import { useStationChangeWatcher } from "../../hooks/useStationChangeWatcher";
import { utcTodayISO } from "../../utils/dateTime";

const fallbackKpiData = [];
const ACTIVE_PUMP_STATUSES = new Set(["ACTIVE", "IDLE", "DISPENSING"]);

function KpiIcon({ type }) {
  if (type === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m8 12 2.6 2.8L16 9.5" />
      </svg>
    );
  }

  if (type === "alert") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v5" />
        <circle cx="12" cy="17" r="1" />
      </svg>
    );
  }

  if (type === "wallet") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <circle cx="16" cy="14" r="1" />
      </svg>
    );
  }

  if (type === "car") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13h14l-1.2-4H6.2L5 13Z" />
        <circle cx="8" cy="16.5" r="1.5" />
        <circle cx="16" cy="16.5" r="1.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h6" />
    </svg>
  );
}

export default function KpiCards({ snapshot: initialSnapshot = null }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot);
    }
  }, [initialSnapshot]);

  const loadKpis = useCallback(async () => {
    if (initialSnapshot) return;
    const today = utcTodayISO();
    const filters = {
      preset: "TODAY",
      fromDate: today,
      toDate: today,
      shift: "ALL",
      fuelType: "ALL",
      pumpId: "ALL",
    };

    try {
      const next = await reportsData.getReportSnapshot(filters);
      setSnapshot(next);
    } catch (_error) {
      setSnapshot(null);
    }
  }, [initialSnapshot]);

  useEffect(() => {
    if (initialSnapshot) return;
    loadKpis();
  }, [initialSnapshot, loadKpis]);

  useStationChangeWatcher({
    enabled: !initialSnapshot,
    onChange: async () => {
      await loadKpis();
    },
  });

  const kpiData = useMemo(() => {
    if (!snapshot) return fallbackKpiData;

    const activePumps = (snapshot.pumps || []).filter((pump) =>
      ACTIVE_PUMP_STATUSES.has(String(pump.status).toUpperCase()),
    ).length;
    const inactivePumps = (snapshot.pumps || []).filter(
      (pump) => !ACTIVE_PUMP_STATUSES.has(String(pump.status).toUpperCase()),
    ).length;
    const anomalies = (snapshot.incidents || []).filter(
      (item) => String(item.status).toUpperCase() === "OPEN",
    ).length;

    return [
      {
        icon: "fuel",
        value: Number(snapshot.kpis?.totalLitres || 0).toLocaleString(),
        unit: "Liters Today",
        label: "Sold Today",
        tone: "blue",
      },
      {
        icon: "wallet",
        value: `MWK ${Number(snapshot.kpis?.revenue || 0).toLocaleString()}`,
        unit: "",
        label: "Revenue Today",
        tone: "green",
      },
      {
        icon: "check",
        value: String(activePumps),
        unit: "",
        label: "Active Pumps",
        tone: "teal",
      },
      {
        icon: "car",
        value: String(inactivePumps),
        unit: "",
        label: "Inactive Pumps",
        tone: "indigo",
      },
      {
        icon: "alert",
        value: String(anomalies),
        unit: "",
        label: "Anomalies",
        tone: "red",
      },
    ];
  }, [snapshot]);

  return (
    <section className="kpi-row">
      {kpiData.map((item) => (
        <article key={`${item.label}-${item.value}`} className="kpi-card">
          <div className={`kpi-icon ${item.tone}`}>
            <KpiIcon type={item.icon} />
          </div>
          <div className="kpi-copy">
            <div className="kpi-value">
              {item.value}
              {item.unit ? <span>{item.unit}</span> : null}
            </div>
            <p>{item.label}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
