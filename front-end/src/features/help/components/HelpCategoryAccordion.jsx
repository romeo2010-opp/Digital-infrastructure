import { Link } from "react-router-dom"

function HelpItem({ item }) {
  return (
    <article className="help-v1-item">
      <h5>{item.title}</h5>
      <p><strong>Symptoms:</strong> {item.symptoms}</p>
      <div>
        <strong>Steps to resolve:</strong>
        <ul>
          {item.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
      {item.linksToRoutes?.length ? (
        <div className="help-v1-links">
          {item.linksToRoutes.map((route) => (
            <Link key={`${item.id}-${route.to}`} to={route.to}>
              {route.label}
            </Link>
          ))}
        </div>
      ) : null}
      <p className="help-v1-escalate">{item.escalateText}</p>
    </article>
  )
}

export default function HelpCategoryAccordion({ categories }) {
  if (!categories.length) {
    return (
      <section className="help-v1-panel">
        <h3>Common Problems & Fixes</h3>
        <p className="help-v1-empty">No matching help topics for this search.</p>
      </section>
    )
  }

  return (
    <section className="help-v1-panel">
      <h3>Common Problems & Fixes</h3>
      <div className="help-v1-accordion">
        {categories.map((category, index) => (
          <details key={category.key} open={index === 0}>
            <summary>{category.title}</summary>
            <div className="help-v1-items">
              {category.items.map((item) => (
                <HelpItem key={item.id} item={item} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
