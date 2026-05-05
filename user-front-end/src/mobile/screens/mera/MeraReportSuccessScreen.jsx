export function MeraReportSuccessScreen({ result, onDone, onReportAnother }) {
  return (
    <section className='mera-report-screen'>
      <header className='screen-header'>
        <h2>Complaint Sent</h2>
      </header>

      <section className='station-card mera-report-success'>
        <strong>Report submitted successfully</strong>
        <p>
          MERA has received your complaint and can use your station, evidence, and location details for
          follow-up.
        </p>
        <dl className='mera-report-receipt'>
          <div>
            <dt>Reference</dt>
            <dd>{result?.complaintPublicId || 'Pending'}</dd>
          </div>
          <div>
            <dt>Station</dt>
            <dd>{result?.station?.name || 'Submitted'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{result?.complaintStatus || 'NEW'}</dd>
          </div>
        </dl>
        <button type='button' className='primary-button' onClick={() => onDone?.()}>
          Back to More
        </button>
        <button type='button' className='secondary-button' onClick={() => onReportAnother?.()}>
          Submit another report
        </button>
      </section>
    </section>
  )
}
