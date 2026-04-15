export default function HelpSearchBar({ value, onChange }) {
  return (
    <section className="help-v1-panel">
      <label className="help-v1-search">
        <span>Search help topics and scenarios</span>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Try: offline, pump offline, report mismatch..."
        />
      </label>
    </section>
  )
}
