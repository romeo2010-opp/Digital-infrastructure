export default function QuickHelpActions({
  supportConfig,
  offlineState,
  onOpenReportIssue,
  onViewOfflineProcedure,
  onRetrySync,
}) {
  const phoneHref = supportConfig?.phone
    ? `tel:${String(supportConfig.phone).replace(/\s+/g, "")}`
    : null;
  const whatsappHref = supportConfig?.whatsapp
    ? `https://wa.me/${String(supportConfig.whatsapp).replace(/[^\d]/g, "")}`
    : null;

  return (
    <section className="help-v1-panel help-v1-quick">
      <div className="help-v1-quick-head">
        <h3>Quick Help</h3>
        <div className="help-v1-status-chip" role="status" aria-live="polite">
          <strong
            className={offlineState.network === "ONLINE" ? "online" : "offline"}
          >
            {offlineState.sync === "SYNCING" ? "SYNCING" : offlineState.network}
          </strong>
          <span>Pending {offlineState.pendingCount}</span>
        </div>
      </div>

      <div className="help-v1-quick-actions">
        <button type="button" onClick={onOpenReportIssue}>
          Report an Issue
        </button>
        {phoneHref ? (
          <a href={phoneHref} className="help-v1-link-btn">
            Call Support
          </a>
        ) : null}
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className="help-v1-link-btn"
          >
            WhatsApp Support
          </a>
        ) : null}
        <button type="button" onClick={onRetrySync}>
          Retry Sync
        </button>
        <button type="button" onClick={onViewOfflineProcedure}>
          View Offline Procedure
        </button>
      </div>
    </section>
  );
}
