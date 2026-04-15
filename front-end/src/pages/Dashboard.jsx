import Navbar from "../components/Navbar"
import DashboardReplica from "../components/dashboard/DashboardReplica"
import "../assets/dashboard.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

export default function Dashboard() {
  return (
    <div className="dashboard">
      <Navbar image={avatar}/>
      <DashboardReplica />
    </div>
  )
}
