import { useState } from "react";
import { Plus, Calendar as CalendarIcon, Check, X, Clock } from "lucide-react";
import { useKioskStore } from "../store/kioskStore";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "../components/ui/dialog";
import { toast } from "sonner";

export default function Reservations() {
  const { reservations, addReservation, updateReservationStatus, cancelReservation } = useKioskStore();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [specialRequests, setSpecialRequests] = useState("");

  const handleAddReservation = () => {
    if (!customerName.trim() || !contactNumber.trim() || !dateTime) {
      toast.error("Please fill in all required fields");
      return;
    }

    addReservation({
      customerName: customerName.trim(),
      contactNumber: contactNumber.trim(),
      dateTime,
      partySize,
      specialRequests: specialRequests.trim(),
    });

    toast.success(`Reservation created for ${customerName}`);
    setCustomerName("");
    setContactNumber("");
    setDateTime("");
    setPartySize(1);
    setSpecialRequests("");
    setIsAddDialogOpen(false);
  };

  const handleConfirmReservation = (id: string) => {
    updateReservationStatus(id, "confirmed");
    toast.success("Reservation confirmed");
  };

  const handleCompleteReservation = (id: string) => {
    updateReservationStatus(id, "completed");
    toast.success("Reservation completed");
  };

  const handleCancelReservation = (id: string, customerName: string) => {
    cancelReservation(id);
    toast.info(`Reservation for ${customerName} cancelled`);
  };

  const pendingReservations = reservations.filter(r => r.status === "pending");
  const confirmedReservations = reservations.filter(r => r.status === "confirmed");
  const todayReservations = reservations.filter(r => {
    const resDate = new Date(r.dateTime);
    const today = new Date();
    return resDate.toDateString() === today.toDateString() && r.status !== "cancelled";
  });

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reservations</h1>
          <p className="text-gray-600 mt-2">Manage customer reservations and bookings</p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              New Reservation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Reservation</DialogTitle>
              <DialogDescription>
                Schedule a new reservation for a customer.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label htmlFor="resCustomerName">Customer Name *</Label>
                <Input
                  id="resCustomerName"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter customer name"
                />
              </div>
              <div>
                <Label htmlFor="resContactNumber">Contact Number *</Label>
                <Input
                  id="resContactNumber"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  placeholder="Enter contact number"
                />
              </div>
              <div>
                <Label htmlFor="resDateTime">Date & Time *</Label>
                <Input
                  id="resDateTime"
                  type="datetime-local"
                  value={dateTime}
                  onChange={(e) => setDateTime(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="resPartySize">Party Size</Label>
                <Input
                  id="resPartySize"
                  type="number"
                  min="1"
                  value={partySize}
                  onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label htmlFor="resSpecialRequests">Special Requests</Label>
                <Textarea
                  id="resSpecialRequests"
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  placeholder="Any special requirements..."
                />
              </div>
              <Button onClick={handleAddReservation} className="w-full">
                Create Reservation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">Today's Reservations</p>
          <p className="text-2xl font-bold text-blue-900">{todayReservations.length}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">Pending</p>
          <p className="text-2xl font-bold text-yellow-900">{pendingReservations.length}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">Confirmed</p>
          <p className="text-2xl font-bold text-green-900">{confirmedReservations.length}</p>
        </div>
      </div>

      {/* Pending Reservations */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Pending Reservations</h2>
        <div className="space-y-3">
          {pendingReservations.length === 0 && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              No pending reservations
            </div>
          )}
          {pendingReservations.map((reservation) => (
            <div key={reservation.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{reservation.customerName}</h3>
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      <span>{new Date(reservation.dateTime).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{new Date(reservation.dateTime).toLocaleTimeString()}</span>
                    </div>
                    <div>📞 {reservation.contactNumber}</div>
                    <div>👥 Party of {reservation.partySize}</div>
                    {reservation.specialRequests && (
                      <div className="mt-2 p-2 bg-gray-50 rounded">
                        <p className="text-xs text-gray-500">Special Requests:</p>
                        <p>{reservation.specialRequests}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleConfirmReservation(reservation.id)}
                    variant="default"
                    className="gap-2 bg-green-600 hover:bg-green-700"
                  >
                    <Check className="w-4 h-4" />
                    Confirm
                  </Button>
                  <Button
                    onClick={() => handleCancelReservation(reservation.id, reservation.customerName)}
                    variant="outline"
                    className="gap-2"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmed Reservations */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Confirmed Reservations</h2>
        <div className="space-y-3">
          {confirmedReservations.length === 0 && (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              No confirmed reservations
            </div>
          )}
          {confirmedReservations.map((reservation) => (
            <div key={reservation.id} className="bg-green-50 border-2 border-green-500 rounded-lg shadow p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{reservation.customerName}</h3>
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      <span>{new Date(reservation.dateTime).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{new Date(reservation.dateTime).toLocaleTimeString()}</span>
                    </div>
                    <div>📞 {reservation.contactNumber}</div>
                    <div>👥 Party of {reservation.partySize}</div>
                    {reservation.specialRequests && (
                      <div className="mt-2 p-2 bg-white rounded">
                        <p className="text-xs text-gray-500">Special Requests:</p>
                        <p>{reservation.specialRequests}</p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleCompleteReservation(reservation.id)}
                    variant="default"
                  >
                    Complete
                  </Button>
                  <Button
                    onClick={() => handleCancelReservation(reservation.id, reservation.customerName)}
                    variant="outline"
                    className="gap-2"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}