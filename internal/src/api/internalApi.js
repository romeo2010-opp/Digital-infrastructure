import { httpClient } from "./httpClient"

function withQuery(path, params = {}) {
  const query = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return
    query.set(key, String(value))
  })
  const suffix = query.toString()
  return suffix ? `${path}?${suffix}` : path
}

export const internalApi = {
  getOverview: () => httpClient.get("/api/internal/overview"),
  getChatBootstrap: () => httpClient.get("/api/internal/chat/bootstrap"),
  ensureDirectChatRoom: (peerUserPublicId) => httpClient.post("/api/internal/chat/direct-rooms", { peerUserPublicId }),
  getChatRoomMessages: (roomPublicId, limit = 80) => httpClient.get(`/api/internal/chat/rooms/${roomPublicId}/messages?limit=${limit}`),
  sendChatMessage: (roomPublicId, payload) => {
    if (payload?.attachmentFile) {
      const formData = new FormData()
      if (payload.body) formData.set("body", payload.body)
      if (payload.replyToMessagePublicId) formData.set("replyToMessagePublicId", payload.replyToMessagePublicId)
      formData.set("attachmentFile", payload.attachmentFile)
      return httpClient.postForm(`/api/internal/chat/rooms/${roomPublicId}/messages`, formData)
    }
    return httpClient.post(`/api/internal/chat/rooms/${roomPublicId}/messages`, payload)
  },
  editChatMessage: (roomPublicId, messagePublicId, body) =>
    httpClient.patch(`/api/internal/chat/rooms/${roomPublicId}/messages/${messagePublicId}`, { body }),
  deleteChatMessage: (roomPublicId, messagePublicId) =>
    httpClient.delete(`/api/internal/chat/rooms/${roomPublicId}/messages/${messagePublicId}`),
  pinChatMessage: (roomPublicId, messagePublicId) =>
    httpClient.post(`/api/internal/chat/rooms/${roomPublicId}/messages/${messagePublicId}/pin`, {}),
  unpinChatMessage: (roomPublicId, messagePublicId) =>
    httpClient.post(`/api/internal/chat/rooms/${roomPublicId}/messages/${messagePublicId}/unpin`, {}),
  downloadChatDocument: (messagePublicId) => httpClient.getBlob(`/api/internal/chat/messages/${messagePublicId}/document`),
  getNetworkOperations: () => httpClient.get("/api/internal/network-operations"),
  acknowledgeOperationalAlert: (alertPublicId) => httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/acknowledge`, {}),
  markOperationalIncidentUnderReview: (alertPublicId) => httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/under-review`, {}),
  resolveOperationalIncident: (alertPublicId) => httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/resolve`, {}),
  reopenOperationalIncident: (alertPublicId) => httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/reopen`, {}),
  escalateOperationalIncident: (alertPublicId) => httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/escalate`, {}),
  assignOperationalIncident: (alertPublicId, ownerRoleCode) =>
    httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/assign`, { ownerRoleCode }),
  addOperationalIncidentNote: (alertPublicId, note) =>
    httpClient.post(`/api/internal/network-operations/incidents/${alertPublicId}/note`, { note }),
  markStationNeedsReview: (stationPublicId) => httpClient.post(`/api/internal/network-operations/stations/${stationPublicId}/needs-review`, {}),
  requestNetworkFieldVisit: (stationPublicId, note) =>
    httpClient.post(`/api/internal/network-operations/stations/${stationPublicId}/request-field-visit`, { note }),
  requestTechnicalInvestigation: (stationPublicId, note = "") =>
    httpClient.post(`/api/internal/network-operations/stations/${stationPublicId}/request-technical-investigation`, note ? { note } : {}),
  getStations: () => httpClient.get("/api/internal/stations"),
  createStation: (payload) => httpClient.post("/api/internal/stations", payload),
  getStationSetup: (stationPublicId) => httpClient.get(`/api/internal/stations/${stationPublicId}/setup`),
  updateStationProfile: (stationPublicId, payload) => httpClient.patch(`/api/internal/stations/${stationPublicId}/profile`, payload),
  submitStationForReview: (stationPublicId) => httpClient.post(`/api/internal/stations/${stationPublicId}/submit-review`, {}),
  updateStationSubscription: (stationPublicId, payload) => httpClient.patch(`/api/internal/stations/${stationPublicId}/subscription`, payload),
  assignStationStaff: (stationPublicId, payload) => httpClient.post(`/api/internal/stations/${stationPublicId}/staff`, payload),
  searchStationManagerCandidates: (stationPublicId, params = {}) =>
    httpClient.get(withQuery(`/api/internal/stations/${stationPublicId}/staff/manager-candidates`, params)),
  patchStationStaff: (stationPublicId, staffId, payload) => httpClient.patch(`/api/internal/stations/${stationPublicId}/staff/${staffId}`, payload),
  deleteStationStaff: (stationPublicId, staffId) => httpClient.delete(`/api/internal/stations/${stationPublicId}/staff/${staffId}`),
  resetStationStaffAccess: (stationPublicId, staffId) => httpClient.post(`/api/internal/stations/${stationPublicId}/staff/${staffId}/reset-access`, {}),
  createStationTank: (stationPublicId, payload) => httpClient.post(`/api/internal/stations/${stationPublicId}/tanks`, payload),
  patchStationTank: (stationPublicId, tankPublicId, payload) => httpClient.patch(`/api/internal/stations/${stationPublicId}/tanks/${tankPublicId}`, payload),
  createStationPump: (stationPublicId, payload) => httpClient.post(`/api/internal/stations/${stationPublicId}/pumps`, payload),
  patchStationPump: (stationPublicId, pumpPublicId, payload) => httpClient.patch(`/api/internal/stations/${stationPublicId}/pumps/${pumpPublicId}`, payload),
  deleteStationPump: (stationPublicId, pumpPublicId) => httpClient.delete(`/api/internal/stations/${stationPublicId}/pumps/${pumpPublicId}`),
  createStationNozzle: (stationPublicId, pumpPublicId, payload) =>
    httpClient.post(`/api/internal/stations/${stationPublicId}/pumps/${pumpPublicId}/nozzles`, payload),
  patchStationNozzle: (stationPublicId, nozzlePublicId, payload) =>
    httpClient.patch(`/api/internal/stations/${stationPublicId}/nozzles/${nozzlePublicId}`, payload),
  deleteStationNozzle: (stationPublicId, nozzlePublicId) => httpClient.delete(`/api/internal/stations/${stationPublicId}/nozzles/${nozzlePublicId}`),
  patchStationActivation: (stationPublicId, isActive) =>
    httpClient.patch(`/api/internal/stations/${stationPublicId}/activation`, { isActive }),
  requestStationDeletion: (stationPublicId) => httpClient.post(`/api/internal/stations/${stationPublicId}/delete-request`, {}),
  getStationDeactivationRequests: () => httpClient.get("/api/internal/stations/deactivation-requests"),
  decideStationDeactivationRequest: (requestPublicId, decision) =>
    httpClient.post(`/api/internal/stations/deactivation-requests/${requestPublicId}/decision`, { decision }),
  getOnboarding: () => httpClient.get("/api/internal/station-onboarding"),
  updateOnboardingWorkflow: (onboardingPublicId, action) =>
    httpClient.post(`/api/internal/station-onboarding/${onboardingPublicId}/action`, { action }),
  getFieldOperations: () => httpClient.get("/api/internal/field-operations"),
  createFieldSetupRequest: (payload) => httpClient.post("/api/internal/field-operations/setup-requests", payload),
  getFieldStationSetup: (stationPublicId) => httpClient.get(`/api/internal/field-operations/stations/${stationPublicId}/setup`),
  updateFieldVisitWorkflow: (fieldVisitPublicId, payload) =>
    httpClient.post(`/api/internal/field-operations/visits/${fieldVisitPublicId}/action`, payload),
  assignFieldStationStaff: (stationPublicId, payload) =>
    httpClient.post(`/api/internal/field-operations/stations/${stationPublicId}/staff`, payload),
  searchFieldStationManagerCandidates: (stationPublicId, params = {}) =>
    httpClient.get(withQuery(`/api/internal/field-operations/stations/${stationPublicId}/staff/manager-candidates`, params)),
  patchFieldStationStaff: (stationPublicId, staffId, payload) =>
    httpClient.patch(`/api/internal/field-operations/stations/${stationPublicId}/staff/${staffId}`, payload),
  deleteFieldStationStaff: (stationPublicId, staffId) =>
    httpClient.delete(`/api/internal/field-operations/stations/${stationPublicId}/staff/${staffId}`),
  resetFieldStationStaffAccess: (stationPublicId, staffId) =>
    httpClient.post(`/api/internal/field-operations/stations/${stationPublicId}/staff/${staffId}/reset-access`, {}),
  createFieldStationPump: (stationPublicId, payload) =>
    httpClient.post(`/api/internal/field-operations/stations/${stationPublicId}/pumps`, payload),
  patchFieldStationPump: (stationPublicId, pumpPublicId, payload) =>
    httpClient.patch(`/api/internal/field-operations/stations/${stationPublicId}/pumps/${pumpPublicId}`, payload),
  createFieldStationNozzle: (stationPublicId, pumpPublicId, payload) =>
    httpClient.post(`/api/internal/field-operations/stations/${stationPublicId}/pumps/${pumpPublicId}/nozzles`, payload),
  patchFieldStationNozzle: (stationPublicId, nozzlePublicId, payload) =>
    httpClient.patch(`/api/internal/field-operations/stations/${stationPublicId}/nozzles/${nozzlePublicId}`, payload),
  getSupport: () => httpClient.get("/api/internal/support"),
  getSupportEscalationRequests: () => httpClient.get("/api/internal/support/escalation-requests"),
  createSupportCase: (payload) => httpClient.post("/api/internal/support/cases", payload),
  getSupportCaseContext: (casePublicId) => httpClient.get(`/api/internal/support/cases/${casePublicId}/context`),
  updateSupportCaseWorkflow: (casePublicId, payload) => httpClient.post(`/api/internal/support/cases/${casePublicId}/action`, payload),
  sendSupportCaseMessage: (casePublicId, message) => httpClient.post(`/api/internal/support/cases/${casePublicId}/messages`, { message }),
  respondSupportCase: (casePublicId, message) => httpClient.post(`/api/internal/support/cases/${casePublicId}/respond`, { message }),
  respondToEscalatedSupportCase: (alertPublicId, message) =>
    httpClient.post(`/api/internal/support/escalation-requests/${alertPublicId}/respond`, { message }),
  resolveSupportCase: (casePublicId) => httpClient.post(`/api/internal/support/cases/${casePublicId}/resolve`, {}),
  escalateSupportCase: (casePublicId) => httpClient.post(`/api/internal/support/cases/${casePublicId}/escalate`, {}),
  approveSupportRefund: (refundPublicId) => httpClient.post(`/api/internal/support/refunds/${refundPublicId}/approve`, {}),
  createSupportRefund: (payload) => httpClient.post("/api/internal/support/refunds", payload),
  rejectSupportRefund: (refundPublicId, reason) => httpClient.post(`/api/internal/support/refunds/${refundPublicId}/reject`, { reason }),
  getRefundInvestigation: (refundPublicId) => httpClient.get(`/api/internal/refunds/${refundPublicId}/investigation`),
  attachRefundEvidence: (refundPublicId, payload) => httpClient.post(`/api/internal/refunds/${refundPublicId}/evidence`, payload),
  getTransactionPumpSession: (transactionPublicId) => httpClient.get(`/api/internal/transactions/${transactionPublicId}/pump-session`),
  getTransactionTelemetry: (transactionPublicId) => httpClient.get(`/api/internal/transactions/${transactionPublicId}/telemetry`),
  getPumpSessionTelemetry: (sessionReference) => httpClient.get(`/api/internal/pump-sessions/${sessionReference}/telemetry`),
  getFinance: () => httpClient.get("/api/internal/finance"),
  createSettlementBatch: (payload) => httpClient.post("/api/internal/finance/settlements", payload),
  flagTransactionForReview: (transactionPublicId, payload) => httpClient.post(`/api/internal/finance/transactions/${transactionPublicId}/review`, payload),
  requestTransactionCancellationReview: (transactionPublicId, payload) =>
    httpClient.post(`/api/internal/finance/transactions/${transactionPublicId}/request-cancellation-review`, payload),
  cancelTransactionFinancialError: (transactionPublicId, payload) =>
    httpClient.post(`/api/internal/finance/transactions/${transactionPublicId}/cancel-financial-error`, payload),
  startFinanceReconciliation: (note = "") => httpClient.post("/api/internal/finance/reconciliation/start", note ? { note } : {}),
  completeFinanceReconciliation: (runPublicId, note = "") => httpClient.post(`/api/internal/finance/reconciliation/${runPublicId}/complete`, note ? { note } : {}),
  raiseFinanceReconciliationException: (runPublicId, payload) => httpClient.post(`/api/internal/finance/reconciliation/${runPublicId}/exceptions`, payload),
  createWalletAdjustmentRequest: (payload) => httpClient.post("/api/internal/finance/wallet-adjustments", payload),
  approveWalletAdjustmentRequest: (requestPublicId, note = "") =>
    httpClient.post(`/api/internal/finance/wallet-adjustments/${requestPublicId}/approve`, note ? { note } : {}),
  markSettlementProcessing: (batchPublicId) => httpClient.post(`/api/internal/finance/settlements/${batchPublicId}/processing`, {}),
  approveSettlement: (batchPublicId) => httpClient.post(`/api/internal/finance/settlements/${batchPublicId}/approve`, {}),
  rejectSettlement: (batchPublicId) => httpClient.post(`/api/internal/finance/settlements/${batchPublicId}/reject`, {}),
  markSettlementPaid: (batchPublicId) => httpClient.post(`/api/internal/finance/settlements/${batchPublicId}/paid`, {}),
  approveFinanceRefund: (refundPublicId, note = "") => httpClient.post(`/api/internal/finance/refunds/${refundPublicId}/approve`, note ? { note } : {}),
  rejectFinanceRefund: (refundPublicId, note = "") => httpClient.post(`/api/internal/finance/refunds/${refundPublicId}/reject`, note ? { note } : {}),
  supportEscalateRefundToCompliance: (refundPublicId, payload = {}) =>
    httpClient.post(`/api/internal/support/refunds/${refundPublicId}/escalate-compliance`, payload),
  escalateRefundToCompliance: (refundPublicId, payload = {}) =>
    httpClient.post(`/api/internal/finance/refunds/${refundPublicId}/escalate-compliance`, payload),
  updateSubscriptionBillingState: (stationPublicId, action) =>
    httpClient.post(`/api/internal/finance/subscriptions/${stationPublicId}/action`, { action }),
  lookupWallet: (displayId) => httpClient.get(withQuery("/api/internal/wallets/lookup", { displayId })),
  getWalletConsole: (walletId) => httpClient.get(`/api/internal/wallets/${walletId}`),
  getWalletTransactions: (walletId, params = {}) => httpClient.get(withQuery(`/api/internal/wallets/${walletId}/transactions`, params)),
  getWalletPointsHistory: (walletId, params = {}) => httpClient.get(withQuery(`/api/internal/wallets/${walletId}/points-history`, params)),
  getWalletAuditLogs: (walletId, params = {}) => httpClient.get(withQuery(`/api/internal/wallets/${walletId}/audit-logs`, params)),
  downloadWalletStatement: (walletId, params = {}) =>
    httpClient.getBlobWithMeta(withQuery(`/api/internal/wallets/${walletId}/statement`, params)),
  createWalletPointsAdjustment: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/points-adjustments`, payload),
  createWalletRefundRequest: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/refund-requests`, payload),
  createWalletCredit: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/wallet-credits`, payload),
  createWalletLedgerAdjustment: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/ledger-adjustments`, payload),
  createWalletBalanceTransfer: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/balance-transfers`, payload),
  freezeWallet: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/freeze`, payload),
  unfreezeWallet: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/unfreeze`, payload),
  markWalletUnderReview: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/mark-under-review`, payload),
  placeWalletHold: (walletId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/holds`, payload),
  releaseWalletHold: (walletId, holdId, payload) => httpClient.post(`/api/internal/wallets/${walletId}/holds/${holdId}/release`, payload),
  getWalletOperationRequests: (params = {}) => httpClient.get(withQuery("/api/internal/wallet-operation-requests", params)),
  getWalletOperationRequest: (requestId) => httpClient.get(`/api/internal/wallet-operation-requests/${requestId}`),
  approveWalletOperationRequest: (requestId) => httpClient.post(`/api/internal/wallet-operation-requests/${requestId}/approve`, {}),
  rejectWalletOperationRequest: (requestId, rejectionReason) =>
    httpClient.post(`/api/internal/wallet-operation-requests/${requestId}/reject`, { rejectionReason }),
  getRisk: () => httpClient.get("/api/internal/risk-compliance"),
  handleRiskTransactionAction: (transactionPublicId, payload) =>
    httpClient.post(`/api/internal/risk-compliance/transactions/${transactionPublicId}/action`, payload),
  createComplianceCase: (payload) => httpClient.post("/api/internal/risk-compliance/cases", payload),
  flagSuspiciousStation: (stationPublicId, payload) => httpClient.post(`/api/internal/risk-compliance/stations/${stationPublicId}/flag`, payload),
  updateComplianceCaseWorkflow: (casePublicId, payload) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/action`, payload),
  freezeComplianceCase: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/freeze`, {}),
  freezeComplianceAccount: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/freeze-account`, {}),
  freezeComplianceStation: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/freeze-station`, {}),
  unfreezeComplianceCase: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/unfreeze`, {}),
  unfreezeComplianceAccount: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/unfreeze-account`, {}),
  unfreezeComplianceStation: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/unfreeze-station`, {}),
  approveHighRiskOverride: (casePublicId) => httpClient.post(`/api/internal/risk-compliance/cases/${casePublicId}/override-approve`, {}),
  getAnalytics: () => httpClient.get("/api/internal/analytics-forecasting"),
  downloadAnalyticsExport: (format, params = {}) =>
    httpClient.getBlobWithMeta(withQuery(`/api/internal/analytics-forecasting/export/${format}`, params)),
  getAuditLogs: () => httpClient.get("/api/internal/audit-logs"),
  getStaff: () => httpClient.get("/api/internal/staff"),
  createInternalUser: (payload) => httpClient.post("/api/internal/staff", payload),
  assignRole: (userPublicId, roleCode) => httpClient.post(`/api/internal/staff/${userPublicId}/role`, { roleCode }),
  changeRole: (userPublicId, roleCode) => httpClient.post(`/api/internal/staff/${userPublicId}/role/change`, { roleCode }),
  revokeRole: (userPublicId, roleCode) => httpClient.post(`/api/internal/staff/${userPublicId}/role/revoke`, { roleCode }),
  suspendInternalUser: (userPublicId) => httpClient.post(`/api/internal/staff/${userPublicId}/suspend`, {}),
  reactivateInternalUser: (userPublicId) => httpClient.post(`/api/internal/staff/${userPublicId}/reactivate`, {}),
  forceSignOutInternalUser: (userPublicId) => httpClient.post(`/api/internal/staff/${userPublicId}/force-sign-out`, {}),
  lockInternalAccount: (userPublicId) => httpClient.post(`/api/internal/staff/${userPublicId}/lock`, {}),
  resetInternalAccess: (userPublicId) => httpClient.post(`/api/internal/staff/${userPublicId}/reset-access`, {}),
  getSystemHealth: () => httpClient.get("/api/internal/system-health"),
  acknowledgeSystemHealthEvent: (eventPublicId) => httpClient.post(`/api/internal/system-health/events/${eventPublicId}/acknowledge`, {}),
  createSystemHealthBugNote: (eventPublicId, note) => httpClient.post(`/api/internal/system-health/events/${eventPublicId}/bug-note`, { note }),
  linkIncidentToSystemHealthEvent: (eventPublicId, incidentPublicId) =>
    httpClient.post(`/api/internal/system-health/events/${eventPublicId}/link-incident`, { incidentPublicId }),
  getSettings: () => httpClient.get("/api/internal/settings"),
  updateSetting: (settingKey, value) => httpClient.patch(`/api/internal/settings/${settingKey}`, { value }),
}
