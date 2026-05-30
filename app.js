"use strict";

const PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
};

const NAMES = { k: "King", q: "Queen", r: "Rook", b: "Bishop", n: "Knight", p: "Pawn" };
const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const HUMAN = "w";
const AI = "b";
const FILES = "abcdefgh";

const boardEl = document.getElementById("board");
const statusText = document.getElementById("statusText");
const detailText = document.getElementById("detailText");
const turnPill = document.getElementById("turnPill");
const depthSelect = document.getElementById("depthSelect");
const newGameBtn = document.getElementById("newGameBtn");
const undoBtn = document.getElementById("undoBtn");
const moveLogEl = document.getElementById("moveLog");
const whiteCapturedEl = document.getElementById("whiteCaptured");
const blackCapturedEl = document.getElementById("blackCaptured");
const engineStatusEl = document.getElementById("engineStatus");

let game = createInitialState();
let selected = null;
let legalForSelected = [];
let moveHistory = [];
let isAiThinking = false;
let stockfish = null;
let stockfishReady = false;
let stockfishFailed = false;
let pendingStockfishSearch = null;

function createInitialState() {
  return {
    board: [
      row("br bn bb bq bk bb bn br"),
      row("bp bp bp bp bp bp bp bp"),
      row("-- -- -- -- -- -- -- --"),
      row("-- -- -- -- -- -- -- --"),
      row("-- -- -- -- -- -- -- --"),
      row("-- -- -- -- -- -- -- --"),
      row("wp wp wp wp wp wp wp wp"),
      row("wr wn wb wq wk wb wn wr")
    ],
    turn: "w",
    castling: {
      w: { kingSide: true, queenSide: true },
      b: { kingSide: true, queenSide: true }
    },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    captured: { w: [], b: [] },
    lastMove: null,
    notation: []
  };
}

function row(text) {
  return text.split(" ").map(token => token === "--" ? null : { color: token[0], type: token[1] });
}

function cloneState(state) {
  return {
    board: state.board.map(boardRow => boardRow.map(piece => piece ? { ...piece } : null)),
    turn: state.turn,
    castling: {
      w: { ...state.castling.w },
      b: { ...state.castling.b }
    },
    enPassant: state.enPassant ? { ...state.enPassant } : null,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
    captured: {
      w: [...state.captured.w],
      b: [...state.captured.b]
    },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    notation: [...state.notation]
  };
}

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function sameSquare(a, b) {
  return a && b && a.r === b.r && a.c === b.c;
}

function algebraic(square) {
  return `${FILES[square.c]}${8 - square.r}`;
}

function render() {
  const legalMap = new Map(legalForSelected.map(move => [`${move.to.r},${move.to.c}`, move]));
  const checkSquare = findKing(game, game.turn);
  const showCheck = checkSquare && isKingInCheck(game, game.turn);

  boardEl.innerHTML = "";
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const square = document.createElement("button");
      const piece = game.board[r][c];
      const move = legalMap.get(`${r},${c}`);
      square.type = "button";
      square.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
      square.dataset.r = String(r);
      square.dataset.c = String(c);
      square.setAttribute("role", "gridcell");
      square.setAttribute("aria-label", `${algebraic({ r, c })}${piece ? ` ${piece.color === "w" ? "White" : "Black"} ${NAMES[piece.type]}` : ""}`);

      if (selected && selected.r === r && selected.c === c) square.classList.add("selected");
      if (game.lastMove && (sameSquare(game.lastMove.from, { r, c }) || sameSquare(game.lastMove.to, { r, c }))) square.classList.add("last-move");
      if (showCheck && checkSquare.r === r && checkSquare.c === c) square.classList.add("in-check");
      if (move) square.classList.add(move.captured || move.isEnPassant ? "legal-capture" : "legal-move");

      if (piece) {
        const pieceEl = document.createElement("span");
        pieceEl.className = `piece ${piece.color === "w" ? "white" : "black"}`;
        pieceEl.textContent = PIECES[piece.color][piece.type];
        square.append(pieceEl);
      }

      square.addEventListener("click", () => handleSquareClick(r, c));
      boardEl.append(square);
    }
  }

  renderStatus();
  renderCaptures();
  renderMoveLog();
}

function renderStatus() {
  const legal = generateLegalMoves(game, game.turn);
  const inCheck = isKingInCheck(game, game.turn);

  turnPill.textContent = `${game.turn === "w" ? "White" : "Black"} to move`;
  undoBtn.disabled = isAiThinking || moveHistory.length === 0;
  depthSelect.disabled = isAiThinking;
  newGameBtn.disabled = isAiThinking;
  renderEngineStatus();

  if (legal.length === 0 && inCheck) {
    statusText.textContent = game.turn === HUMAN ? "Checkmate. Black wins." : "Checkmate. White wins.";
    detailText.textContent = "Start a new game or undo the last round to try a different line.";
    return;
  }

  if (legal.length === 0) {
    statusText.textContent = "Stalemate.";
    detailText.textContent = "The side to move has no legal move and is not in check.";
    return;
  }

  if (isAiThinking) {
    statusText.textContent = "AI is calculating.";
    detailText.textContent = stockfishReady
      ? `Stockfish is searching to depth ${depthSelect.value}.`
      : "Stockfish is unavailable, so the fallback minimax engine is searching.";
    return;
  }

  if (game.turn === HUMAN) {
    statusText.textContent = inCheck ? "You are in check." : "Your move as White.";
    detailText.textContent = selected ? "Choose a highlighted square to move, or select another white piece." : "Select a white piece, then choose one of its highlighted legal moves.";
  } else {
    statusText.textContent = inCheck ? "Black is in check." : "Black to move.";
    detailText.textContent = "The AI will move automatically.";
  }

}

function renderEngineStatus() {
  if (!engineStatusEl) return;
  if (stockfishReady) engineStatusEl.textContent = "Stockfish ready";
  else if (stockfishFailed) engineStatusEl.textContent = "Using minimax fallback";
  else engineStatusEl.textContent = "Starting Stockfish...";
}

function renderCaptures() {
  whiteCapturedEl.textContent = game.captured.w.map(piece => PIECES[piece.color][piece.type]).join(" ");
  blackCapturedEl.textContent = game.captured.b.map(piece => PIECES[piece.color][piece.type]).join(" ");
}

function renderMoveLog() {
  moveLogEl.innerHTML = "";
  for (let i = 0; i < game.notation.length; i += 2) {
    const item = document.createElement("li");
    const white = game.notation[i] || "";
    const black = game.notation[i + 1] || "";
    item.textContent = black ? `${white}   ${black}` : white;
    moveLogEl.append(item);
  }
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

function handleSquareClick(r, c) {
  if (isAiThinking || game.turn !== HUMAN) return;

  const piece = game.board[r][c];
  const chosenMove = legalForSelected.find(move => move.to.r === r && move.to.c === c);

  if (chosenMove) {
    commitMove(chosenMove);
    clearSelection();
    render();
    requestAiMove();
    return;
  }

  if (piece && piece.color === HUMAN) {
    selected = { r, c };
    legalForSelected = generateLegalMoves(game, HUMAN).filter(move => move.from.r === r && move.from.c === c);
  } else {
    clearSelection();
  }

  render();
}

function clearSelection() {
  selected = null;
  legalForSelected = [];
}

function commitMove(move) {
  moveHistory.push(cloneState(game));
  game = makeMove(game, move);
}

function requestAiMove() {
  if (game.turn !== AI || generateLegalMoves(game, AI).length === 0) {
    render();
    return;
  }

  isAiThinking = true;
  const searchState = cloneState(game);
  render();

  window.setTimeout(async () => {
    const depth = Number(depthSelect.value);
    let best = null;
    if (stockfishReady) {
      try {
        best = await findBestStockfishMove(searchState, depth);
      } catch (error) {
        console.warn("Stockfish search failed, using fallback minimax.", error);
        stockfishFailed = true;
        stockfishReady = false;
      }
    }

    if (!best) {
      best = findBestAiMove(searchState, Math.min(4, depth));
    }

    if (best) {
      moveHistory.push(cloneState(game));
      game = makeMove(game, best);
    }
    isAiThinking = false;
    render();
  }, 120);
}

function initStockfish() {
  if (typeof Worker === "undefined") {
    stockfishFailed = true;
    return;
  }

  try {
    stockfish = new Worker("stockfish.js");
  } catch (error) {
    console.warn("Could not start Stockfish worker.", error);
    stockfishFailed = true;
    return;
  }

  stockfish.addEventListener("message", event => {
    const message = String(event.data || "");
    if (message === "uciok" || message === "readyok") {
      stockfishReady = true;
      stockfishFailed = false;
      render();
      return;
    }

    if (message.startsWith("bestmove ") && pendingStockfishSearch) {
      const search = pendingStockfishSearch;
      pendingStockfishSearch = null;
      const uciMove = message.split(/\s+/)[1];
      search.resolve(moveFromUci(search.state, uciMove));
    }
  });

  stockfish.addEventListener("error", error => {
    console.warn("Stockfish worker error.", error);
    stockfishFailed = true;
    stockfishReady = false;
    if (pendingStockfishSearch) {
      pendingStockfishSearch.reject(error);
      pendingStockfishSearch = null;
    }
    render();
  });

  stockfish.postMessage("uci");
  stockfish.postMessage("isready");
}

function findBestStockfishMove(state, depth) {
  if (!stockfish || !stockfishReady) return Promise.reject(new Error("Stockfish is not ready."));

  return new Promise((resolve, reject) => {
    const searchToken = {};
    if (pendingStockfishSearch) {
      pendingStockfishSearch.reject(new Error("A newer Stockfish search replaced this search."));
    }

    const timeout = window.setTimeout(() => {
      if (pendingStockfishSearch?.token === searchToken) {
        pendingStockfishSearch = null;
        reject(new Error("Stockfish search timed out."));
      }
    }, 12000);

    pendingStockfishSearch = {
      token: searchToken,
      state: cloneState(state),
      resolve: move => {
        window.clearTimeout(timeout);
        resolve(move);
      },
      reject: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    };

    stockfish.postMessage("ucinewgame");
    stockfish.postMessage(`position fen ${stateToFen(state)}`);
    stockfish.postMessage(`go depth ${depth}`);
  });
}

function stateToFen(state) {
  const rows = state.board.map(boardRow => {
    let fenRow = "";
    let empty = 0;
    for (const piece of boardRow) {
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        fenRow += String(empty);
        empty = 0;
      }
      const letter = piece.type === "n" ? "n" : piece.type;
      fenRow += piece.color === "w" ? letter.toUpperCase() : letter;
    }
    return fenRow + (empty ? String(empty) : "");
  });

  const castling =
    `${state.castling.w.kingSide ? "K" : ""}${state.castling.w.queenSide ? "Q" : ""}` +
    `${state.castling.b.kingSide ? "k" : ""}${state.castling.b.queenSide ? "q" : ""}`;
  const enPassant = state.enPassant ? algebraic(state.enPassant) : "-";
  return `${rows.join("/")} ${state.turn} ${castling || "-"} ${enPassant} ${state.halfmoveClock} ${state.fullmoveNumber}`;
}

function moveFromUci(state, uciMove) {
  if (!uciMove || uciMove === "(none)") return null;
  const from = squareFromUci(uciMove.slice(0, 2));
  const to = squareFromUci(uciMove.slice(2, 4));
  const promotion = uciMove[4] || null;
  return generateLegalMoves(state, state.turn).find(move =>
    move.from.r === from.r &&
    move.from.c === from.c &&
    move.to.r === to.r &&
    move.to.c === to.c &&
    (move.promotion || null) === promotion
  ) || null;
}

function squareFromUci(square) {
  return {
    r: 8 - Number(square[1]),
    c: FILES.indexOf(square[0])
  };
}

function generateLegalMoves(state, color) {
  const moves = generatePseudoMoves(state, color);
  return moves.filter(move => !isKingInCheck(makeMove(state, move, { skipNotation: true }), color));
}

function generatePseudoMoves(state, color) {
  const moves = [];
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = state.board[r][c];
      if (!piece || piece.color !== color) continue;
      if (piece.type === "p") addPawnMoves(state, moves, r, c, piece);
      if (piece.type === "n") addKnightMoves(state, moves, r, c, piece);
      if (piece.type === "b") addSlidingMoves(state, moves, r, c, piece, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
      if (piece.type === "r") addSlidingMoves(state, moves, r, c, piece, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
      if (piece.type === "q") addSlidingMoves(state, moves, r, c, piece, [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]);
      if (piece.type === "k") addKingMoves(state, moves, r, c, piece);
    }
  }
  return moves;
}

function addPawnMoves(state, moves, r, c, piece) {
  const dir = piece.color === "w" ? -1 : 1;
  const startRow = piece.color === "w" ? 6 : 1;
  const promotionRow = piece.color === "w" ? 0 : 7;
  const one = r + dir;
  const two = r + dir * 2;

  if (inBounds(one, c) && !state.board[one][c]) {
    pushMove(moves, state, r, c, one, c, { promotion: one === promotionRow ? "q" : null });
    if (r === startRow && !state.board[two][c]) {
      pushMove(moves, state, r, c, two, c, { isDoublePawn: true });
    }
  }

  for (const dc of [-1, 1]) {
    const nr = r + dir;
    const nc = c + dc;
    if (!inBounds(nr, nc)) continue;

    const target = state.board[nr][nc];
    if (target && target.color !== piece.color) {
      pushMove(moves, state, r, c, nr, nc, { promotion: nr === promotionRow ? "q" : null });
    }

    if (state.enPassant && state.enPassant.r === nr && state.enPassant.c === nc) {
      pushMove(moves, state, r, c, nr, nc, { isEnPassant: true, captured: { color: opposite(piece.color), type: "p" } });
    }
  }
}

function addKnightMoves(state, moves, r, c, piece) {
  const jumps = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  for (const [dr, dc] of jumps) pushMove(moves, state, r, c, r + dr, c + dc);
}

function addSlidingMoves(state, moves, r, c, piece, dirs) {
  for (const [dr, dc] of dirs) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const target = state.board[nr][nc];
      if (!target) {
        pushMove(moves, state, r, c, nr, nc);
      } else {
        if (target.color !== piece.color) pushMove(moves, state, r, c, nr, nc);
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
}

function addKingMoves(state, moves, r, c, piece) {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr || dc) pushMove(moves, state, r, c, r + dr, c + dc);
    }
  }

  const homeRow = piece.color === "w" ? 7 : 0;
  const enemy = opposite(piece.color);
  if (r !== homeRow || c !== 4 || isSquareAttacked(state, homeRow, 4, enemy)) return;

  if (
    state.castling[piece.color].kingSide &&
    !state.board[homeRow][5] &&
    !state.board[homeRow][6] &&
    state.board[homeRow][7]?.type === "r" &&
    state.board[homeRow][7]?.color === piece.color &&
    !isSquareAttacked(state, homeRow, 5, enemy) &&
    !isSquareAttacked(state, homeRow, 6, enemy)
  ) {
    pushMove(moves, state, r, c, homeRow, 6, { isCastle: "kingSide" });
  }

  if (
    state.castling[piece.color].queenSide &&
    !state.board[homeRow][1] &&
    !state.board[homeRow][2] &&
    !state.board[homeRow][3] &&
    state.board[homeRow][0]?.type === "r" &&
    state.board[homeRow][0]?.color === piece.color &&
    !isSquareAttacked(state, homeRow, 3, enemy) &&
    !isSquareAttacked(state, homeRow, 2, enemy)
  ) {
    pushMove(moves, state, r, c, homeRow, 2, { isCastle: "queenSide" });
  }
}

function pushMove(moves, state, fromR, fromC, toR, toC, extras = {}) {
  if (!inBounds(toR, toC)) return;
  const piece = state.board[fromR][fromC];
  const target = state.board[toR][toC];
  if (!piece || (target && target.color === piece.color)) return;

  moves.push({
    from: { r: fromR, c: fromC },
    to: { r: toR, c: toC },
    piece: { ...piece },
    captured: extras.captured || (target ? { ...target } : null),
    promotion: extras.promotion || null,
    isEnPassant: Boolean(extras.isEnPassant),
    isCastle: extras.isCastle || null,
    isDoublePawn: Boolean(extras.isDoublePawn)
  });
}

function makeMove(state, move, options = {}) {
  const next = cloneState(state);
  const piece = next.board[move.from.r][move.from.c];
  const captured = move.isEnPassant
    ? next.board[move.from.r][move.to.c]
    : next.board[move.to.r][move.to.c];

  next.board[move.from.r][move.from.c] = null;

  if (move.isEnPassant) {
    next.board[move.from.r][move.to.c] = null;
  }

  next.board[move.to.r][move.to.c] = {
    color: piece.color,
    type: move.promotion || piece.type
  };

  if (move.isCastle === "kingSide") {
    next.board[move.to.r][5] = next.board[move.to.r][7];
    next.board[move.to.r][7] = null;
  }

  if (move.isCastle === "queenSide") {
    next.board[move.to.r][3] = next.board[move.to.r][0];
    next.board[move.to.r][0] = null;
  }

  updateCastlingRights(next, piece, move, captured);
  next.enPassant = move.isDoublePawn ? { r: (move.from.r + move.to.r) / 2, c: move.from.c } : null;
  next.halfmoveClock = piece.type === "p" || captured ? 0 : next.halfmoveClock + 1;
  next.turn = opposite(state.turn);
  if (next.turn === "w") next.fullmoveNumber += 1;
  next.lastMove = { from: { ...move.from }, to: { ...move.to } };

  if (captured) {
    next.captured[piece.color].push({ ...captured });
  }

  if (!options.skipNotation) {
    next.notation.push(describeMove(state, move, captured));
  }

  return next;
}

function updateCastlingRights(state, piece, move, captured) {
  if (piece.type === "k") {
    state.castling[piece.color].kingSide = false;
    state.castling[piece.color].queenSide = false;
  }

  if (piece.type === "r") {
    if (piece.color === "w" && move.from.r === 7 && move.from.c === 0) state.castling.w.queenSide = false;
    if (piece.color === "w" && move.from.r === 7 && move.from.c === 7) state.castling.w.kingSide = false;
    if (piece.color === "b" && move.from.r === 0 && move.from.c === 0) state.castling.b.queenSide = false;
    if (piece.color === "b" && move.from.r === 0 && move.from.c === 7) state.castling.b.kingSide = false;
  }

  if (captured?.type === "r") {
    const color = captured.color;
    if (color === "w" && move.to.r === 7 && move.to.c === 0) state.castling.w.queenSide = false;
    if (color === "w" && move.to.r === 7 && move.to.c === 7) state.castling.w.kingSide = false;
    if (color === "b" && move.to.r === 0 && move.to.c === 0) state.castling.b.queenSide = false;
    if (color === "b" && move.to.r === 0 && move.to.c === 7) state.castling.b.kingSide = false;
  }
}

function describeMove(state, move, captured) {
  if (move.isCastle === "kingSide") return "O-O";
  if (move.isCastle === "queenSide") return "O-O-O";

  const piece = state.board[move.from.r][move.from.c];
  const name = piece.type === "p" ? "" : piece.type.toUpperCase();
  const captureMark = captured ? "x" : "";
  const fromFile = piece.type === "p" && captured ? FILES[move.from.c] : "";
  const promo = move.promotion ? `=${move.promotion.toUpperCase()}` : "";
  const next = makeMove(state, move, { skipNotation: true });
  const enemyInCheck = isKingInCheck(next, next.turn);
  const enemyMoves = generateLegalMoves(next, next.turn);
  const suffix = enemyInCheck && enemyMoves.length === 0 ? "#" : enemyInCheck ? "+" : "";

  return `${name}${fromFile}${captureMark}${algebraic(move.to)}${promo}${suffix}`;
}

function findKing(state, color) {
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = state.board[r][c];
      if (piece?.color === color && piece.type === "k") return { r, c };
    }
  }
  return null;
}

function isKingInCheck(state, color) {
  const king = findKing(state, color);
  return king ? isSquareAttacked(state, king.r, king.c, opposite(color)) : false;
}

function isSquareAttacked(state, targetR, targetC, byColor) {
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = state.board[r][c];
      if (!piece || piece.color !== byColor) continue;

      if (piece.type === "p") {
        const dir = piece.color === "w" ? -1 : 1;
        if (r + dir === targetR && Math.abs(c - targetC) === 1) return true;
      }

      if (piece.type === "n") {
        const dr = Math.abs(r - targetR);
        const dc = Math.abs(c - targetC);
        if ((dr === 2 && dc === 1) || (dr === 1 && dc === 2)) return true;
      }

      if (piece.type === "k" && Math.max(Math.abs(r - targetR), Math.abs(c - targetC)) === 1) return true;

      if (piece.type === "b" || piece.type === "r" || piece.type === "q") {
        if (slidingPieceAttacks(state, r, c, targetR, targetC, piece.type)) return true;
      }
    }
  }
  return false;
}

function slidingPieceAttacks(state, fromR, fromC, targetR, targetC, type) {
  const dr = Math.sign(targetR - fromR);
  const dc = Math.sign(targetC - fromC);
  const rowDelta = Math.abs(targetR - fromR);
  const colDelta = Math.abs(targetC - fromC);
  const diagonal = rowDelta === colDelta;
  const straight = fromR === targetR || fromC === targetC;

  if (type === "b" && !diagonal) return false;
  if (type === "r" && !straight) return false;
  if (type === "q" && !diagonal && !straight) return false;

  let r = fromR + dr;
  let c = fromC + dc;
  while (r !== targetR || c !== targetC) {
    if (state.board[r][c]) return false;
    r += dr;
    c += dc;
  }
  return true;
}

function findBestAiMove(state, depth) {
  const moves = orderMoves(generateLegalMoves(state, AI));
  let bestMove = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;

  for (const move of moves) {
    const score = minimax(makeMove(state, move, { skipNotation: true }), depth - 1, alpha, Infinity, false);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }

  return bestMove;
}

function minimax(state, depth, alpha, beta, maximizing) {
  const color = maximizing ? AI : HUMAN;
  const legal = generateLegalMoves(state, color);
  const inCheck = isKingInCheck(state, color);

  if (legal.length === 0) {
    if (!inCheck) return 0;
    return maximizing ? -100000 - depth : 100000 + depth;
  }

  if (depth === 0) return evaluateBoard(state);

  const moves = orderMoves(legal);
  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      value = Math.max(value, minimax(makeMove(state, move, { skipNotation: true }), depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Infinity;
  for (const move of moves) {
    value = Math.min(value, minimax(makeMove(state, move, { skipNotation: true }), depth - 1, alpha, beta, true));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function orderMoves(moves) {
  return [...moves].sort((a, b) => movePriority(b) - movePriority(a));
}

function movePriority(move) {
  let score = 0;
  if (move.captured) score += VALUES[move.captured.type] - VALUES[move.piece.type] / 10;
  if (move.promotion) score += VALUES[move.promotion];
  if (move.isCastle) score += 30;
  return score;
}

function evaluateBoard(state) {
  let score = 0;
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = state.board[r][c];
      if (!piece) continue;
      const sign = piece.color === AI ? 1 : -1;
      score += sign * (VALUES[piece.type] + positionalBonus(piece, r, c));
    }
  }

  score += generateLegalMoves(state, AI).length * 2;
  score -= generateLegalMoves(state, HUMAN).length * 2;
  if (isKingInCheck(state, HUMAN)) score += 24;
  if (isKingInCheck(state, AI)) score -= 24;
  return score;
}

function positionalBonus(piece, r, c) {
  const rank = piece.color === "w" ? 7 - r : r;
  const centerDistance = Math.abs(3.5 - r) + Math.abs(3.5 - c);
  if (piece.type === "p") return rank * 8 - Math.abs(3.5 - c) * 2;
  if (piece.type === "n" || piece.type === "b") return 28 - centerDistance * 6;
  if (piece.type === "q") return 10 - centerDistance * 2;
  if (piece.type === "r") return rank > 4 ? 14 : 0;
  if (piece.type === "k") return rank < 2 ? 12 : -centerDistance * 3;
  return 0;
}

newGameBtn.addEventListener("click", () => {
  game = createInitialState();
  moveHistory = [];
  isAiThinking = false;
  clearSelection();
  render();
});

undoBtn.addEventListener("click", () => {
  if (isAiThinking || moveHistory.length === 0) return;
  const steps = game.turn === HUMAN && moveHistory.length >= 2 ? 2 : 1;
  for (let i = 0; i < steps && moveHistory.length; i += 1) {
    game = moveHistory.pop();
  }
  clearSelection();
  render();
});

initStockfish();
render();
