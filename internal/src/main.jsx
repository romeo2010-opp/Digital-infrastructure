import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import { InternalAuthProvider } from "./auth/AuthContext"
import { AppShellProvider } from "./layout/AppShellContext"
import { InternalApprovalRequestsProvider } from "./notifications/InternalApprovalRequestsContext"
import { applyInternalLightTheme } from "./utils/internalTheme"
import "./styles.css"

applyInternalLightTheme()

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <InternalAuthProvider>
        <AppShellProvider>
          <InternalApprovalRequestsProvider>
            <App />
          </InternalApprovalRequestsProvider>
        </AppShellProvider>
      </InternalAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
