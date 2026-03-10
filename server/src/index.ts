import { createServer } from "http";
import { Server } from "socket.io";
import type { TypedServer, TypedSocket } from "./types.js";
import { handleConnection } from "./roomManager.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:3000"];

// Prevent server crashes from taking down all rooms
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception (server kept alive):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection (server kept alive):", reason);
});

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io: TypedServer = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
  },
  // Tighter ping settings to detect dead connections faster and recover sooner
  pingTimeout: 20000,
  pingInterval: 10000,
  // Skip HTTP long-polling — go straight to WebSocket.
  // Polling is the #1 cause of phantom disconnects behind proxies/CDNs.
  transports: ["websocket"],
  // Allow clients that still attempt polling to upgrade
  allowUpgrades: false,
});

io.on("connection", (socket: TypedSocket) => {
  handleConnection(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Erfindung server listening on port ${PORT}`);
  console.log(`CORS origins: ${CORS_ORIGINS.join(", ")}`);
});
