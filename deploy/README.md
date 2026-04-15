# SmartLink Deployment (LAN IP + Cloudflared)

Express can serve both API and built React files on one port (`4000`).
You can run it in two modes:
- LAN mode: devices use `http://<SERVER_IP>:4000`
- Cloudflared mode: public domain proxies to `http://localhost:4000`

## 1) Build frontend

```bash
cd front-end
cp .env.production.example .env.production
npm install
npm run build
```

`VITE_API_BASE_URL` is intentionally blank for same-origin API calls.

## 2) Configure backend

```bash
cd ../back-end
cp .env.example .env
```

Common minimum values in `back-end/.env`:

```env
HOST=0.0.0.0
PORT=4000
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/smartlink"
JWT_ACCESS_SECRET=replace_with_a_long_random_secret
SERVE_FRONTEND=true
FRONTEND_DIST_PATH=../front-end/dist
```

### LAN mode (IP only, same network)

For LAN/IP access, add:

```env
COOKIE_SECURE=false
COOKIE_DOMAIN=
```

Start:

```bash
npm install
npm run start:lan
```

Open from another device:

```text
http://<SERVER_IP>:4000
```

Example:

```text
http://192.168.1.42:4000
```

Make sure server firewall/router allows inbound TCP `4000` on your LAN.

### Cloudflared mode (public domain)

For HTTPS domain access, use:

```env
COOKIE_SECURE=true
COOKIE_DOMAIN=app.example.com
```

Start backend:

```bash
npm install
npm run start:with-ui
```

## 3) Configure Cloudflared tunnel (only for Cloudflared mode)

Use the template at `deploy/cloudflared/config.example.yml`.

Example setup:

```bash
cloudflared tunnel create smartlink-prod
cloudflared tunnel route dns smartlink-prod app.example.com
sudo mkdir -p /etc/cloudflared
sudo cp deploy/cloudflared/config.example.yml /etc/cloudflared/config.yml
```

Edit `/etc/cloudflared/config.yml`:
- Replace `<TUNNEL-UUID>` in `credentials-file`
- Set `hostname` to your real domain

Run tunnel:

```bash
cloudflared tunnel run smartlink-prod
```

## 4) Validation checklist

- LAN mode: `http://<SERVER_IP>:4000/health` returns `{ ok: true }`
- Cloudflared mode: `https://app.example.com/health` returns `{ ok: true }`
- Browser route refresh works (e.g. `/reports`, `/settings`)
- API requests resolve to same host (no `localhost` in network tab)
