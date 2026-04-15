import { Outlet, NavLink } from "react-router";
import { ClipboardList, Calendar, UserPlus, Home } from "lucide-react";

export default function Root() {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-blue-900 text-white flex flex-col">
        <div className="p-6 border-b border-blue-800">
          <h1 className="text-2xl font-bold">Station Kiosk</h1>
          <p className="text-sm text-blue-200 mt-1">Attendant Console</p>
        </div>
        
        <nav className="flex-1 p-4">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
                isActive
                  ? "bg-blue-700 text-white"
                  : "text-blue-100 hover:bg-blue-800"
              }`
            }
          >
            <Home className="w-5 h-5" />
            <span>Dashboard</span>
          </NavLink>
          
          <NavLink
            to="/queue"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
                isActive
                  ? "bg-blue-700 text-white"
                  : "text-blue-100 hover:bg-blue-800"
              }`
            }
          >
            <ClipboardList className="w-5 h-5" />
            <span>Digital Queue</span>
          </NavLink>
          
          <NavLink
            to="/reservations"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
                isActive
                  ? "bg-blue-700 text-white"
                  : "text-blue-100 hover:bg-blue-800"
              }`
            }
          >
            <Calendar className="w-5 h-5" />
            <span>Reservations</span>
          </NavLink>
          
          <NavLink
            to="/orders"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
                isActive
                  ? "bg-blue-700 text-white"
                  : "text-blue-100 hover:bg-blue-800"
              }`
            }
          >
            <UserPlus className="w-5 h-5" />
            <span>Walk-in Orders</span>
          </NavLink>
        </nav>
        
        <div className="p-4 border-t border-blue-800">
          <p className="text-xs text-blue-200">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="text-xs text-blue-200 mt-1">
            {new Date().toLocaleTimeString()}
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
