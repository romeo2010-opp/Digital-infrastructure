import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

export default function ScenarioCards({ scenarios }) {
  const [activeId, setActiveId] = useState("")
  const activeScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === activeId) || null,
    [scenarios, activeId]
  )

  return (
    <section className="help-v1-panel">
      <h3>What to do when...</h3>
      {scenarios.length ? (
        <div className="help-v1-scenarios">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              className="help-v1-scenario-card"
              onClick={() => setActiveId(scenario.id)}
            >
              {scenario.title}
            </button>
          ))}
        </div>
      ) : (
        <p className="help-v1-empty">No matching scenarios for this search.</p>
      )}

      {activeScenario ? (
        <div className="help-v1-modal-backdrop" onClick={() => setActiveId("")}>
          <aside className="help-v1-modal help-v1-drawer" onClick={(event) => event.stopPropagation()}>
            <header>
              <h4>{activeScenario.title}</h4>
              <button type="button" onClick={() => setActiveId("")}>
                Close
              </button>
            </header>
            <div className="help-v1-modal-body">
              <strong>Checklist</strong>
              <ul>
                {activeScenario.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {activeScenario.linksToRoutes?.length ? (
                <div className="help-v1-links">
                  {activeScenario.linksToRoutes.map((route) => (
                    <Link key={`${activeScenario.id}-${route.to}`} to={route.to}>
                      {route.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
