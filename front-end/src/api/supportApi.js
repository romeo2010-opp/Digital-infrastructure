import { httpClient } from "./httpClient"
import { defaultSupportConfig } from "../config/supportConfig"

const isApiMode = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase() === "api"

export const supportApi = {
  async getConfig() {
    if (!isApiMode) return defaultSupportConfig
    try {
      const data = await httpClient.get("/api/support/config")
      return {
        ...defaultSupportConfig,
        ...(data || {}),
      }
    } catch {
      return defaultSupportConfig
    }
  },
  async createTicket(payload) {
    if (!isApiMode) {
      return {
        id: `MOCK-${Date.now()}`,
        status: "OPEN",
      }
    }
    return httpClient.post("/api/support/tickets", payload)
  },
  async getTickets() {
    if (!isApiMode) return []
    return httpClient.get("/api/support/tickets")
  },
  async getRefundRequests() {
    if (!isApiMode) return []
    return httpClient.get("/api/support/refunds")
  },
  async getInbox() {
    if (!isApiMode) {
      return {
        stationPublicId: null,
        messages: [],
      }
    }
    return httpClient.get("/api/support/inbox")
  },
  async getTicketMessages(ticketId) {
    const scopedTicketId = String(ticketId || "").trim()
    if (!scopedTicketId) throw new Error("ticketId is required")
    if (!isApiMode) {
      return { ticket: null, messages: [] }
    }
    return httpClient.get(`/api/support/tickets/${encodeURIComponent(scopedTicketId)}/messages`)
  },
  async sendTicketMessage(ticketId, message) {
    const scopedTicketId = String(ticketId || "").trim()
    const scopedMessage = String(message || "").trim()
    if (!scopedTicketId) throw new Error("ticketId is required")
    if (!scopedMessage) throw new Error("message is required")
    if (!isApiMode) {
      return {
        sent: true,
        thread: { ticket: null, messages: [] },
      }
    }
    return httpClient.post(`/api/support/tickets/${encodeURIComponent(scopedTicketId)}/messages`, {
      message: scopedMessage,
    })
  },
}
