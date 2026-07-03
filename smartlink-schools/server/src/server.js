import http from "http"
import app from "./app.js"
import { attachPortalWebSocketServer } from "./realtime/websocketServer.js"

const port = Number(process.env.PORT || 4307)
const server = http.createServer(app)

attachPortalWebSocketServer(server)

server.listen(port, () => {
  console.log(`SmartLink Schools API listening on http://localhost:${port}`)
})
