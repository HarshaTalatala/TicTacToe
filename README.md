# Multiplayer Tic-Tac-Toe with Nakama

This repository contains a server-authoritative multiplayer Tic-Tac-Toe implementation using:
- React + Vite + TypeScript frontend
- Nakama runtime module for authoritative game logic
- CockroachDB + Nakama via Docker Compose for local backend

## Current Implementation Status

Implemented now:
- React client scaffolding and multiplayer game UI
- Nakama authoritative match handler:
  - move validation
  - turn enforcement
  - win and draw detection
  - rematch flow
  - disconnect handling
- Match modes:
  - classic
  - timed (30s turn timeout)
- Room discovery and join
- Auto-match integration
- Leaderboard and per-player stats RPCs

## Project Structure

- client: React frontend
- backend: Nakama + DB local stack and runtime JS module
- instructions.md: assessment brief

## Local Run

## 1) Start backend

From backend folder:

PowerShell:

docker compose up -d

docker compose logs -f nakama

Nakama endpoints:
- API: http://127.0.0.1:7350
- Console: http://127.0.0.1:7351
- Cockroach admin: http://127.0.0.1:8080

## 2) Start frontend

From client folder:

npm install

copy .env.example .env

npm run dev

Open:
- http://127.0.0.1:5173

## Multiplayer Test Flow

1. Open two browser windows.
2. Sign in with different usernames.
3. In one window create room or start auto-match.
4. Join from second window.
5. Play a full game and verify:
   - only current player can move
   - invalid moves are rejected
   - win and draw states sync in real time
6. For timed mode, wait for timeout to verify auto-forfeit.
7. Refresh leaderboard and verify winner stats update.

## Next Steps

- Add richer room labels and filter UI.
- Add reconnect-resume UX for interrupted sessions.
- Add deployment manifests and cloud instructions for EC2.
- Add end-to-end multiplayer test script.
