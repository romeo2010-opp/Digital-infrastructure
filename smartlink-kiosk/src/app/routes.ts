import { createBrowserRouter } from "react-router";
import Root from "./pages/Root";
import Dashboard from "./pages/Dashboard";
import Queue from "./pages/Queue";
import Reservations from "./pages/Reservations";
import ManualOrders from "./pages/ManualOrders";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      { path: "queue", Component: Queue },
      { path: "reservations", Component: Reservations },
      { path: "orders", Component: ManualOrders },
    ],
  },
]);
