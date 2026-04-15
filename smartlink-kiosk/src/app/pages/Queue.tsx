import { useState } from "react";
import { Plus, UserCheck, X, Clock } from "lucide-react";
import { useKioskStore } from "../store/kioskStore";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../components/ui/dialog";
import { toast } from "sonner";

export default function Queue() {
  const { queue, addToQueue, updateQueueStatus, removeFromQueue } = useKioskStore();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [contactNumber, setContactNumber] = useState("");

  const handleAddToQueue = () => {
    if (!customerName.trim()) {
      toast.error("Please enter customer name");
      return;
    }

    addToQueue({
      customerName: customerName.trim(),
      partySize,
      contactNumber: contactNumber.trim(),
    });

    toast.success(`${customerName} added to queue`);
    setCustomerName("");
    setPartySize(1);
    setContactNumber("");
    setIsAddDialogOpen(false);
  };

  const handleServeCustomer = (id: string) => {
    updateQueueStatus(id, "serving");
    toast.success("Customer is now being served");
  };

  const handleCompleteService = (id: string) => {
    updateQueueStatus(id, "completed");
    toast.success("Service completed");
    setTimeout(() => removeFromQueue(id), 2000);
  };

  const handleRemoveFromQueue = (id: string, customerName: string) => {
    removeFromQueue(id);
    toast.info(`${customerName} removed from queue`);
  };

  const waitingQueue = queue.filter(item => item.status === "waiting");
  const servingQueue = queue.filter(item => item.status === "serving");
  const completedQueue = queue.filter(item => item.status === "completed");

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Digital Queue</h1>
          <p className="text-gray-600 mt-2">Manage customer queue in real-time</p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add to Queue
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Customer to Queue</DialogTitle>
              <DialogDescription>
                Enter customer details to add them to the waiting queue.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label htmlFor="customerName">Customer Name *</Label>
                <Input
                  id="customerName"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                />
              </div>
              <div>
                <Label htmlFor="partySize">Party Size</Label>
                <Input
                  id="partySize"
                  type="number"
                  min="1"
                  value={partySize}
                  onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label htmlFor="contactNumber">Contact Number (Optional)</Label>
                <Input
                  id="contactNumber"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder="Enter contact number"
                />
              </div>
              <Button onClick={handleAddToQueue} className="w-full">
                Add to Queue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Queue Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">Waiting</p>
          <p className="text-2xl font-bold text-yellow-900">{waitingQueue.length}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">Being Served</p>
          <p className="text-2xl font-bold text-blue-900">{servingQueue.length}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">Completed</p>
          <p className="text-2xl font-bold text-green-900">{completedQueue.length}</p>
        </div>
      </div>

      {/* Waiting Queue */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Waiting Queue</h2>
        <div className="space-y-3">
          {waitingQueue.length === 0 && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              No customers waiting
            </div>
          )}
          {waitingQueue.map((item, index) => (
            <div key={item.id} className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-yellow-500 text-white w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg">
                  {index + 1}
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{item.customerName}</h3>
                  <div className="flex gap-4 text-sm text-gray-600">
                    <span>Party of {item.partySize}</span>
                    {item.contactNumber && <span>📞 {item.contactNumber}</span>}
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleServeCustomer(item.id)}
                  variant="default"
                  className="gap-2"
                >
                  <UserCheck className="w-4 h-4" />
                  Serve
                </Button>
                <Button
                  onClick={() => handleRemoveFromQueue(item.id, item.customerName)}
                  variant="outline"
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Currently Serving */}
      {servingQueue.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Currently Serving</h2>
          <div className="space-y-3">
            {servingQueue.map((item) => (
              <div key={item.id} className="bg-blue-50 border-2 border-blue-500 rounded-lg shadow p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-blue-500 text-white w-12 h-12 rounded-full flex items-center justify-center">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{item.customerName}</h3>
                    <div className="flex gap-4 text-sm text-gray-600">
                      <span>Party of {item.partySize}</span>
                      {item.contactNumber && <span>📞 {item.contactNumber}</span>}
                    </div>
                  </div>
                </div>
                <Button
                  onClick={() => handleCompleteService(item.id)}
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                >
                  Complete Service
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}