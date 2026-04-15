import { ManualFuelOrderSection } from './ManualFuelOrderSection'

export function OrdersScreen() {
  return (
    <div className='wallet-screen orders-screen'>
      <section className='orders-hero-card'>
        <div className='orders-hero-copy'>
          <span className='wallet-screen-eyebrow'>Orders</span>
          <h2>Manual fuel orders</h2>
          <p>Create, track, and manage station-ready wallet orders without joining the queue.</p>
        </div>

        <div className='orders-hero-metrics'>
          <article className='orders-hero-metric'>
            <span>Purpose</span>
            <strong>Wallet payment first</strong>
            <p>Your order stays separate from queue and reservation access.</p>
          </article>
          <article className='orders-hero-metric'>
            <span>Station flow</span>
            <strong>Attach at the pump</strong>
            <p>Attendants can link your order when you physically reach the forecourt.</p>
          </article>
        </div>
      </section>

      <section className='orders-guidance-card'>
        <div className='orders-guidance-head'>
          <div>
            <span className='orders-guidance-eyebrow'>How it works</span>
            <h3>Track service readiness from one place</h3>
          </div>
        </div>

        <div className='orders-guidance-grid'>
          <article className='orders-guidance-step'>
            <strong>1. Create order</strong>
            <p>Select station, fuel type, and amount or litres using wallet payment.</p>
          </article>
          <article className='orders-guidance-step'>
            <strong>2. Arrive at station</strong>
            <p>SmartLink updates your status as station proximity is detected.</p>
          </article>
          <article className='orders-guidance-step'>
            <strong>3. Finalize after service</strong>
            <p>Wallet capture completes only after actual dispensing is confirmed.</p>
          </article>
        </div>
      </section>

      <ManualFuelOrderSection />
    </div>
  )
}
