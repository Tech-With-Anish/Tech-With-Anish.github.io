# Stockfish Chess

A standalone human-vs-AI chess game. The human plays White and the bot plays Black using the included browser build of Stockfish. If the Stockfish worker cannot start, the app falls back to the original minimax search with alpha-beta pruning.

## Run

Open `index.html` in a browser. No build step or package install is required.

## Features

- Legal chess moves, check, checkmate, stalemate, castling, en passant, and queen promotion.
- Stockfish engine search with selectable depth.
- UCI engine adapter that converts the current game state to FEN and applies Stockfish's best move.
- Minimax fallback with alpha-beta pruning, capture ordering, material evaluation, mobility, and simple positional bonuses.
- Move log, captured pieces, undo, and new game controls.

## Engine

`stockfish.js` is the browser JavaScript build of Stockfish.js. Stockfish is licensed under GPL.
