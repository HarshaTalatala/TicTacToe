import { useMemo, useRef, useState } from 'react'
import { Client } from '@heroiclabs/nakama-js'
import type { Session, Socket } from '@heroiclabs/nakama-js'
import './App.css'

type CellValue = 'X' | 'O' | null

type PlayerView = {
  symbol: 'X' | 'O' | null
  username: string
  connected: boolean
}

type MatchStateView = {
  board: CellValue[]
  players: Record<string, PlayerView>
  turnUserId: string | null
  status: 'waiting' | 'playing' | 'finished'
  winnerUserId: string | null
  winnerSymbol: 'X' | 'O' | null
  moveCount: number
  mode: 'classic' | 'timed'
  turnTimeoutSeconds: number
  turnSecondsLeft: number | null
  lastError: string | null
}

type RoomItem = {
  matchId: string
  roomName: string
  mode: 'classic' | 'timed'
  status: 'waiting' | 'playing' | 'finished' | 'unknown'
  players: number
  size: number
}

type LeaderboardRecord = {
  owner_id: string
  score: number
  subscore: number
  username?: string
  metadata?: {
    wins?: number
    losses?: number
    streak?: number
  }
}

const NAKAMA_HOST = import.meta.env.VITE_NAKAMA_HOST || 'lovely-joy-production-efed.up.railway.app'
const NAKAMA_PORT = import.meta.env.VITE_NAKAMA_PORT || '443'
const NAKAMA_SERVER_KEY = import.meta.env.VITE_NAKAMA_SERVER_KEY || 'devkey'

function getOrCreateDeviceId(username: string) {
  const safeUsername = username.trim().toLowerCase() || 'guest'
  const key = 'ttt_device_id_' + safeUsername
  const existing = localStorage.getItem(key)
  if (existing) {
    return existing
  }

  const generated = crypto.randomUUID()
  localStorage.setItem(key, generated)
  return generated
}

function decodeMatchPayload(data: unknown) {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data))
  }

  if (data instanceof Uint8Array) {
    return new TextDecoder().decode(data)
  }

  // Some websocket implementations provide typed array views.
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }

  return ''
}

function parseRoomLabel(label: string | undefined) {
  if (!label) {
    return { roomName: 'Open Room', mode: 'classic' as const, status: 'unknown' as const, players: 0 }
  }

  try {
    const parsed = JSON.parse(label) as {
      roomName?: string
      mode?: 'classic' | 'timed'
      status?: 'waiting' | 'playing' | 'finished'
      players?: number
    }

    return {
      roomName: (parsed.roomName || 'Open Room').trim() || 'Open Room',
      mode: parsed.mode || 'classic',
      status: parsed.status || 'unknown',
      players: Number(parsed.players || 0),
    }
  } catch {
    return { roomName: 'Open Room', mode: 'classic' as const, status: 'unknown' as const, players: 0 }
  }
}

function normalizeUsername(input: string) {
  const compact = input.trim().replace(/\s+/g, '_')
  const cleaned = compact.replace(/[^a-zA-Z0-9_-]/g, '')
  if (cleaned.length > 0) {
    return cleaned.slice(0, 24)
  }

  return 'player_' + Math.floor(Math.random() * 10000)
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const statusText = (error as { statusText?: string }).statusText
    const status = (error as { status?: number }).status
    if (status || statusText) {
      return 'HTTP ' + (status || '') + ' ' + (statusText || '').trim()
    }
  }

  return 'Unknown sign-in error.'
}

function App() {
  const clientRef = useRef<Client | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const sessionRef = useRef<Session | null>(null)

  const [username, setUsername] = useState('')
  const [connectedUsername, setConnectedUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusLine, setStatusLine] = useState('Sign in to start a multiplayer session.')

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null)
  const [state, setState] = useState<MatchStateView | null>(null)
  const [rooms, setRooms] = useState<RoomItem[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardRecord[]>([])

  const [modeSelection, setModeSelection] = useState<'classic' | 'timed'>('classic')

  const userId = (sessionRef.current as Session & { user_id?: string })?.user_id || null
  const me = userId && state ? state.players[userId] : null
  const isMyTurn = Boolean(state && userId && state.turnUserId === userId && state.status === 'playing')

  const playerList = useMemo(() => {
    if (!state) {
      return [] as Array<[string, PlayerView]>
    }

    return Object.entries(state.players)
  }, [state])

  const topLeaderboard = useMemo(() => leaderboard.slice(0, 5), [leaderboard])

  async function signIn() {
    if (!username.trim()) {
      setStatusLine('Enter a username first.')
      return
    }

    const normalizedUsername = normalizeUsername(username)

    setLoading(true)
    try {
      const client = new Client(NAKAMA_SERVER_KEY, NAKAMA_HOST, NAKAMA_PORT, true)
      const session = await client.authenticateDevice(getOrCreateDeviceId(normalizedUsername), true, normalizedUsername)
      const socket = client.createSocket(true, true)
      await socket.connect(session, false)

      socket.onmatchdata = (message: any) => {
        const raw = decodeMatchPayload(message.data)
        if (!raw) {
          return
        }

        try {
          const parsed = JSON.parse(raw)
          if (parsed.type === 'state') {
            setState(parsed.payload as MatchStateView)
          }

          if (parsed.type === 'error') {
            setStatusLine(parsed.payload?.message || 'Server rejected the action.')
          }
        } catch {
          setStatusLine('Received malformed match data from server.')
        }
      }

      socket.onmatchmakermatched = async (matched: any) => {
        const joined = await socket.joinMatch(matched.token)
        setActiveMatchId(joined.match_id)
        setStatusLine('Matched with an opponent. Match joined.')
      }

      clientRef.current = client
      sessionRef.current = session
      socketRef.current = socket
      setConnectedUsername(normalizedUsername)
      if (normalizedUsername !== username.trim()) {
        setUsername(normalizedUsername)
      }
      setStatusLine('Connected. Create a room, join a room, or auto-match.')

      await refreshRooms(client, session)
      await refreshLeaderboard(client, session)
    } catch (error) {
      setStatusLine('Sign in failed: ' + getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  async function refreshRooms(client?: Client, session?: Session) {
    const useClient = client || clientRef.current
    const useSession = session || sessionRef.current

    if (!useClient || !useSession) {
      return
    }

    try {
      const result: any = await useClient.listMatches(useSession, 20, true, undefined, 0, 2, '')
      const mapped = (result.matches || []).map((match: any) => {
        const labelData = parseRoomLabel(match.label)
        return {
          matchId: match.match_id,
          roomName: labelData.roomName,
          mode: labelData.mode,
          status: labelData.status,
          players: labelData.players,
          size: Number(match.size || 0),
        }
      })
      setRooms(mapped)
    } catch (error) {
      setStatusLine('Could not refresh rooms right now.')
    }
  }

  async function refreshLeaderboard(client?: Client, session?: Session) {
    const useClient = client || clientRef.current
    const useSession = session || sessionRef.current

    if (!useClient || !useSession) {
      return
    }

    try {
      const rpc = await useClient.rpc(useSession, 'get_leaderboard', { limit: 5 })
      let body: { records?: LeaderboardRecord[] } = {}
      const payload: unknown = rpc.payload

      if (typeof payload === 'string' && payload.trim().length > 0) {
        body = JSON.parse(payload) as { records?: LeaderboardRecord[] }
      } else if (payload && typeof payload === 'object') {
        body = payload as { records?: LeaderboardRecord[] }
      }

      const normalized = (body.records || []).map((entry) => ({
        owner_id: entry.owner_id || 'unknown-player',
        username: entry.username,
        score: Number(entry.score || 0),
        subscore: Number(entry.subscore || 0),
        metadata: {
          wins: Number(entry.metadata?.wins ?? entry.score ?? 0),
          losses: Number(entry.metadata?.losses ?? 0),
          streak: Number(entry.metadata?.streak ?? entry.subscore ?? 0),
        },
      }))

      setLeaderboard(normalized.slice(0, 5))
    } catch (error) {
      setStatusLine('Leaderboard is not available yet.')
    }
  }

  async function createRoom(mode: 'classic' | 'timed') {
    const useClient = clientRef.current
    const useSession = sessionRef.current
    const socket = socketRef.current
    if (!useClient || !useSession || !socket) {
      return
    }

    try {
      const rpc = await useClient.rpc(useSession, 'create_ttt_match', {
        mode,
        turnTimeoutSeconds: mode === 'timed' ? 30 : 0,
      })
      const body = (rpc.payload || {}) as { matchId?: string }
      if (!body.matchId) {
        throw new Error('No match id returned by backend')
      }

      const joined: any = await socket.joinMatch(body.matchId)
      setActiveMatchId(joined.match_id)
      setStatusLine('Room created. Waiting for second player.')
      await refreshRooms()
    } catch (error) {
      setStatusLine('Room creation failed.')
    }
  }

  async function joinRoom(matchId: string) {
    const socket = socketRef.current
    if (!socket) {
      return
    }

    try {
      await socket.joinMatch(matchId)
      setActiveMatchId(matchId)
      setState(null)
      setStatusLine('Joined room successfully.')
      await refreshRooms()
    } catch (error) {
      setStatusLine('Join failed. Room may be full or stale.')
    }
  }

  async function autoMatch(mode: 'classic' | 'timed') {
    const socket = socketRef.current
    if (!socket) {
      return
    }

    try {
      await socket.addMatchmaker('+properties.mode:' + mode, 2, 2, { mode }, {})
      setStatusLine('Searching for opponent via matchmaker...')
    } catch (error) {
      setStatusLine('Auto-match failed to start.')
    }
  }

  async function sendMove(index: number) {
    const socket = socketRef.current
    if (!socket || !activeMatchId || !isMyTurn) {
      return
    }

    try {
      await socket.sendMatchState(activeMatchId, 1, JSON.stringify({ index }))
    } catch (error) {
      setStatusLine('Move could not be sent.')
    }
  }

  async function requestRematch() {
    const socket = socketRef.current
    if (!socket || !activeMatchId) {
      return
    }

    await socket.sendMatchState(activeMatchId, 2, JSON.stringify({ rematch: true }))
  }

  return (
    <main className={connectedUsername ? 'app-shell app-live' : 'app-shell app-guest'}>
      <section className="panel hero-panel">
        <h1>Nakama Tic-Tac-Toe</h1>
        <p>Server-authoritative multiplayer with room discovery, timed mode, and leaderboard support.</p>
        <div className="status-bar">
          <span>Status</span>
          <p className="status">{statusLine}</p>
        </div>
      </section>

      {!connectedUsername && (
        <section className="panel auth-panel">
          <div className="auth-row">
            <h2>Enter Username</h2>
            <input
              type="text"
              value={username}
              maxLength={24}
              placeholder="Enter your username"
              onChange={(event) => setUsername(event.target.value)}
            />
            <button type="button" onClick={signIn} disabled={loading}>
              {loading ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </section>
      )}

      {connectedUsername && (
        <>
          <section className="panel control-panel">
            <h2>Matchmaking</h2>
            <p className="panel-note">Create a room, auto-match, or join an available room.</p>
            <div className="matchmaking-toolbar">
              <div className="mode-picker">
                <label htmlFor="mode-selection">Mode</label>
                <select
                  id="mode-selection"
                  value={modeSelection}
                  onChange={(e) => setModeSelection(e.target.value as 'classic' | 'timed')}
                >
                  <option value="classic">Classic</option>
                  <option value="timed">Timed (30s)</option>
                </select>
              </div>

              <div className="match-actions">
                <button type="button" onClick={() => createRoom(modeSelection)}>
                  Create Room
                </button>
                <button type="button" onClick={() => autoMatch(modeSelection)}>
                  Auto Match
                </button>
                <button type="button" onClick={() => refreshRooms()}>
                  Refresh Rooms
                </button>
              </div>
            </div>

            <div className="rooms-header">
              <h3>Open Rooms</h3>
              <span>{rooms.length} room{rooms.length === 1 ? '' : 's'}</span>
            </div>

            <div className={rooms.length === 1 ? 'room-list room-list-single' : 'room-list'}>
              {rooms.length === 0 && <p>No rooms found. Create one to start.</p>}
              {rooms.map((room) => (
                <div key={room.matchId} className="room-item">
                  <div>
                    <strong>{room.roomName}</strong>
                    <span>Mode: {room.mode}</span>
                    <span>Status: {room.status}</span>
                    <span>Players: {room.players || room.size}/2</span>
                  </div>
                  <button type="button" onClick={() => joinRoom(room.matchId)} disabled={room.size >= 2}>
                    Join
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="panel game-panel">
            <h2>Game Board</h2>
            <p className="panel-note">Live server-authoritative match state and turn status.</p>
            <div className="game-meta">
              <span>Player: {connectedUsername}</span>
              <span>Mode: {state?.mode || modeSelection}</span>
              <span>Match: {activeMatchId ? activeMatchId.slice(0, 12) : 'Not in match'}</span>
              <span>Your symbol: {me?.symbol || '-'}</span>
              <span>Turn: {state?.turnUserId ? state.players[state.turnUserId]?.username || state.turnUserId : '-'}</span>
              {state?.mode === 'timed' && <span>Timer: {state.turnSecondsLeft ?? '-'}s</span>}
            </div>

            <div className="board" role="grid" aria-label="tic tac toe board">
              {(state?.board || Array.from({ length: 9 }, () => null)).map((value, index) => (
                <button
                  type="button"
                  key={index}
                  className="cell"
                  disabled={!isMyTurn || Boolean(value) || state?.status !== 'playing'}
                  onClick={() => sendMove(index)}
                >
                  {value || ''}
                </button>
              ))}
            </div>

            {!state && <p className="status">Waiting for match state from server...</p>}

            {state?.status === 'finished' && (
              <div className="result-box">
                {state.winnerUserId
                  ? 'Winner: ' + (state.players[state.winnerUserId]?.username || state.winnerUserId)
                  : 'Result: Draw'}
                <button type="button" onClick={requestRematch}>
                  Request Rematch
                </button>
              </div>
            )}

            {playerList.length > 0 && (
              <div className="players">
                {playerList.map(([id, player]) => (
                  <div key={id} className="player-card">
                    <strong>{player.username}</strong>
                    <span>Symbol: {player.symbol || '-'}</span>
                    <span>{player.connected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel leaderboard-panel">
            <div className="leaderboard-head">
              <h2>Top 5 Leaderboard</h2>
              <button type="button" onClick={() => refreshLeaderboard()}>
                Refresh
              </button>
            </div>
            {topLeaderboard.length === 0 && <p>No leaderboard records yet.</p>}
            {topLeaderboard.length > 0 && (
              <div className="table-wrap">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Player</th>
                      <th>Wins</th>
                      <th>Streak</th>
                      <th className="hide-mobile">Losses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topLeaderboard.map((entry, index) => {
                      const ownerId = entry.owner_id || 'unknown-player'
                      const playerName = entry.username || ownerId.slice(0, 8)
                      const wins = entry.metadata?.wins ?? entry.score ?? 0
                      const streak = entry.metadata?.streak ?? entry.subscore ?? 0
                      const losses = entry.metadata?.losses ?? 0

                      return (
                        <tr key={ownerId + '-' + index} className={index === 0 ? 'leaderboard-row-top' : ''}>
                          <td>
                            <span className="rank-pill">#{index + 1}</span>
                          </td>
                          <td>{playerName}</td>
                          <td>{wins}</td>
                          <td>{streak}</td>
                          <td className="hide-mobile">{losses}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
