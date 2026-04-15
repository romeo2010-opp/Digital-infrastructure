const defaultTabs = [
  { id: "INVENTORY", label: "Reconciliation" },
  { id: "SALES", label: "Sales" },
  { id: "PUMPS", label: "Pumps" },
  { id: "QUEUE", label: "Queue" },
  { id: "SETTLEMENTS", label: "Settlements" },
  { id: "DEMAND", label: "Demand Anomalies" },
  { id: "EXCEPTIONS", label: "Exceptions & Audit" },
]

export default function ReportsTabs({ activeTab, onChange, tabs = defaultTabs }) {
  return (
    <nav className="reports-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeTab === tab.id ? "active" : ""}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
