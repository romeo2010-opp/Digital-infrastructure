import { Link } from "react-router";
import { ClipboardList, Calendar, UserPlus, Users, Clock, CheckCircle } from "lucide-react";
import { useKioskStore } from "../store/kioskStore";

export default function Dashboard() {
  const { queue, reservations, orders } = useKioskStore();
  
  const activeQueue = queue.filter(item => item.status === "waiting" || item.status === "serving");
  const todayReservations = reservations.filter(res => {
    const resDate = new Date(res.dateTime);
    const today = new Date();
    return resDate.toDateString() === today.toDateString();
  });
  const completedToday = orders.filter(order => {
    const orderDate = new Date(order.timestamp);
    const today = new Date();
    return orderDate.toDateString() === today.toDateString() && order.status === "completed";
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
        <p className="text-gray-600 mt-2">Station attendant control center</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Queue</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">{activeQueue.length}</p>
            </div>
            <div className="bg-blue-100 p-3 rounded-full">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Today's Reservations</p>
              <p className="text-3xl font-bold text-green-600 mt-2">{todayReservations.length}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-full">
              <Calendar className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Completed Today</p>
              <p className="text-3xl font-bold text-purple-600 mt-2">{completedToday.length}</p>
            </div>
            <div className="bg-purple-100 p-3 rounded-full">
              <CheckCircle className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Avg Wait Time</p>
              <p className="text-3xl font-bold text-orange-600 mt-2">12m</p>
            </div>
            <div className="bg-orange-100 p-3 rounded-full">
              <Clock className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          to="/queue"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-blue-500"
        >
          <div className="flex items-center gap-4">
            <div className="bg-blue-100 p-4 rounded-lg">
              <ClipboardList className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Digital Queue</h3>
              <p className="text-sm text-gray-600">Manage customer queue</p>
            </div>
          </div>
        </Link>

        <Link
          to="/reservations"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-green-500"
        >
          <div className="flex items-center gap-4">
            <div className="bg-green-100 p-4 rounded-lg">
              <Calendar className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Reservations</h3>
              <p className="text-sm text-gray-600">View & manage bookings</p>
            </div>
          </div>
        </Link>

        <Link
          to="/orders"
          className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-2 border-transparent hover:border-purple-500"
        >
          <div className="flex items-center gap-4">
            <div className="bg-purple-100 p-4 rounded-lg">
              <UserPlus className="w-8 h-8 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Walk-in Orders</h3>
              <p className="text-sm text-gray-600">Create manual orders</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="mt-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {orders.slice(-5).reverse().map(order => (
            <div key={order.id} className="flex items-center justify-between py-3 border-b last:border-0">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  order.status === "completed" ? "bg-green-500" :
                  order.status === "processing" ? "bg-blue-500" : "bg-gray-400"
                }`} />
                <div>
                  <p className="font-medium">{order.customerName}</p>
                  <p className="text-sm text-gray-600">{order.service}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">
                  {new Date(order.timestamp).toLocaleTimeString()}
                </p>
                <p className="text-xs text-gray-500 capitalize">{order.status}</p>
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <p className="text-gray-500 text-center py-4">No recent activity</p>
          )}
        </div>
      </div>
    </div>
  );
}
