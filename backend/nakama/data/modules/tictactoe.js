var OpCode = {
  MOVE: 1,
  REMATCH: 2,
};

var MATCH_TTL_SECONDS = 60 * 60;

var WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function emptyBoard() {
  return [null, null, null, null, null, null, null, null, null];
}

function initialState(params) {
  var mode = (params && params.mode) || "classic";
  var timeoutSeconds = Number((params && params.turnTimeoutSeconds) || 30);
  var roomName = (params && params.roomName) || "Open Room";
  return {
    board: emptyBoard(),
    players: {},
    turnUserId: null,
    status: "waiting",
    winnerUserId: null,
    winnerSymbol: null,
    moveCount: 0,
    mode: mode,
    roomName: roomName,
    turnTimeoutSeconds: timeoutSeconds,
    turnDeadlineTick: null,
    currentTick: 0,
    expireTick: MATCH_TTL_SECONDS,
    turnSecondsLeft: null,
    lastError: null,
  };
}

function makeLabel(state) {
  return JSON.stringify({
    roomName: state.roomName,
    mode: state.mode,
    status: state.status,
    players: Object.keys(state.players).length,
  });
}

function publicState(state) {
  var serializedPlayers = {};
  for (var userId in state.players) {
    var p = state.players[userId];
    serializedPlayers[userId] = {
      symbol: p.symbol,
      username: p.username,
      connected: p.connected,
    };
  }

  return {
    board: state.board,
    players: serializedPlayers,
    turnUserId: state.turnUserId,
    status: state.status,
    winnerUserId: state.winnerUserId,
    winnerSymbol: state.winnerSymbol,
    moveCount: state.moveCount,
    mode: state.mode,
    roomName: state.roomName,
    turnTimeoutSeconds: state.turnTimeoutSeconds,
    turnDeadlineTick: state.turnDeadlineTick,
    currentTick: state.currentTick,
    turnSecondsLeft: state.turnSecondsLeft,
    lastError: state.lastError,
  };
}

function computeWinner(board) {
  for (var i = 0; i < WIN_LINES.length; i++) {
    var line = WIN_LINES[i];
    var a = board[line[0]];
    var b = board[line[1]];
    var c = board[line[2]];
    if (a && a === b && b === c) {
      return a;
    }
  }
  return null;
}

function userIdForSymbol(players, symbol) {
  for (var userId in players) {
    if (players[userId].symbol === symbol) {
      return userId;
    }
  }
  return null;
}

function setTurnDeadline(state, tick) {
  if (state.mode !== "timed") {
    state.turnDeadlineTick = null;
    state.turnSecondsLeft = null;
    return;
  }
  state.turnDeadlineTick = tick + state.turnTimeoutSeconds;
  state.turnSecondsLeft = state.turnTimeoutSeconds;
}

function startGameIfReady(state, tick) {
  var ids = Object.keys(state.players);
  if (ids.length < 2 || state.status !== "waiting") {
    return;
  }

  state.players[ids[0]].symbol = "X";
  state.players[ids[1]].symbol = "O";
  state.turnUserId = ids[0];
  state.status = "playing";
  setTurnDeadline(state, tick);
}

function resetForRematch(state, tick) {
  state.board = emptyBoard();
  state.turnUserId = null;
  state.status = "waiting";
  state.winnerUserId = null;
  state.winnerSymbol = null;
  state.moveCount = 0;
  state.lastError = null;

  for (var userId in state.players) {
    state.players[userId].rematch = false;
  }

  startGameIfReady(state, tick);
}

function sendState(dispatcher, state) {
  dispatcher.broadcastMessage(0, JSON.stringify({ type: "state", payload: publicState(state) }), null, null, true);
}

function sendError(dispatcher, presence, message) {
  dispatcher.broadcastMessage(0, JSON.stringify({ type: "error", payload: { message: message } }), [presence], null, true);
}

function updatePlayerStats(nk, winnerUserId, loserUserId) {
  if (!winnerUserId || !loserUserId) {
    return;
  }

  var ids = [winnerUserId, loserUserId];
  var readReq = [];
  for (var i = 0; i < ids.length; i++) {
    readReq.push({ collection: "player_stats", key: "summary", userId: ids[i] });
  }

  var existing = nk.storageRead(readReq);
  var map = {};
  for (var j = 0; j < existing.length; j++) {
    var item = existing[j];
    map[item.userId] = item;
  }

  var writes = [];
  for (var k = 0; k < ids.length; k++) {
    var userId = ids[k];
    var prior = map[userId] ? map[userId].value : null;
    var stats = prior || { wins: 0, losses: 0, streak: 0, games: 0 };

    if (userId === winnerUserId) {
      stats.wins += 1;
      stats.streak += 1;
    } else {
      stats.losses += 1;
      stats.streak = 0;
    }
    stats.games += 1;

    writes.push({
      collection: "player_stats",
      key: "summary",
      userId: userId,
      value: stats,
      permissionRead: 2,
      permissionWrite: 0,
    });

    nk.leaderboardRecordWrite(
      "global_wins",
      userId,
      null,
      stats.wins,
      stats.streak,
      {
        wins: stats.wins,
        losses: stats.losses,
        streak: stats.streak,
      }
    );
  }

  nk.storageWrite(writes);
}

function matchInit(ctx, logger, nk, params) {
  var state = initialState(params || {});
  return {
    state: state,
    tickRate: 1,
    label: makeLabel(state),
  };
}

function matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (tick >= state.expireTick) {
    return {
      state: state,
      accept: false,
      rejectMessage: "Match expired.",
    };
  }

  var count = Object.keys(state.players).length;
  if (count >= 2 && !state.players[presence.userId]) {
    return {
      state: state,
      accept: false,
      rejectMessage: "Match is full.",
    };
  }

  return {
    state: state,
    accept: true,
  };
}

function matchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    var existing = state.players[p.userId];
    state.players[p.userId] = {
      userId: p.userId,
      username: p.username,
      sessionId: p.sessionId,
      symbol: existing ? existing.symbol : null,
      connected: true,
      rematch: false,
    };
  }

  startGameIfReady(state, tick);
  dispatcher.matchLabelUpdate(makeLabel(state));
  sendState(dispatcher, state);
  return { state: state };
}

function matchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  for (var i = 0; i < presences.length; i++) {
    var p = presences[i];
    if (state.players[p.userId]) {
      state.players[p.userId].connected = false;
    }
  }

  if (state.status === "playing") {
    var activeIds = Object.keys(state.players).filter(function (id) {
      return state.players[id].connected;
    });
    if (activeIds.length === 1) {
      state.status = "finished";
      state.winnerUserId = activeIds[0];
      state.winnerSymbol = state.players[activeIds[0]].symbol;
      updatePlayerStats(nk, state.winnerUserId, state.turnUserId === state.winnerUserId ? null : state.turnUserId);
    }
  }

  dispatcher.matchLabelUpdate(makeLabel(state));
  sendState(dispatcher, state);
  return { state: state };
}

function matchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  state.currentTick = tick;

  if (tick >= state.expireTick) {
    state.status = "finished";
    state.winnerUserId = null;
    state.winnerSymbol = null;
    state.lastError = "Match expired after 1 hour.";
    sendState(dispatcher, state);
    return null;
  }

  if (state.mode === "timed" && state.status === "playing" && state.turnDeadlineTick !== null) {
    state.turnSecondsLeft = Math.max(0, state.turnDeadlineTick - tick);
  }

  state.lastError = null;

  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    var sender = message.sender;

    if (message.opCode === OpCode.MOVE) {
      if (state.status !== "playing") {
        sendError(dispatcher, sender, "Game is not active.");
        continue;
      }

      if (sender.userId !== state.turnUserId) {
        sendError(dispatcher, sender, "Not your turn.");
        continue;
      }

      var payload = {};
      try {
        payload = JSON.parse(nk.binaryToString(message.data));
      } catch (err) {
        sendError(dispatcher, sender, "Invalid move payload.");
        continue;
      }

      var index = Number(payload.index);
      if (Number.isNaN(index) || index < 0 || index > 8) {
        sendError(dispatcher, sender, "Invalid cell index.");
        continue;
      }

      if (state.board[index] !== null) {
        sendError(dispatcher, sender, "Cell already taken.");
        continue;
      }

      var symbol = state.players[sender.userId] && state.players[sender.userId].symbol;
      if (!symbol) {
        sendError(dispatcher, sender, "Player is not assigned a symbol.");
        continue;
      }

      state.board[index] = symbol;
      state.moveCount += 1;

      var winnerSymbol = computeWinner(state.board);
      if (winnerSymbol) {
        state.status = "finished";
        state.winnerSymbol = winnerSymbol;
        state.winnerUserId = userIdForSymbol(state.players, winnerSymbol);

        var loserId = null;
        for (var uid in state.players) {
          if (uid !== state.winnerUserId) {
            loserId = uid;
          }
        }

        if (state.winnerUserId && loserId) {
          updatePlayerStats(nk, state.winnerUserId, loserId);
        }
      } else if (state.moveCount === 9) {
        state.status = "finished";
        state.winnerSymbol = null;
        state.winnerUserId = null;
      } else {
        for (var id in state.players) {
          if (id !== sender.userId) {
            state.turnUserId = id;
            break;
          }
        }
        setTurnDeadline(state, tick);
      }

      dispatcher.matchLabelUpdate(makeLabel(state));
      sendState(dispatcher, state);
      continue;
    }

    if (message.opCode === OpCode.REMATCH) {
      if (!state.players[sender.userId]) {
        continue;
      }

      state.players[sender.userId].rematch = true;
      var ids = Object.keys(state.players);
      var ready = ids.length === 2 && state.players[ids[0]].rematch && state.players[ids[1]].rematch;
      if (ready) {
        resetForRematch(state, tick);
      }

      dispatcher.matchLabelUpdate(makeLabel(state));
      sendState(dispatcher, state);
    }
  }

  if (state.mode === "timed" && state.status === "playing" && state.turnDeadlineTick !== null && tick >= state.turnDeadlineTick) {
    var timedOutUserId = state.turnUserId;
    var winnerId = null;
    for (var playerId in state.players) {
      if (playerId !== timedOutUserId) {
        winnerId = playerId;
        break;
      }
    }

    if (winnerId) {
      state.status = "finished";
      state.winnerUserId = winnerId;
      state.winnerSymbol = state.players[winnerId].symbol;
      updatePlayerStats(nk, winnerId, timedOutUserId);
      dispatcher.matchLabelUpdate(makeLabel(state));
      sendState(dispatcher, state);
    }
  }

  return { state: state };
}

function matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  sendState(dispatcher, state);
  return { state: state };
}

function matchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return {
    state: state,
    data: data || "",
  };
}

function getStats(nk, userId) {
  var rows = nk.storageRead([{ collection: "player_stats", key: "summary", userId: userId }]);
  if (rows.length === 0) {
    return { wins: 0, losses: 0, streak: 0, games: 0 };
  }
  return rows[0].value;
}

function listLeaderboard(nk, limit) {
  var max = Number(limit) || 20;
  var listed = nk.leaderboardRecordsList("global_wins", null, max, null, 0, null);
  var raw = (listed && listed.records) || [];

  var userIds = [];
  for (var i = 0; i < raw.length; i++) {
    var ownerId = raw[i].ownerId || raw[i].owner_id;
    if (ownerId) {
      userIds.push(ownerId);
    }
  }

  var usernamesById = {};
  if (userIds.length > 0) {
    try {
      var users = nk.usersGetId(userIds);
      for (var j = 0; j < users.length; j++) {
        var user = users[j];
        usernamesById[user.userId] = user.username;
      }
    } catch (err) {
      // Username lookup is best-effort only.
    }
  }

  var statsById = {};
  if (userIds.length > 0) {
    var readReq = [];
    for (var k = 0; k < userIds.length; k++) {
      readReq.push({ collection: "player_stats", key: "summary", userId: userIds[k] });
    }

    var statsRows = nk.storageRead(readReq);
    for (var m = 0; m < statsRows.length; m++) {
      statsById[statsRows[m].userId] = statsRows[m].value || {};
    }
  }

  var records = [];
  for (var n = 0; n < raw.length; n++) {
    var entry = raw[n];
    var owner = entry.ownerId || entry.owner_id || "";
    var metadata = entry.metadata || {};
    var stats = statsById[owner] || {};

    var wins = Number(metadata.wins);
    if (Number.isNaN(wins)) {
      wins = Number(entry.score || 0);
    }

    var streak = Number(metadata.streak);
    if (Number.isNaN(streak)) {
      streak = Number(entry.subscore || 0);
    }

    var losses = Number(metadata.losses);
    if (Number.isNaN(losses)) {
      losses = Number(stats.losses || 0);
    }

    var username = entry.username || usernamesById[owner] || owner.slice(0, 8);

    records.push({
      owner_id: owner,
      username: username,
      score: wins,
      subscore: streak,
      metadata: {
        wins: wins,
        losses: losses,
        streak: streak,
      },
    });
  }

  return {
    records: records,
  };
}

var rpcGetLeaderboard = function (ctx, logger, nk, payload) {
  var parsed = {};
  if (payload) {
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      parsed = {};
    }
  }
  var result = listLeaderboard(nk, parsed.limit);
  return JSON.stringify(result);
};

var rpcGetMyStats = function (ctx, logger, nk, payload) {
  if (!ctx.userId) {
    throw Error("User must be authenticated.");
  }
  return JSON.stringify(getStats(nk, ctx.userId));
};

var rpcCreateMatch = function (ctx, logger, nk, payload) {
  if (!ctx.userId) {
    throw Error("User must be authenticated.");
  }

  var parsed = {};
  if (payload) {
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      parsed = {};
    }
  }

  var mode = parsed.mode === "timed" ? "timed" : "classic";
  var timeout = Number(parsed.turnTimeoutSeconds || 30);
  var creatorName = (ctx.username || "Player").trim();
  var defaultRoomName = creatorName + "'s Room";
  var roomName = (parsed.roomName || defaultRoomName).trim();
  if (!roomName) {
    roomName = defaultRoomName;
  }
  if (roomName.length > 40) {
    roomName = roomName.slice(0, 40);
  }

  var matchId = nk.matchCreate("tic_tac_toe", {
    mode: mode,
    turnTimeoutSeconds: timeout,
    roomName: roomName,
  });

  return JSON.stringify({ matchId: matchId });
};

function InitModule(ctx, logger, nk, initializer) {
  try {
    try {
      nk.leaderboardCreate("global_wins", false, "desc", "best", "0 0 * * 1", {
        title: "Global Wins",
        category: "tictactoe",
      });
    } catch (err) {
      logger.info("global_wins leaderboard exists or could not be created: " + err);
    }

    initializer.registerMatch("tic_tac_toe", {
      matchInit: matchInit,
      matchJoinAttempt: matchJoinAttempt,
      matchJoin: matchJoin,
      matchLeave: matchLeave,
      matchLoop: matchLoop,
      matchTerminate: matchTerminate,
      matchSignal: matchSignal,
    });
    initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
    initializer.registerRpc("get_my_stats", rpcGetMyStats);
    initializer.registerRpc("create_ttt_match", rpcCreateMatch);

    logger.info("Tic-Tac-Toe authoritative module initialized.");
  } catch (err) {
    logger.error("Tic-Tac-Toe module initialization failed: " + err);
  }
}
