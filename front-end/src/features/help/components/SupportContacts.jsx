export default function SupportContacts({ config }) {
  const phoneHref = config?.phone ? `tel:${String(config.phone).replace(/\s+/g, "")}` : ""
  const whatsappHref = config?.whatsapp
    ? `https://wa.me/${String(config.whatsapp).replace(/[^\d]/g, "")}`
    : ""
  const emailHref = config?.email ? `mailto:${config.email}` : ""

  return (
    <section className="help-v1-panel">
      <h3>Contact Support</h3>
      <div className="help-v1-contact-grid">
        <article>
          <small>Phone</small>
          {phoneHref ? <a href={phoneHref}>{config.phone}</a> : <p>Not configured</p>}
        </article>
        <article>
          <small>WhatsApp</small>
          {whatsappHref ? (
            <a href={whatsappHref} target="_blank" rel="noreferrer">
              {config.whatsapp}
            </a>
          ) : (
            <p>Not configured</p>
          )}
        </article>
        <article>
          <small>Email</small>
          {emailHref ? <a href={emailHref}>{config.email}</a> : <p>Not configured</p>}
        </article>
        <article>
          <small>Support Hours</small>
          <p>{config?.hours || "Not configured"}</p>
        </article>
      </div>
    </section>
  )
}
