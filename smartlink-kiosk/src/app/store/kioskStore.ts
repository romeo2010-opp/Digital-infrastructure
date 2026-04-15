import { create } from "zustand";

// Types
export type QueueStatus = "waiting" | "serving" | "completed";
export type ReservationStatus = "pending" | "confirmed" | "completed" | "cancelled";
export type OrderStatus = "processing" | "completed";

export interface QueueItem {
  id: string;
  customerName: string;
  partySize: number;
  contactNumber?: string;
  timestamp: string;
  status: QueueStatus;
}

export interface Reservation {
  id: string;
  customerName: string;
  contactNumber: string;
  dateTime: string;
  partySize: number;
  specialRequests?: string;
  status: ReservationStatus;
  createdAt: string;
}

export interface Order {
  id: string;
  customerName: string;
  service: string;
  contactNumber?: string;
  notes?: string;
  timestamp: string;
  status: OrderStatus;
}

interface KioskStore {
  queue: QueueItem[];
  reservations: Reservation[];
  orders: Order[];
  
  // Queue actions
  addToQueue: (item: Omit<QueueItem, "id" | "timestamp" | "status">) => void;
  updateQueueStatus: (id: string, status: QueueStatus) => void;
  removeFromQueue: (id: string) => void;
  
  // Reservation actions
  addReservation: (reservation: Omit<Reservation, "id" | "status" | "createdAt">) => void;
  updateReservationStatus: (id: string, status: ReservationStatus) => void;
  cancelReservation: (id: string) => void;
  
  // Order actions
  addOrder: (order: Omit<Order, "id" | "timestamp" | "status">) => void;
  updateOrderStatus: (id: string, status: OrderStatus) => void;
}

export const useKioskStore = create<KioskStore>((set) => ({
  queue: [],
  reservations: [],
  orders: [],
  
  // Queue actions
  addToQueue: (item) => set((state) => ({
    queue: [
      ...state.queue,
      {
        ...item,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        status: "waiting",
      },
    ],
  })),
  
  updateQueueStatus: (id, status) => set((state) => ({
    queue: state.queue.map((item) =>
      item.id === id ? { ...item, status } : item
    ),
  })),
  
  removeFromQueue: (id) => set((state) => ({
    queue: state.queue.filter((item) => item.id !== id),
  })),
  
  // Reservation actions
  addReservation: (reservation) => set((state) => ({
    reservations: [
      ...state.reservations,
      {
        ...reservation,
        id: Math.random().toString(36).substr(2, 9),
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ],
  })),
  
  updateReservationStatus: (id, status) => set((state) => ({
    reservations: state.reservations.map((res) =>
      res.id === id ? { ...res, status } : res
    ),
  })),
  
  cancelReservation: (id) => set((state) => ({
    reservations: state.reservations.map((res) =>
      res.id === id ? { ...res, status: "cancelled" as ReservationStatus } : res
    ),
  })),
  
  // Order actions
  addOrder: (order) => set((state) => ({
    orders: [
      ...state.orders,
      {
        ...order,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        status: "processing",
      },
    ],
  })),
  
  updateOrderStatus: (id, status) => set((state) => ({
    orders: state.orders.map((order) =>
      order.id === id ? { ...order, status } : order
    ),
  })),
}));
