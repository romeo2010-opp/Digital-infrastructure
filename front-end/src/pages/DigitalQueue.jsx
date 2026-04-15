import { getRoleCode } from "../auth/authSession"
import AttendantDeskPage from "../features/attendantDesk/AttendantDeskPage"
import ManagerQueueConsole from "../features/queueConsole/ManagerQueueConsole"

export default function DigitalQueue() {
  const roleCode = getRoleCode()
  if (roleCode === "ATTENDANT") {
    return <AttendantDeskPage />
  }
  return <ManagerQueueConsole />
}
