import { queueService as queueMock } from "../features/queueConsole/queueService"
import { reportsService as reportsMock } from "../features/reports/reportsService"
import { queueApi } from "../api/queueApi"
import { reportsApi } from "../api/reportsApi"
import { pumpsApi } from "../api/pumpsApi"

const mode = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase()
const useApi = mode === "api"

export const queueData = useApi ? queueApi : queueMock
export const reportsData = useApi ? reportsApi : reportsMock
export const pumpsData = useApi ? pumpsApi : { updatePumpStatus: async () => ({}) }
