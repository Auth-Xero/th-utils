const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');
const MJPEG = require('mjpeg-server');
const { createCanvas } = require('canvas');
const crypto = require('crypto');

const app = express();
const PORT = 443;

const options = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'privkey.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'fullchain.pem'))
};

let waitingPlayers = [];
let waitingPlayersStreams = {};
let waitingPlayersImages = {};
let games = {};
let singlePlayerGames = {};
let playerIdToGame = {};
let singlePlayerIdToGame = {};
let playerIdToHashedIP = {};

app.use(express.static(path.join(__dirname, 'public')));

function hashIP(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
}

function generatePlayerId(hashedIP) {
    return hashedIP;
}

function generateGameId() {
    return 'game_' + Math.random().toString(36).substr(2, 9);
}

function pairPlayer(playerId) {

    for (let i = 0; i < waitingPlayers.length; i++) {
        const opponentId = waitingPlayers[i];
        if (playerIdToHashedIP[opponentId] !== playerIdToHashedIP[playerId]) {

            waitingPlayers.splice(i, 1);
            const gameId = generateGameId();
            const newGame = {
                id: gameId,
                players: [opponentId, playerId],
                board: Array(7).fill(null).map(() => Array(6).fill(null)),
                currentPlayer: opponentId,
                streams: {},
                images: {},
                timeout: null,
                timer: 90,            
                lastMovePlayer: null, 
                winner: null,
            };
            games[gameId] = newGame;
            playerIdToGame[playerId] = gameId;
            playerIdToGame[opponentId] = gameId;

            console.log(`Game ${gameId} started between ${opponentId} and ${playerId}`);

            if (waitingPlayersStreams[opponentId]) {
                newGame.streams[opponentId] = {
                    stream: waitingPlayersStreams[opponentId].stream,
                    lastActive: Date.now()
                };
                newGame.images[opponentId] = waitingPlayersImages[opponentId];
                setupStreamListeners(opponentId, newGame, 'game');
                delete waitingPlayersStreams[opponentId];
                delete waitingPlayersImages[opponentId];
                console.log(`Stream for ${opponentId} moved from waiting to active game.`);
            }

            if (waitingPlayersStreams[playerId]) {
                newGame.streams[playerId] = {
                    stream: waitingPlayersStreams[playerId].stream,
                    lastActive: Date.now()
                };
                newGame.images[playerId] = waitingPlayersImages[playerId];
                setupStreamListeners(playerId, newGame, 'game');
                delete waitingPlayersStreams[playerId];
                delete waitingPlayersImages[playerId];
                console.log(`Stream for ${playerId} moved from waiting to active game.`);
            }

            newGame.players.forEach((pid) => {
                updateGameBoardImage(newGame, pid);
                const image = newGame.images[pid];
                const streamObj = newGame.streams[pid];
                if (streamObj && image) {
                    streamObj.stream.write(image);
                    streamObj.lastActive = Date.now();
                }
            });

            return;
        }
    }

    waitingPlayers.push(playerId);
    console.log(`Player ${playerId} is waiting for an opponent...`);
}

function getSymbol(playerId, game) {
    return playerId === game.players[0] ? 'R' : 'Y';
}

function generateTransparentPNG() {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 1, 1);

    return canvas.toBuffer('image/png');
}

const transparentPNGBuffer = generateTransparentPNG();

function generateWaitingImage() {
    const canvas = createCanvas(700, 600);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 700, 600);

    ctx.fillStyle = '#0000FF';
    ctx.fillRect(50, 50, 600, 500);

    ctx.fillStyle = '#333333';
    ctx.font = '36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for an opponent...', 350, 300);

    return canvas.toBuffer('image/jpeg');
}

function generateGameBoardImage(game, playerId, message) {
    const canvas = createCanvas(700, 600);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 700, 600);

    drawBoard(ctx, game.board);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 550, 700, 50);
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#333333';

    let statusMessage = '';
    let isMyTurn = false;
    if (game.winner) {
        if (game.winner === 'Draw') {
            statusMessage = "It's a draw!";
        } else if (getSymbol(playerId, game) === game.winner) {
            statusMessage = 'You win!';
        } else {
            statusMessage = 'You lose!';
        }
    } else {
        if (game.currentPlayer === playerId) {
            statusMessage = "It's your turn.";
            isMyTurn = true;
        } else {
            statusMessage = "Opponent's turn.";
        }
    }

    ctx.fillText(statusMessage, 350, 580);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#333333';
    ctx.fillText(`Time remaining: ${game.timer}s`, 10, 30);

    if (!isMyTurn && !game.winner) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(0, 0, 700, 550);
    }

    if (message) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, 700, 550);
        ctx.fillStyle = '#ffffff';
        ctx.font = '36px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, 350, 275);
    }

    return canvas.toBuffer('image/jpeg');
}

function generateSinglePlayerGameBoardImage(game, playerId, message) {
    const canvas = createCanvas(700, 600);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 700, 600);

    drawBoard(ctx, game.board);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 550, 700, 50);
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#333333';

    let statusMessage = '';
    let isMyTurn = false;
    if (game.winner) {
        if (game.winner === 'Draw') {
            statusMessage = "It's a draw!";
        } else if (game.winner === 'Player') {
            statusMessage = 'You win!';
        } else {
            statusMessage = 'You lose!';
        }
    } else {
        if (game.currentPlayer === 'Player') {
            statusMessage = "It's your turn.";
            isMyTurn = true;
        } else {
            statusMessage = "AI's turn.";
        }
    }

    ctx.fillText(statusMessage, 350, 580);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#333333';
    ctx.fillText(`Time remaining: ${game.timer}s`, 10, 30);

    if (!isMyTurn && !game.winner) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(0, 0, 700, 550);
    }

    if (message) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, 700, 550);
        ctx.fillStyle = '#ffffff';
        ctx.font = '36px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, 350, 275);
    }

    return canvas.toBuffer('image/jpeg');
}

function drawBoard(ctx, board) {

    ctx.fillStyle = '#0000FF';
    ctx.fillRect(50, 50, 600, 500);

    const columns = 7;
    const rows = 6;
    const columnWidth = 600 / columns;
    const rowHeight = 500 / rows;

    for (let col = 0; col < columns; col++) {
        for (let row = 0; row < rows; row++) {
            const x = 50 + col * columnWidth + columnWidth / 2;
            const y = 50 + row * rowHeight + rowHeight / 2;
            ctx.beginPath();
            ctx.arc(x, y, Math.min(columnWidth, rowHeight) / 2 - 10, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            const disc = board[col][row];
            if (disc) {
                ctx.beginPath();
                ctx.arc(x, y, Math.min(columnWidth, rowHeight) / 2 - 10, 0, Math.PI * 2);
                ctx.fillStyle = disc === 'R' ? '#FF0000' : '#FFFF00';
                ctx.fill();
                ctx.stroke();
            }
        }
    }
}

function sendError(game, playerId, message) {
    console.log(`Error for ${playerId}: ${message}`);
    updateGameBoardImage(game, playerId, message);

    setTimeout(() => {
        updateGameBoardImage(game, playerId);
        const image = game.images[playerId];
        const streamObj = game.streams[playerId];
        if (streamObj && image) {
            try {
                streamObj.stream.write(image);
                streamObj.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing to stream for player ${playerId}:`, err);
                handleDisconnectedPlayer(playerId, game.id);
            }
        }
    }, 2000);
}

function checkGameOver(game) {
    const board = game.board;

    const directions = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: -1 },
    ];

    for (let col = 0; col < 7; col++) {
        for (let row = 0; row < 6; row++) {
            const player = board[col][row];
            if (!player) continue;

            for (let dir of directions) {
                let count = 1;
                let c = col + dir.x;
                let r = row + dir.y;
                while (c < 7 && c >= 0 && r < 6 && r >= 0 && board[c][r] === player) {
                    count++;
                    if (count === 4) {
                        game.winner = player;
                        return true;
                    }
                    c += dir.x;
                    r += dir.y;
                }
            }
        }
    }

    const isDraw = board.every(col => col.every(cell => cell !== null));
    if (isDraw) {
        game.winner = 'Draw';
        return true;
    }

    return false;
}

function checkSinglePlayerGameOver(game) {
    const board = game.board;

    const directions = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: -1 },
    ];

    const symbols = {
        'Player': 'R',
        'AI': 'Y'
    };

    for (let player in symbols) {
        const symbol = symbols[player];
        for (let col = 0; col < 7; col++) {
            for (let row = 0; row < 6; row++) {
                if (board[col][row] !== symbol) continue;

                for (let dir of directions) {
                    let count = 1;
                    let c = col + dir.x;
                    let r = row + dir.y;
                    while (c < 7 && c >= 0 && r < 6 && r >= 0 && board[c][r] === symbol) {
                        count++;
                        if (count === 4) {
                            game.winner = player;
                            return true;
                        }
                        c += dir.x;
                        r += dir.y;
                    }
                }
            }
        }
    }

    const isDraw = board.every(col => col.every(cell => cell !== null));
    if (isDraw) {
        game.winner = 'Draw';
        return true;
    }

    return false;
}

function endGame(gameId) {
    const game = games[gameId];
    if (game) {

        if (game.timeout) {
            clearTimeout(game.timeout);
        }

        game.players.forEach((pid) => {
            if (game.streams[pid]) {
                game.streams[pid].stream.close();
                delete game.streams[pid];
                console.log(`Stream for ${pid} closed.`);
            }
            if (game.images[pid]) {
                delete game.images[pid];
            }
            delete playerIdToGame[pid];
            delete playerIdToHashedIP[pid];
        });
        delete games[gameId];
        console.log(`Game ${gameId} ended.`);
    }
}

function endSinglePlayerGame(gameId) {
    const game = singlePlayerGames[gameId];
    if (game) {

        if (game.timeout) {
            clearTimeout(game.timeout);
        }

        const playerId = game.player;
        if (game.stream) {
            game.stream.close();
            console.log(`Stream for player ${playerId} closed.`);
        }
        delete singlePlayerGames[gameId];
        delete singlePlayerIdToGame[playerId];
        delete playerIdToHashedIP[playerId];
        console.log(`Single-player Game ${gameId} ended.`);
    }
}

function updateWaitingImage(playerId) {
    const imageBuffer = generateWaitingImage();
    waitingPlayersImages[playerId] = imageBuffer;
}

function updateGameBoardImage(game, playerId, message) {
    const imageBuffer = generateGameBoardImage(game, playerId, message);
    game.images[playerId] = imageBuffer;
}

function updateSinglePlayerGameBoardImage(game, playerId, message) {
    const imageBuffer = generateSinglePlayerGameBoardImage(game, playerId, message);
    game.image = imageBuffer;
}

function generateUniqueTransparentPNG() {
    const canvas = createCanvas(10, 10);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const x = Math.floor(Math.random() * canvas.width);
    const y = Math.floor(Math.random() * canvas.height);

    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0)`;
    ctx.fillRect(x, y, 1, 1);

    return canvas.toBuffer('image/png');
}

function getPlayerId(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    let ip;
    if (xForwardedFor) {
        ip = xForwardedFor.split(',')[0].trim();
    } else {
        ip = req.connection.remoteAddress;
    }
    const hashedIP = hashIP(ip);
    const playerId = generatePlayerId(hashedIP);
    playerIdToHashedIP[playerId] = hashedIP;
    return playerId;
}

function getAvailableRow(board, col) {
    for (let row = 5; row >= 0; row--) {
        if (board[col][row] === null) {
            return row;
        }
    }
    return -1;
}

app.get('/singleplayer_stream', (req, res) => {
    const playerId = getPlayerId(req);

    const difficulty = req.query.difficulty || 'medium';
    let randomMoveProbability;
    switch (difficulty.toLowerCase()) {
        case 'easy':
            randomMoveProbability = 0.5;
            break;
        case 'hard':
            randomMoveProbability = 0.1;
            break;
        case 'impossible':
            randomMoveProbability = 0;
            break;
        case 'medium':
        default:
            randomMoveProbability = 0.3;
            break;
    }

    const mjpegReqHandler = new MJPEG.createReqHandler(req, res);

    const gameId = generateGameId();
    const newGame = {
        id: gameId,
        player: playerId,
        board: Array(7).fill(null).map(() => Array(6).fill(null)),
        currentPlayer: 'Player',
        stream: mjpegReqHandler,
        image: null,
        lastActive: Date.now(),
        winner: null,
        timeout: null,
        randomMoveProbability: randomMoveProbability,
        timer: 90,            
        lastMovePlayer: null, 
    };
    singlePlayerGames[gameId] = newGame;
    singlePlayerIdToGame[playerId] = gameId;
    playerIdToHashedIP[playerId] = hashIP(req.connection.remoteAddress);

    console.log(`Single-player Game ${gameId} started for player ${playerId} with difficulty '${difficulty}'`);

    setupSinglePlayerStreamListeners(playerId, newGame);

    updateSinglePlayerGameBoardImage(newGame, playerId);
    const image = newGame.image;
    const stream = newGame.stream;
    if (image) {
        try {
            stream.write(image);
            newGame.lastActive = Date.now();
        } catch (err) {
            console.error(`Error writing initial image to single-player stream for player ${playerId}:`, err);
            handleDisconnectedSinglePlayer(playerId, gameId);
        }
    }
});

app.get('/singleplayer_move', (req, res) => {
    const playerId = generatePlayerId(hashIP(req.ip));
    const column = parseInt(req.query.column);

    if (!singlePlayerIdToGame[playerId]) {

        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    const gameId = singlePlayerIdToGame[playerId];
    const game = singlePlayerGames[gameId];

    if (!game) {

        console.log(`Single-player Game ${gameId} not found for player ${playerId}.`);
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    if (game.currentPlayer !== 'Player') {
        sendSinglePlayerError(game, playerId, 'Not your turn.');
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    if (isNaN(column) || column < 0 || column > 6 || !game.board[column].some(cell => cell === null)) {
        sendSinglePlayerError(game, playerId, 'Invalid move.');
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    const playerSymbol = 'R';
    const row = getAvailableRow(game.board, column);
    if (row === -1) {
        sendSinglePlayerError(game, playerId, 'Column full.');
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }
    game.board[column][row] = playerSymbol;
    game.currentPlayer = 'AI';

    game.lastMovePlayer = 'Player'; 

    console.log(`Player ${playerId} placed ${playerSymbol} in column ${column} of single-player game ${gameId}.`);

    if (checkSinglePlayerGameOver(game)) {
        const message = game.winner === 'Draw' ? "It's a draw!" :
            (game.winner === 'Player' ? 'You win!' : 'You lose!');
        updateSinglePlayerGameBoardImage(game, playerId, message);
        if (game.stream && game.image) {
            try {
                game.stream.write(game.image);
                game.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing game over image to player ${playerId}:`, err);
                handleDisconnectedSinglePlayer(playerId, gameId);
            }
        }

        console.log(`Single-player Game ${gameId} concluded with result: ${game.winner}.`);

        game.timeout = setTimeout(() => {
            endSinglePlayerGame(gameId);
        }, 10000);

        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    updateSinglePlayerGameBoardImage(game, playerId);
    if (game.stream && game.image) {
        try {
            game.stream.write(game.image);
            game.lastActive = Date.now();
        } catch (err) {
            console.error(`Error writing updated game board to player ${playerId}:`, err);
            handleDisconnectedSinglePlayer(playerId, gameId);
        }
    }

    if (!game.winner && game.currentPlayer === 'AI') {
        makeAIMove(game);
    }

    const uniqueImage = generateUniqueTransparentPNG();
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': uniqueImage.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Last-Modified': `${Date.now()}`,
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    res.end(uniqueImage);
});

function sendSinglePlayerError(game, playerId, message) {
    console.log(`Error for player ${playerId}: ${message}`);
    updateSinglePlayerGameBoardImage(game, playerId, message);

    setTimeout(() => {
        updateSinglePlayerGameBoardImage(game, playerId);
        const image = game.image;
        const stream = game.stream;
        if (stream && image) {
            try {
                stream.write(image);
                game.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing to single-player stream for player ${playerId}:`, err);
                handleDisconnectedSinglePlayer(playerId, game.id);
            }
        }
    }, 2000);
}

function setupSinglePlayerStreamListeners(playerId, game) {
    const stream = game.stream;

    stream.on('close', () => {
        console.log(`Single-player stream closed for player ${playerId}.`);
        handleDisconnectedSinglePlayer(playerId, game.id);
    });

    stream.on('error', (err) => {
        console.error(`Single-player stream error for player ${playerId}:`, err);
        handleDisconnectedSinglePlayer(playerId, game.id);
    });
}

function handleDisconnectedSinglePlayer(playerId, gameId) {
    const game = singlePlayerGames[gameId];
    if (!game) return;

    console.log(`Player ${playerId} disconnected from single-player game ${gameId}. Ending game.`);

    endSinglePlayerGame(gameId);
}

function removeWaitingPlayer(playerId) {
    const index = waitingPlayers.indexOf(playerId);
    if (index !== -1) {
        waitingPlayers.splice(index, 1);
        console.log(`Player ${playerId} removed from waiting list due to disconnection.`);
    }

    if (waitingPlayersStreams[playerId]) {
        waitingPlayersStreams[playerId].stream.close();
        delete waitingPlayersStreams[playerId];
    }

    if (waitingPlayersImages[playerId]) {
        delete waitingPlayersImages[playerId];
    }

    delete playerIdToHashedIP[playerId];
}

function checkInactiveStreams() {
    const now = Date.now();
    const timeout = 15000;

    for (const pid in waitingPlayersStreams) {
        const streamObj = waitingPlayersStreams[pid];
        if (now - streamObj.lastActive > timeout) {
            console.log(`Player ${pid} in waiting list inactive for over 15 seconds. Removing.`);
            removeWaitingPlayer(pid);
        }
    }

    for (const gameId in games) {
        const game = games[gameId];
        for (const pid in game.streams) {
            const streamObj = game.streams[pid];
            if (now - streamObj.lastActive > timeout) {
                console.log(`Player ${pid} in game ${gameId} inactive for over 15 seconds. Ending game.`);
                handleDisconnectedPlayer(pid, gameId);
            }
        }
    }

    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (now - game.lastActive > timeout) {
            console.log(`Player ${game.player} in single-player game ${gameId} inactive for over 15 seconds. Ending game.`);
            endSinglePlayerGame(gameId);
        }
    }
}

setInterval(checkInactiveStreams, 5000);

function makeAIMove(game) {
    if (game.winner) return;

    const aiSymbol = 'Y';
    const playerSymbol = 'R';
    const board = game.board;
    const randomMoveProbability = game.randomMoveProbability || 0.3;

    const thinkingDelay = Math.floor(Math.random() * 1500) + 500;

    setTimeout(() => {
        const move = getAIMove(board, aiSymbol, playerSymbol, randomMoveProbability);

        if (move !== undefined && move !== -1 && board[move].some(cell => cell === null)) {
            const row = getAvailableRow(board, move);
            if (row !== -1) {
                board[move][row] = aiSymbol;
                game.lastMovePlayer = 'AI'; 
                console.log(`AI placed ${aiSymbol} in column ${move} of single-player game ${game.id}.`);

                if (checkSinglePlayerGameOver(game)) {
                    const message = game.winner === 'Draw' ? "It's a draw!" :
                        (game.winner === 'Player' ? 'You win!' : 'You lose!');
                    updateSinglePlayerGameBoardImage(game, game.player, message);
                    if (game.stream && game.image) {
                        try {
                            game.stream.write(game.image);
                            game.lastActive = Date.now();
                        } catch (err) {
                            console.error(`Error writing game over image to player ${game.player}:`, err);
                            handleDisconnectedSinglePlayer(game.player, game.id);
                        }
                    }

                    console.log(`Single-player Game ${game.id} concluded with result: ${game.winner}.`);

                    game.timeout = setTimeout(() => {
                        endSinglePlayerGame(game.id);
                    }, 10000);

                    return;
                }

                game.currentPlayer = 'Player';

                updateSinglePlayerGameBoardImage(game, game.player);
                if (game.stream && game.image) {
                    try {
                        game.stream.write(game.image);
                        game.lastActive = Date.now();
                    } catch (err) {
                        console.error(`Error writing updated game board to player ${game.player}:`, err);
                        handleDisconnectedSinglePlayer(game.player, game.id);
                    }
                }
            } else {
                console.error(`AI attempted to place in a full column ${move} in game ${game.id}.`);
            }
        } else {
            console.error(`AI attempted to place in an invalid column ${move} in game ${game.id}.`);

        }
    }, thinkingDelay);
}

function getAIMove(board, aiSymbol, playerSymbol, randomMoveProbability = 0.3) {

    if (Math.random() < randomMoveProbability) {

        const availableColumns = board.map((col, idx) => (col.some(cell => cell === null) ? idx : null)).filter(val => val !== null);
        if (availableColumns.length === 0) return -1;
        const randomIndex = availableColumns[Math.floor(Math.random() * availableColumns.length)];
        return randomIndex;
    }

    function minimax(newBoard, depth, maximizingPlayer) {
        const winner = checkWinner(newBoard);
        if (winner === aiSymbol) return { score: 100 - depth };
        if (winner === playerSymbol) return { score: depth - 100 };
        if (isBoardFull(newBoard)) return { score: 0 };

        if (depth >= 5) return { score: 0 };

        const availableColumns = newBoard.map((col, idx) => (col.some(cell => cell === null) ? idx : null)).filter(val => val !== null);

        if (maximizingPlayer) {
            let bestScore = -Infinity;
            let bestColumn = availableColumns[Math.floor(Math.random() * availableColumns.length)];
            for (let col of availableColumns) {
                const tempBoard = JSON.parse(JSON.stringify(newBoard));
                const row = getAvailableRow(tempBoard, col);
                tempBoard[col][row] = aiSymbol;
                const result = minimax(tempBoard, depth + 1, false);
                if (result.score > bestScore) {
                    bestScore = result.score;
                    bestColumn = col;
                }
            }
            return { score: bestScore, column: bestColumn };
        } else {
            let bestScore = Infinity;
            let bestColumn = availableColumns[Math.floor(Math.random() * availableColumns.length)];
            for (let col of availableColumns) {
                const tempBoard = JSON.parse(JSON.stringify(newBoard));
                const row = getAvailableRow(tempBoard, col);
                tempBoard[col][row] = playerSymbol;
                const result = minimax(tempBoard, depth + 1, true);
                if (result.score < bestScore) {
                    bestScore = result.score;
                    bestColumn = col;
                }
            }
            return { score: bestScore, column: bestColumn };
        }
    }

    function checkWinner(board) {

        for (let col = 0; col < 7; col++) {
            for (let row = 0; row < 6; row++) {
                const player = board[col][row];
                if (!player) continue;

                if (col + 3 < 7 &&
                    board[col + 1][row] === player &&
                    board[col + 2][row] === player &&
                    board[col + 3][row] === player) {
                    return player;
                }

                if (row + 3 < 6 &&
                    board[col][row + 1] === player &&
                    board[col][row + 2] === player &&
                    board[col][row + 3] === player) {
                    return player;
                }

                if (col + 3 < 7 && row + 3 < 6 &&
                    board[col + 1][row + 1] === player &&
                    board[col + 2][row + 2] === player &&
                    board[col + 3][row + 3] === player) {
                    return player;
                }

                if (col + 3 < 7 && row - 3 >= 0 &&
                    board[col + 1][row - 1] === player &&
                    board[col + 2][row - 2] === player &&
                    board[col + 3][row - 3] === player) {
                    return player;
                }
            }
        }
        return null;
    }

    function isBoardFull(board) {
        return board.every(col => col.every(cell => cell !== null));
    }

    function getAvailableRow(board, col) {
        for (let row = 5; row >= 0; row--) {
            if (board[col][row] === null) return row;
        }
        return -1;
    }

    const result = minimax(board, 0, true);
    return result.column !== undefined ? result.column : -1;
}

function setupStreamListeners(playerId, game, type) {
    let streamObj;
    if (type === 'game' && game) {
        streamObj = game.streams[playerId];
    } else {
        streamObj = waitingPlayersStreams[playerId];
    }

    if (!streamObj) return;

    const stream = streamObj.stream;

    stream.on('close', () => {
        console.log(`Stream closed for player ${playerId}.`);
        if (type === 'game' && game) {
            handleDisconnectedPlayer(playerId, game.id);
        } else if (type === 'waiting') {
            removeWaitingPlayer(playerId);
        }
    });

    stream.on('error', (err) => {
        console.error(`Stream error for player ${playerId}:`, err);
        if (type === 'game' && game) {
            handleDisconnectedPlayer(playerId, game.id);
        } else if (type === 'waiting') {
            removeWaitingPlayer(playerId);
        }
    });
}

function handleDisconnectedPlayer(playerId, gameId) {
    const game = games[gameId];
    if (!game) return;

    console.log(`Player ${playerId} disconnected from game ${gameId}. Ending game.`);

    const opponentId = game.players.find(pid => pid !== playerId);
    if (opponentId && game.streams[opponentId]) {
        updateGameBoardImage(game, opponentId, 'Opponent disconnected. You win by default.');
        try {
            game.streams[opponentId].stream.write(game.images[opponentId]);
            game.streams[opponentId].lastActive = Date.now();
        } catch (err) {
            console.error(`Error notifying player ${opponentId} about opponent disconnection:`, err);
            handleDisconnectedPlayer(opponentId, gameId);
        }
    }

    endGame(gameId);
}

app.get('/stream', (req, res) => {
    const playerId = getPlayerId(req);

    const mjpegReqHandler = new MJPEG.createReqHandler(req, res);

    if (!playerIdToGame[playerId] && !singlePlayerIdToGame[playerId]) {

        waitingPlayersStreams[playerId] = {
            stream: mjpegReqHandler,
            lastActive: Date.now()
        };

        updateWaitingImage(playerId);

        pairPlayer(playerId);

        setupStreamListeners(playerId, null, 'waiting');

        return;
    }

    if (playerIdToGame[playerId]) {

        const gameId = playerIdToGame[playerId];
        const game = games[gameId];

        if (!game) {

            console.log(`Game ${gameId} not found for player ${playerId}.`);
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': transparentPNGBuffer.length,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Last-Modified': `${Date.now()}`,
            });
            res.end(transparentPNGBuffer);
            return;
        }

        game.streams[playerId] = {
            stream: mjpegReqHandler,
            lastActive: Date.now()
        };

        setupStreamListeners(playerId, game, 'game');

        updateGameBoardImage(game, playerId);
        const image = game.images[playerId];
        const streamObj = game.streams[playerId];
        if (image) {
            try {
                streamObj.stream.write(image);
            } catch (err) {
                console.error(`Error writing initial image to stream for player ${playerId}:`, err);
                handleDisconnectedPlayer(playerId, gameId);
            }
        }
    } else if (singlePlayerIdToGame[playerId]) {

        const gameId = singlePlayerIdToGame[playerId];
        const game = singlePlayerGames[gameId];

        if (!game) {

            console.log(`Single-player Game ${gameId} not found for player ${playerId}.`);
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': transparentPNGBuffer.length,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Last-Modified': `${Date.now()}`,
            });
            res.end(transparentPNGBuffer);
            return;
        }

        game.stream = mjpegReqHandler;
        game.lastActive = Date.now();

        setupSinglePlayerStreamListeners(playerId, game);

        updateSinglePlayerGameBoardImage(game, playerId);
        const image = game.image;
        const stream = game.stream;
        if (image) {
            try {
                stream.write(image);
            } catch (err) {
                console.error(`Error writing initial image to single-player stream for player ${playerId}:`, err);
                handleDisconnectedSinglePlayer(playerId, gameId);
            }
        }
    }
});

setInterval(() => {
    for (const pid in waitingPlayersStreams) {
        const streamObj = waitingPlayersStreams[pid];
        const stream = streamObj.stream;
        const image = waitingPlayersImages[pid] || generateWaitingImage();
        if (stream && image) {
            try {
                stream.write(image);
                streamObj.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing to stream for player ${pid}:`, err);
                removeWaitingPlayer(pid);
            }
        }
    }
}, 100);

setInterval(() => {
    for (const gameId in games) {
        const game = games[gameId];
        for (const pid in game.streams) {
            const streamObj = game.streams[pid];
            const stream = streamObj.stream;
            const image = game.images[pid];
            if (stream && image) {
                try {
                    stream.write(image);
                    streamObj.lastActive = Date.now();
                } catch (err) {
                    console.error(`Error writing to stream for player ${pid} in game ${gameId}:`, err);
                    handleDisconnectedPlayer(pid, gameId);
                }
            }
        }
    }
}, 100);

setInterval(() => {
    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (game.stream && game.image) {
            try {
                game.stream.write(game.image);
                game.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing to stream for player ${game.player} in single-player game ${gameId}:`, err);
                handleDisconnectedSinglePlayer(game.player, gameId);
            }
        }
    }
}, 100);

setInterval(() => {
    for (const gameId in games) {
        const game = games[gameId];
        if (game.timer > 0 && !game.winner) {
            game.timer--;

            game.players.forEach((pid) => {
                updateGameBoardImage(game, pid);
            });
        } else if (game.timer === 0 && !game.winner) {

            if (game.lastMovePlayer) {
                game.winner = getSymbol(game.lastMovePlayer, game);
                console.log(`Game ${gameId} timer expired. Player ${game.lastMovePlayer} wins by default.`);

                game.players.forEach((pid) => {
                    const message = pid === game.lastMovePlayer ? 'You win by default!' : 'You lose!';
                    updateGameBoardImage(game, pid, message);

                    if (game.streams[pid] && game.images[pid]) {
                        try {
                            game.streams[pid].stream.write(game.images[pid]);
                            game.streams[pid].lastActive = Date.now();
                        } catch (err) {
                            console.error(`Error sending final image to player ${pid}:`, err);
                            handleDisconnectedPlayer(pid, gameId);
                        }
                    }
                });

                game.timeout = setTimeout(() => {
                    endGame(gameId);
                }, 10000);
            } else {

                game.winner = 'Draw';
                game.players.forEach((pid) => {
                    updateGameBoardImage(game, pid, "Time's up! It's a draw!");
                    if (game.streams[pid] && game.images[pid]) {
                        try {
                            game.streams[pid].stream.write(game.images[pid]);
                            game.streams[pid].lastActive = Date.now();
                        } catch (err) {
                            console.error(`Error sending final image to player ${pid}:`, err);
                            handleDisconnectedPlayer(pid, gameId);
                        }
                    }
                });
                game.timeout = setTimeout(() => {
                    endGame(gameId);
                }, 10000);
            }
        }
    }

    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (game.timer > 0 && !game.winner) {
            game.timer--;
            updateSinglePlayerGameBoardImage(game, game.player);
        } else if (game.timer === 0 && !game.winner) {
            game.winner = game.lastMovePlayer === 'Player' ? 'Player' : 'AI';
            console.log(`Single-player Game ${gameId} timer expired. ${game.winner} wins by default.`);
            const message = game.winner === 'Player' ? 'You win by default!' : 'You lose!';
            updateSinglePlayerGameBoardImage(game, game.player, message);
            if (game.stream && game.image) {
                try {
                    game.stream.write(game.image);
                    game.lastActive = Date.now();
                } catch (err) {
                    console.error(`Error sending final image to player ${game.player}:`, err);
                    handleDisconnectedSinglePlayer(game.player, gameId);
                }
            }
            game.timeout = setTimeout(() => {
                endSinglePlayerGame(gameId);
            }, 10000);
        }
    }
}, 1000);  

app.get('/make_move', (req, res) => {
    const playerId = generatePlayerId(hashIP(req.ip));
    const column = parseInt(req.query.column);

    let gameId = playerIdToGame[playerId] || singlePlayerIdToGame[playerId];
    let game = games[gameId] || singlePlayerGames[gameId];

    if (!game) {

        res.writeHead(400, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(transparentPNGBuffer);
        return;
    }

    if (gameId in games) {

        handleTwoPlayerMove(req, res, playerId, column, gameId, game);
    } else if (gameId in singlePlayerGames) {

        handleSinglePlayerMove(req, res, playerId, column, gameId, game);
    } else {

        res.writeHead(400, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Last-Modified': `${Date.now()}`,
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(transparentPNGBuffer);
    }
});

function handleTwoPlayerMove(req, res, playerId, column, gameId, game) {

    if (game.currentPlayer !== playerId) {
        sendTwoPlayerError(game, playerId, 'Not your turn.');
        sendTransparentImage(res);
        return;
    }

    if (isNaN(column) || column < 0 || column > 6 || !game.board[column].some(cell => cell === null)) {
        sendTwoPlayerError(game, playerId, 'Invalid move.');
        sendTransparentImage(res);
        return;
    }

    const row = getAvailableRow(game.board, column);
    if (row === -1) {
        sendTwoPlayerError(game, playerId, 'Column full.');
        sendTransparentImage(res);
        return;
    }

    const playerSymbol = getSymbol(playerId, game);
    game.board[column][row] = playerSymbol;
    game.lastMovePlayer = playerId; 

    console.log(`Player ${playerId} placed ${playerSymbol} in column ${column} of game ${gameId}.`);

    if (checkGameOver(game)) {
        const message = game.winner === 'Draw' ? "It's a draw!" :
            (game.winner === playerSymbol ? 'You win!' : 'You lose!');
        updateGameBoardImage(game, playerId, message);

        pushImageToStream(game.streams[playerId], game.images[playerId]);

        console.log(`Game ${gameId} concluded with result: ${game.winner}.`);

        game.timeout = setTimeout(() => {
            endGame(gameId);
        }, 10000);

        sendTransparentImage(res);
        return;
    }

    const opponentId = game.players.find(pid => pid !== playerId);
    game.currentPlayer = opponentId;

    updateGameBoardImage(game, playerId);

    pushImageToStream(game.streams[playerId], game.images[playerId]);

    sendTransparentImage(res);
}

function sendTwoPlayerError(game, playerId, message) {
    console.log(`Error for player ${playerId}: ${message}`);
    updateGameBoardImage(game, playerId, message);

    if (game.streams[playerId] && game.images[playerId]) {
        pushImageToStream(game.streams[playerId], game.images[playerId]);
    }
}

function handleSinglePlayerMove(req, res, playerId, column, gameId, game) {

    if (game.currentPlayer !== 'Player') {
        sendSinglePlayerError(game, playerId, 'Not your turn.');
        sendTransparentImage(res);
        return;
    }

    if (isNaN(column) || column < 0 || column > 6 || !game.board[column].some(cell => cell === null)) {
        sendSinglePlayerError(game, playerId, 'Invalid move.');
        sendTransparentImage(res);
        return;
    }

    const row = getAvailableRow(game.board, column);
    if (row === -1) {
        sendSinglePlayerError(game, playerId, 'Column full.');
        sendTransparentImage(res);
        return;
    }

    const playerSymbol = 'R';
    game.board[column][row] = playerSymbol;
    game.currentPlayer = 'AI';
    game.lastMovePlayer = 'Player'; 

    console.log(`Player ${playerId} placed ${playerSymbol} in column ${column} of single-player game ${gameId}.`);

    if (checkSinglePlayerGameOver(game)) {
        const message = game.winner === 'Draw' ? "It's a draw!" :
            (game.winner === 'Player' ? 'You win!' : 'You lose!');
        updateSinglePlayerGameBoardImage(game, playerId, message);
        pushImageToStream({ stream: game.stream }, game.image);

        console.log(`Single-player Game ${gameId} concluded with result: ${game.winner}.`);

        game.timeout = setTimeout(() => {
            endSinglePlayerGame(gameId);
        }, 10000);

        sendTransparentImage(res);
        return;
    }

    updateSinglePlayerGameBoardImage(game, playerId);
    pushImageToStream({ stream: game.stream }, game.image);

    if (!game.winner && game.currentPlayer === 'AI') {
        makeAIMove(game);
    }

    sendTransparentImage(res);
}

function sendTransparentImage(res) {
    const uniqueImage = generateUniqueTransparentPNG();
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': uniqueImage.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Last-Modified': `${Date.now()}`,
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    res.end(uniqueImage);
}

function pushImageToStream(streamObj, imageBuffer) {
    if (streamObj && imageBuffer) {
        try {
            streamObj.stream.write(imageBuffer);
            streamObj.lastActive = Date.now();
        } catch (err) {
            console.error(`Error writing to stream:`, err);
            if (gameId in games) {
                handleDisconnectedPlayer(playerId, gameId);
            } else if (gameId in singlePlayerGames) {
                handleDisconnectedSinglePlayer(playerId, gameId);
            }
        }
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));

const server = https.createServer(options, app);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});