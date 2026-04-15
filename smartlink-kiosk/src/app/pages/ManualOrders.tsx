import { useState } from "react";
import { Plus, CheckCircle, Clock } from "lucide-react";
import { useKioskStore } from "../store/kioskStore";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";

const SERVICES = [
  "Ticket Purchase",
  "Lost & Found",
  "Information",
  "Assistance Request",
  "Luggage Service",
  "Wheelchair Service",
  "Other"
];

export default function ManualOrders() {
  const { orders, addOrder, updateOrderStatus } = useKioskStore();
  const [customerName, setCustomerName] = useState("");
  const [service, setService] = useState("");
  const [customService, setCustomService] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [notes, setNotes] = useState("");

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!customerName.trim()) {
      toast.error("Please enter customer name");
      return;
    }

    const finalService = service === "Other" && customService 
      ? customService 
      : service || "General Service";

    addOrder({
      customerName: customerName.trim(),
      service: finalService,
      contactNumber: contactNumber.trim(),
      notes: notes.trim(),
    });

    toast.success(`Order created for ${customerName}`);
    
    // Reset form
    setCustomerName("");
    setService("");
    setCustomService("");
    setContactNumber("");
    setNotes("");
  };

  const handleCompleteOrder = (id: string) => {
    updateOrderStatus(id, "completed");
    toast.success("Order completed");
  };

  const processingOrders = orders.filter(o => o.status === "processing");
  const completedOrders = orders.filter(o => o.status === "completed");

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Walk-in Orders</h1>
        <p className="text-gray-600 mt-2">Create and manage manual orders for walk-in customers</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Order Form */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6 sticky top-8">
            <h2 className="text-xl font-semibold mb-4">Create New Order</h2>
            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div>
                <Label htmlFor="orderCustomerName">Customer Name *</Label>
                <Input
                  id="orderCustomerName"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                  required
                />
              </div>

              <div>
                <Label htmlFor="orderService">Service Type *</Label>
                <select
                  id="orderService"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select a service...</option>
                  {SERVICES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {service === "Other" && (
                <div>
                  <Label htmlFor="customService">Custom Service</Label>
                  <Input
                    id="customService"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    placeholder="Specify service type"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="orderContactNumber">Contact Number</Label>
                <Input
                  id="orderContactNumber"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder="Enter contact number"
                />
              </div>

              <div>
                <Label htmlFor="orderNotes">Notes</Label>
                <Textarea
                  id="orderNotes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes or details..."
                  rows={3}
                />
              </div>

              <Button type="submit" className="w-full gap-2">
                <Plus className="w-4 h-4" />
                Create Order
              </Button>
            </form>
          </div>
        </div>

        {/* Orders List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Processing Orders */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Processing Orders</h2>
            <div className="space-y-3">
              {processingOrders.length === 0 && (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                  No orders currently processing
                </div>
              )}
              {processingOrders.map((order) => (
                <div key={order.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="bg-blue-500 text-white w-10 h-10 rounded-full flex items-center justify-center">
                          <Clock className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{order.customerName}</h3>
                          <p className="text-sm text-gray-600">{order.service}</p>
                        </div>
                      </div>
                      
                      <div className="ml-13 space-y-1 text-sm text-gray-600">
                        {order.contactNumber && (
                          <div>📞 {order.contactNumber}</div>
                        )}
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          <span>{new Date(order.timestamp).toLocaleString()}</span>
                        </div>
                        {order.notes && (
                          <div className="mt-2 p-2 bg-gray-50 rounded">
                            <p className="text-xs text-gray-500">Notes:</p>
                            <p>{order.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <Button
                      onClick={() => handleCompleteOrder(order.id)}
                      className="gap-2 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Complete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Completed Orders */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Completed Orders (Recent)</h2>
            <div className="space-y-3">
              {completedOrders.length === 0 && (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                  No completed orders
                </div>
              )}
              {completedOrders.slice(-10).reverse().map((order) => (
                <div key={order.id} className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-green-500 text-white w-10 h-10 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{order.customerName}</h3>
                      <p className="text-sm text-gray-600">{order.service}</p>
                      {order.contactNumber && (
                        <p className="text-sm text-gray-600 mt-1">📞 {order.contactNumber}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(order.timestamp).toLocaleString()}
                      </p>
                      {order.notes && (
                        <div className="mt-2 p-2 bg-white rounded text-sm">
                          <p className="text-xs text-gray-500">Notes:</p>
                          <p>{order.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
