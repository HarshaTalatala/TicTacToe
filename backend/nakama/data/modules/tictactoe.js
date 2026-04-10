var OpCode = {
  MOVE: 1,
  REMATCH: 2,
};

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
  return {
    board: emptyBoard(),
    players: {},
    turnUserId: null,
    status: "waiting",
    winnerUserId: null,
    winnerSymbol: null,
    moveCount: 0,
    mode: mode,
    turnTimeoutSeconds: timeoutSeconds,
    turnDeadlineTick: null,
    currentTick: 0,
    turnSecondsLeft: null,
    lastError: null,
  };
}

function makeLabel(state) {
  return JSON.stringify({
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
  var records = nk.leaderboardRecordsList("global_wins", null, max, null, 0, null);
  return records;
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
  var matchId = nk.matchCreate("tic_tac_toe", {
    mode: mode,
    turnTimeoutSeconds: timeout,
  });

  return JSON.stringify({ matchId: matchId });
};

var InitModule = function (ctx, logger, nk, initializer) {
  try {
    nk.leaderboardCreate("global_wins", false, "desc", "best", "0 0 * * 1", {
      title: "Global Wins",
      category: "tictactoe",
    });
  } catch (err) {
    logger.info("global_wins leaderboard exists or could not be created: %v", err);
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
};
