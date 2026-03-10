"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySocket = Socket<any, any>;

// Singleton socket — shared across all components/pages
let globalSocket: AnySocket | null = null;

function getSocket(): AnySocket {
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Use WebSocket directly — avoids polling-related phantom disconnects
      transports: ["websocket"],
    });
  }
  return globalSocket;
}

// Eagerly create the socket so it's available on first render
if (typeof window !== "undefined") getSocket();

export function useSocket() {
  const [connected, setConnected] = useState(() => globalSocket?.connected ?? false);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    // Sync initial state (socket may have connected before this effect ran)
    setConnected(socket.connected);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      // Do NOT disconnect — the socket is shared
    };
  }, []);

  return { socket: globalSocket, connected };
}
