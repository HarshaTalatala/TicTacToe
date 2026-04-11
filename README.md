# Multiplayer Tic-Tac-Toe with Nakama

A production-ready, server-authoritative multiplayer Tic-Tac-Toe game built with modern web technologies and cloud infrastructure.

## Live Deployment

- **Frontend**: https://tic-tac-toe-pearl-theta-61.vercel.app/
- **Backend (Nakama)**: `tictactoe-production-8642.up.railway.app`
- **Database**: PostgreSQL (via Railway)

---

## Overview

This project demonstrates a full-stack multiplayer game implementation emphasizing:

- **Server-Authoritative Architecture**: All game logic executes server-side to prevent cheating or client-side manipulation.
- **Real-Time Synchronization**: Players receive instant state updates via WebSocket—board state, turn changes, timer countdowns.
- **Scalable Matchmaking**: Support for concurrent game sessions with room creation, discovery, automatic pairing, and flexible game modes.
- **Persistent Player Data**: Track wins, losses, streaks, and global leaderboard rankings.
- **Graceful Disconnect Handling**: Player reconnection logic and automatic win assignment on opponent disconnect.

### Implemented Features

**Core Multiplayer Gameplay**
- Server-authoritative move validation and turn enforcement
- Win/draw detection with automatic status updates
- Real-time board state synchronization via WebSocket

**Game Modes**
- Classic mode (unlimited time per turn)
- Timed mode (30-second turn limit with auto-forfeit on timeout)

**Matchmaking & Room Discovery**
- Create named game rooms and automatic matchmaker for quick pairing
- Browse available rooms with full lifecycle management

**Player Statistics & Leaderboard**
- Per-player stats tracking (wins, losses, streaks, total games)
- Global leaderboard ranked by wins with weekly reset
- Real-time stat updates on game completion

**Resilience & Robustness**
- Disconnect detection and automatic opponent win on disconnect
- Turn-based state isolation and input validation

---

## Architecture & Design Decisions

### Backend Architecture

The backend uses **Nakama 3.22**, an open-source game server that provides:

1. **Match Handler** (`tictactoe.js`): Authoritative game state machine
   - Manages match lifecycle: `waiting` → `playing` → `finished`
   - Enforces turn order and validates all moves server-side
   - Broadcasts state updates to all connected players
   - Handles disconnects, rematches, and timeout enforcement

2. **Runtime Modules**: TypeScript-compiled JavaScript RPCs
   - `create_ttt_match`: Room creation with mode/timeout parameters
   - `get_leaderboard`: Fetch top-ranked players
   - `get_my_stats`: Retrieve personal player statistics

3. **Persistent Storage**: Player stats and leaderboard metadata stored in PostgreSQL
   - `player_stats` collection: wins, losses, streaks, game count
   - `global_wins` leaderboard: ranked by score (wins) with subscore (streak)

### Frontend Architecture

React + TypeScript + Vite frontend communicates with Nakama via `@heroiclabs/nakama-js`:

1. **State Management**: React hooks for UI state, match state, room list, leaderboard
2. **Real-Time Subscriptions**:
   - `onmatchdata`: Accept server-pushed state updates
   - `onmatchmakermatched`: Join match when matchmaker pairs players
3. **Device-ID Authentication**: Lightweight auth using device ID + username
4. **Responsive Design**: Mobile-optimized UI for room discovery, board interaction, and stats display

### Concurrency & Scalability

- **Multiple Concurrent Matches**: Each match runs independently with a 1-hour TTL; no centralized server throttle.
- **Per-Match Isolation**: Player state, symbols, disconnection flags are match-scoped; no cross-match interference.
- **Tick-Based Event Loop**: Nakama's match loop processes one message batch per tick (1 tick/sec), ensuring deterministic turn ordering.

### Server-Authoritative Validation

Every move is validated server-side:
- Check game is in `playing` status
- Check sender is the current turn holder
- Check cell index is valid (0–8) and not already occupied  
- Check player is assigned a symbol (X or O)
- Reject invalid moves with error message sent to client

Leaderboard updates trigger only after move validation completes, preventing stat inflation from invalid attempts.

---

## Setup & Installation

### Prerequisites

- **Node.js** 18+ (for frontend build)
- **Docker** & **Docker Compose** (for local backend stack)
- **Git**

### Local Development

#### 1. Backend Setup

```bash
cd backend

# Start Nakama + CockroachDB
docker compose up -d

# View logs
docker compose logs -f nakama

# Verify startup
# - Nakama API: http://127.0.0.1:7350
# - Nakama Console: http://127.0.0.1:7351
# - CockroachDB Admin: http://127.0.0.1:8080
```

The `docker-compose.yml` automatically creates CockroachDB, runs migrations, and exposes required ports.

#### 2. Frontend Setup

```bash
cd client

# Install dependencies
npm install

# Start dev server
npm run dev

# Open browser
# http://127.0.0.1:5173
```

The frontend currently connects to your locally-running Nakama instance via `http://127.0.0.1:7350`. For production testing, the `.env` file can be configured to point to the deployed Railway endpoint (see [Deployment](#deployment-process-documentation) section).

---

## Deployment Process Documentation

### Overview

- **Frontend**: Deployed on **Vercel** (automatic CI/CD from Git)
- **Backend**: Deployed on **Railway.app** (Docker container with managed PostgreSQL)
- **Database**: Railway-managed PostgreSQL

### Frontend Deployment (Vercel)

 **GitHub Integration**
   - Push changes to your GitHub repository
   - Vercel automatically detects new commits to the default branch
   - Runs `npm install && npm run build` in the `client/` directory

### Backend Deployment (Railway)

1. **Dockerfile Build**
   - `backend/Dockerfile` inherits from `heroiclabs/nakama:3.22.0`
   - Copies runtime modules (`./nakama/data/modules`) into the container
   - Copies configuration (`./nakama/data/local.yml`) into the container

2. **Database Connection**
   - Railway provides a `DATABASE_URL` environment variable (PostgreSQL connection string)
   - The startup command parses `DATABASE_URL` and passes it to Nakama migrations and runtime:
     ```bash
     DATABASE_URL="postgresql://user:pass@host:5432/db"
     /nakama/nakama migrate up --database.address <parsed-addr>
     ```

3. **Railway Deployment Steps**
   - Create a new Railway project
   - Add a PostgreSQL plugin (Railway manages DB credentials and connection pool)
   - Create a new service from your GitHub repo pointing to the `backend/` directory
   - Set environment variables:
     ```
     DATABASE_URL        = (auto-provided by Railway PostgreSQL plugin)
     NAKAMA_SERVER_KEY   = (set a strong secret key for production)
     ```
   - Deploy; Railway builds the Docker image and runs the container

4. **Port Exposure**
   - Railway exposes Nakama on a public domain: `tictactoe-production-8642.up.railway.app`
   - By default, ports 7350 (API) and 7351 (console) are mapped

5. **Post-Deployment**
   - Nakama console is accessible at `https://tictactoe-production-8642.up.railway.app/console`
   - Health check: `curl https://tictactoe-production-8642.up.railway.app`

---

## API & Server Configuration Details

### Nakama Configuration (`backend/nakama/data/local.yml`)

```yaml
name: "nakama1"

http:
  cors_allow_origins:
    - "*"  # In production, restrict to your frontend domain

socket:
  server_key: "defaultkey"  # Override with production secret
  port: 7350
  cors_allow_origins:
    - "*"

runtime:
  path: "/nakama/data/modules"
  js_entrypoint: "tictactoe.js"
```

**Production Recommendations:**
- Set `cors_allow_origins` to `["https://tic-tac-toe-pearl-theta-61.vercel.app"]`
- Use a strong, random `server_key` (not "defaultkey")
- Consider enabling additional security headers


## Testing Multiplayer Functionality

### Manual Smoke Test (Two-Browser Flow)

1. **Setup**: Open frontend in two browser windows (or separate devices on same network)

2. **Sign In**
   - Window 1: Enter username "Alice" → Connect
   - Window 2: Enter username "Bob" → Connect
   - Status should show "Connected. Create a room, join a room, or auto-match."

3. **Create Room**
   - Window 1: Select Mode: `Classic`
   - Window 1: Click "Create Room" → Status: "Room created. Waiting for second player."
   - Verify room appears in the "Open Rooms" list in both windows

4. **Join Room**
   - Window 2: Click "Join" on Alice's room
   - Status: "Joined room successfully."
   - Both windows should display board and player info

5. **Classic Mode Gameplay**
   - Board should be empty with alternating turns
   - Window 1 (Alice): Turn indicator shows "Alice". Click a cell.
   - Window 2 (Bob): Turn indicator updates to "Bob". Click a cell.
   - Verify only the current player can click cells
   - Complete a game to win or draw
   - Status should show winner (or draw) and "Request Rematch" button

6. **Leaderboard Update**
   - After game completion, click "Refresh" in Leaderboard panel
   - Winner's win count should increment
   - Loser's loss count should increment
   - Winner's streak should increment (loser's streak resets)

7. **Timed Mode Test**
   - Window 1: Create new room with Mode: `Timed (30s)`
   - Window 2: Join room
   - Verify timer countdown appears in game meta section
   - Don't move; wait 30 seconds
   - Turn player should auto-forfeit; opponent wins
   - Check stats updated correctly

8. **Disconnect Handling**
   - Window 1: Create room, wait for Window 2 to join
   - Window 2: Click browser back button to disconnect
   - Window 1: Player status should show "Disconnected" within 5 seconds
   - Window 1: Should be declared winner automatically
   - Refresh leaderboard; verify Window 1 win count incremented

9. **Auto-Matchmaker**
   - Window 1: Mode: `Classic` → Click "Auto Match"
   - Status: "Searching for opponent via matchmaker..."
   - Window 2: Mode: `Classic` → Click "Auto Match"
   - Both windows should automatically join a match (may take 2–3 seconds)
   - Verify board is live and turns alternate

### Verification Checklist

- [ ] Two players can create and join a room without error
- [ ] Board state synchronizes in real-time across both clients
- [ ] Only the current turn player can make moves; opponent is disabled
- [ ] Invalid moves (occupied cell, out of bounds) are rejected with error
- [ ] Win/draw detection triggers correctly
- [ ] Auto-forfeit works in timed mode after 30 seconds
- [ ] Leaderboard updates reflect game outcome (winner +1 win/streak, loser +1 loss/streak reset)
- [ ] Disconnect in active game grants win to remaining player
- [ ] Auto-matchmaker pairs players within 5 seconds
- [ ] Rematch flow clears board and resets turn order
- [ ] Deployed frontend (Vercel) connects to deployed backend (Railway) without connection errors

---

## Project Structure

```
TicTacToe/
├── README.md                          # This file
├── client/                            # React frontend (Vite)
│   ├── src/
│   │   ├── App.tsx                   # Main game component + Nakama logic
│   │   ├── App.css                   # Styling
│   │   └── main.tsx                  # Entry point
│   ├── .env.example                  # Environment template
│   ├── public/                        # Static assets
│   ├── tsconfig.json                 # TypeScript config
│   ├── vite.config.ts                # Vite build config
│   └── package.json                  # Dependencies and scripts
│
├── backend/                           # Nakama runtime + Docker
│   ├── Dockerfile                    # Production image definition
│   ├── docker-compose.yml            # Local dev stack (Nakama + CockroachDB)
│   └── nakama/
│       └── data/
│           ├── local.yml             # Nakama server config
│           └── modules/
│               └── tictactoe.js      # Authoritative match handler + RPCs
```

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend Framework | React 19 + TypeScript | UI, state management, user interaction |
| Build Tool | Vite 8 | Fast bundling and dev server |
| Game Backend | Nakama 3.22 | Authoritative game server, matchmaking, storage |
| Database | PostgreSQL (CockroachDB local) | Persistent player stats and leaderboard |
| Real-Time Comms | WebSocket (Nakama) | Live state sync and match updates |
| Deployment (Frontend) | Vercel | Auto CI/CD, HTTPS, global CDN |
| Deployment (Backend) | Railway | Docker container hosting, managed PostgreSQL |