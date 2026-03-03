"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySocket = Socket<any, any>;

export function useSocket() {
  const socketRef = useRef<AnySocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket: AnySocket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return { socket: socketRef.current, connected };
}
