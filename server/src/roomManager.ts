import crypto from "crypto";
import type { TypedServer, TypedSocket, Room, PlayerSlot } from "./types.js";
import type { LobbyPlayer } from "@/shared/types/messages";
import { handleStartGame, handleGameAction } from "./gameSession.js";
import { filterStateForPlayer } from "./stateFilter.js";

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>(); // socketId → roomCode

// Letters excluding I/O to avoid confusion
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}

export function getRoomForSocket(socketId: string): Room | undefined {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : undefined;
}

export function getPlayerSlot(room: Room, socketId: string): PlayerSlot | undefined {
  return room.players.find((p) => p.socketId === socketId);
}

function toLobbyPlayers(room: Room): LobbyPlayer[] {
  return room.players.map((p) => ({
    index: p.index,
    name: p.name,
    isBot: p.isBot,
    isReady: p.isBot || p.socketId !== null,
  }));
}

function broadcastLobbyState(io: TypedServer, room: Room) {
  io.to(room.code).emit("room:lobby-state", { players: toLobbyPlayers(room) });
}

export function handleConnection(io: TypedServer, socket: TypedSocket) {
  socket.on("room:join", ({ roomCode, playerName, reconnectToken }) => {
    handleJoin(io, socket, roomCode, playerName, reconnectToken);
  });

  socket.on("room:leave", () => {
    handleLeave(io, socket);
  });

  socket.on("room:add-bot", ({ difficulty, personality }) => {
    handleAddBot(io, socket, difficulty);
  });

  socket.on("room:start-game", () => {
    handleStartGame(io, socket);
  });

  socket.on("game:action", ({ action }) => {
    handleGameAction(io, socket, action);
  });

  socket.on("chat:message", ({ text }) => {
    handleChat(io, socket, text);
  });

  socket.on("disconnect", () => {
    handleDisconnect(io, socket);
  });
}

function handleJoin(
  io: TypedServer,
  socket: TypedSocket,
  roomCode: string,
  playerName: string,
  reconnectToken?: string
) {
  // Creating a new room
  if (!roomCode) {
    const code = generateRoomCode();
    const token = generateToken();
    const room: Room = {
      code,
      hostSocketId: socket.id,
      players: [
        {
          index: 0,
          name: playerName || "Player 1",
          isBot: false,
          socketId: socket.id,
          reconnectToken: token,
          disconnectedAt: null,
        },
      ],
      gameState: null,
      gameConfig: null,
      botTimers: [],
      turnTimer: null,
      turnDeadline: null,
      createdAt: Date.now(),
    };
    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    socket.emit("room:joined", { roomCode: code, playerIndex: 0, reconnectToken: token });
    broadcastLobbyState(io, room);
    return;
  }

  // Joining existing room
  const room = rooms.get(roomCode);
  if (!room) {
    socket.emit("game:error", { message: "Room not found" });
    return;
  }

  // Reconnection attempt
  if (reconnectToken) {
    const slot = room.players.find((p) => p.reconnectToken === reconnectToken);
    if (slot && !slot.isBot) {
      slot.socketId = socket.id;
      slot.disconnectedAt = null;
      socketToRoom.set(socket.id, roomCode);
      socket.join(roomCode);
      socket.emit("room:joined", {
        roomCode,
        playerIndex: slot.index,
        reconnectToken: slot.reconnectToken!,
      });
      broadcastLobbyState(io, room);
      // If game is in progress, send current state
      if (room.gameState) {
        const clientState = filterStateForPlayer(room.gameState, slot.index);
        socket.emit("game:state", { state: clientState });
      }
      return;
    }
  }

  // Game already started — can't join mid-game
  if (room.gameState) {
    socket.emit("game:error", { message: "Game already in progress" });
    return;
  }

  if (room.players.length >= 6) {
    socket.emit("game:error", { message: "Room is full" });
    return;
  }

  const token = generateToken();
  const newIndex = room.players.length;
  const slot: PlayerSlot = {
    index: newIndex,
    name: playerName || `Player ${newIndex + 1}`,
    isBot: false,
    socketId: socket.id,
    reconnectToken: token,
    disconnectedAt: null,
  };
  room.players.push(slot);
  socketToRoom.set(socket.id, roomCode);
  socket.join(roomCode);
  socket.emit("room:joined", { roomCode, playerIndex: newIndex, reconnectToken: token });
  io.to(roomCode).emit("room:player-joined", { playerName: slot.name, playerIndex: newIndex });
  broadcastLobbyState(io, room);
}

function handleAddBot(io: TypedServer, socket: TypedSocket, difficulty: string) {
  const room = getRoomForSocket(socket.id);
  if (!room || room.hostSocketId !== socket.id) return;
  if (room.gameState) return; // can't add bots mid-game
  if (room.players.length >= 6) return;

  const botNames = ["Alice", "Bob", "Carol", "Dave", "Eve"];
  const usedNames = new Set(room.players.map((p) => p.name));
  const name = botNames.find((n) => !usedNames.has(n)) ?? `Bot ${room.players.length}`;

  const newIndex = room.players.length;
  room.players.push({
    index: newIndex,
    name,
    isBot: true,
    socketId: null,
    reconnectToken: null,
    disconnectedAt: null,
  });
  broadcastLobbyState(io, room);
}

function handleLeave(io: TypedServer, socket: TypedSocket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;

  removePlayerFromRoom(io, room, socket.id);
  socket.leave(room.code);
  socketToRoom.delete(socket.id);
}

function handleDisconnect(io: TypedServer, socket: TypedSocket) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;

  const slot = room.players.find((p) => p.socketId === socket.id);
  if (!slot) return;

  if (room.gameState) {
    // Game in progress — keep slot, start grace period
    slot.socketId = null;
    slot.disconnectedAt = Date.now();
    socketToRoom.delete(socket.id);
    io.to(room.code).emit("room:player-left", { playerIndex: slot.index });

    // 5-minute grace period, then replace with bot
    setTimeout(() => {
      if (slot.disconnectedAt !== null) {
        slot.isBot = true;
        slot.reconnectToken = null;
        broadcastLobbyState(io, room);
      }
    }, 5 * 60 * 1000);
  } else {
    // In lobby — remove entirely
    removePlayerFromRoom(io, room, socket.id);
    socketToRoom.delete(socket.id);
  }
}

function removePlayerFromRoom(io: TypedServer, room: Room, socketId: string) {
  const idx = room.players.findIndex((p) => p.socketId === socketId);
  if (idx === -1) return;

  room.players.splice(idx, 1);
  // Re-index
  room.players.forEach((p, i) => (p.index = i));

  if (room.players.length === 0) {
    // Clean up empty room
    room.botTimers.forEach(clearTimeout);
    if (room.turnTimer) clearTimeout(room.turnTimer);
    rooms.delete(room.code);
    return;
  }

  // If host left, assign new host
  if (room.hostSocketId === socketId) {
    const newHost = room.players.find((p) => !p.isBot && p.socketId);
    if (newHost) room.hostSocketId = newHost.socketId!;
  }

  broadcastLobbyState(io, room);
}

function handleChat(io: TypedServer, socket: TypedSocket, text: string) {
  const room = getRoomForSocket(socket.id);
  if (!room) return;
  const slot = getPlayerSlot(room, socket.id);
  if (!slot) return;

  io.to(room.code).emit("chat:message", {
    playerIndex: slot.index,
    playerName: slot.name,
    text,
    timestamp: Date.now(),
  });
}
