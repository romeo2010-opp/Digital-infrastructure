# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## API Wiring (optional)

Set these in `front-end/.env` when you want UI pages to use backend APIs:

```env
VITE_DATA_SOURCE=api
VITE_API_BASE_URL=
VITE_DEV_API_TARGET=http://127.0.0.1:4000
VITE_WS_BASE_URL=
```

Default data source is API. Set `VITE_DATA_SOURCE=mock` only if you want local mock behavior.
If frontend and backend share the same host (recommended), leave `VITE_API_BASE_URL` blank.
In dev, blank `VITE_API_BASE_URL` uses the Vite proxy (`/api`, `/auth`, `/health`, `/ws`) from `vite.config.js`.

For public tunnel testing, point the tunnel to the Vite app (`http://localhost:5000`) and keep both `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` blank. The browser will connect to the current public origin, so HTTPS tunnel pages use `wss://<tunnel-host>/ws/station-changes` instead of trying to reach `localhost` or a LAN IP from the remote device.

Set `VITE_WS_BASE_URL` only when the Station Manager app must connect to a separate public websocket/API host.

Production note:
- If frontend is served from the same host as backend (recommended with Cloudflared), set `VITE_API_BASE_URL=` (blank).
- Example file: `front-end/.env.production.example`.

Auth notes:
- In `api` mode the app shows a login page when no active session exists.
- Backend refresh cookie is used automatically (`credentials: "include"`).
- Access token is kept in memory only.
