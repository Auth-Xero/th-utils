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
    return `${hashedIP}`; 
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
                board: '---------',
                currentPlayer: opponentId,
                streams: {}, 
                images: {}, 
                timeout: null, 
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
                updateGameBoardImage(newGame, pid, currentPixelColor);
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
    return playerId === game.players[0] ? 'X' : 'O';
}

function generateTransparentPNG() {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 1, 1);

    return canvas.toBuffer('image/png');
}

const transparentPNGBuffer = generateTransparentPNG();

function generateWaitingImage(pixelColor) {
    const canvas = createCanvas(300, 350);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 300, 350);

    ctx.strokeStyle = '#000000'; 
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 0);
    ctx.lineTo(100, 300);
    ctx.moveTo(200, 0);
    ctx.lineTo(200, 300);
    ctx.moveTo(0, 100);
    ctx.lineTo(300, 100);
    ctx.moveTo(0, 200);
    ctx.lineTo(300, 200);
    ctx.stroke();

    ctx.fillStyle = '#333333'; 
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for an opponent...', 150, 175); 

    ctx.fillStyle = pixelColor;
    ctx.fillRect(0, 0, 5, 5); 

    return canvas.toBuffer('image/jpeg');
}

function generateGameBoardImage(game, playerId, pixelColor, message) {
    const canvas = createCanvas(300, 350);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 300, 350);

    drawBoard(ctx, game.board);

    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 300, 300, 50); 
    ctx.font = '20px Arial';
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

    ctx.fillText(statusMessage, 150, 330);

    if (!isMyTurn && !game.winner) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; 
        ctx.fillRect(0, 0, 300, 300);
    }

    if (message) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; 
        ctx.fillRect(0, 0, 300, 300);
        ctx.fillStyle = '#ffffff'; 
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, 150, 175); 
    }

    ctx.fillStyle = pixelColor;
    ctx.fillRect(0, 0, 5, 5); 

    return canvas.toBuffer('image/jpeg');
}

function generateSinglePlayerGameBoardImage(game, playerId, pixelColor, message) {
    const canvas = createCanvas(300, 350);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 300, 350);

    drawBoard(ctx, game.board);

    ctx.fillStyle = '#ffffff'; 
    ctx.fillRect(0, 300, 300, 50); 
    ctx.font = '20px Arial';
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

    ctx.fillText(statusMessage, 150, 330);

    if (!isMyTurn && !game.winner) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; 
        ctx.fillRect(0, 0, 300, 300);
    }

    if (message) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; 
        ctx.fillRect(0, 0, 300, 300);
        ctx.fillStyle = '#ffffff'; 
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(message, 150, 175); 
    }

    ctx.fillStyle = pixelColor;
    ctx.fillRect(0, 0, 5, 5); 

    return canvas.toBuffer('image/jpeg');
}

function drawBoard(ctx, board) {

    ctx.strokeStyle = '#000000'; 
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 0);
    ctx.lineTo(100, 300);
    ctx.moveTo(200, 0);
    ctx.lineTo(200, 300);
    ctx.moveTo(0, 100);
    ctx.lineTo(300, 100);
    ctx.moveTo(0, 200);
    ctx.lineTo(300, 200);
    ctx.stroke();

    for (let i = 0; i < 9; i++) {
        const symbol = board[i];
        const x = (i % 3) * 100;
        const y = Math.floor(i / 3) * 100;

        if (symbol === 'X') {
            ctx.strokeStyle = '#e74c3c'; 
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(x + 20, y + 20);
            ctx.lineTo(x + 80, y + 80);
            ctx.moveTo(x + 80, y + 20);
            ctx.lineTo(x + 20, y + 80);
            ctx.stroke();
        } else if (symbol === 'O') {
            ctx.strokeStyle = '#3498db'; 
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(x + 50, y + 50, 30, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

function sendError(game, playerId, message) {
    console.log(`Error for ${playerId}: ${message}`);
    updateGameBoardImage(game, playerId, currentPixelColor, message);

    setTimeout(() => {
        updateGameBoardImage(game, playerId, currentPixelColor);
        const image = game.images[playerId];
        const streamObj = game.streams[playerId];
        if (streamObj && image) {
            try {
                streamObj.stream.write(image);
                streamObj.lastActive = Date.now(); 
            } catch (err) {
                console.error(`Error writing to stream for player ${playerId}:`, err);
                handleDisconnectedPlayer(pid, gameId);
            }
        }
    }, 2000);
}

function checkGameOver(game) {
    const winningCombos = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6],
    ];

    const board = game.board;
    const symbols = ['X', 'O'];

    for (let symbol of symbols) {
        if (winningCombos.some(combo => combo.every(index => board[index] === symbol))) {
            game.winner = symbol;
            return true;
        }
    }

    if (!board.includes('-')) {
        game.winner = 'Draw';
        return true;
    }

    return false;
}

function checkSinglePlayerGameOver(game) {
    const winningCombos = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6],
    ];

    const board = game.board;
    const symbols = {
        'Player': 'X',
        'AI': 'O'
    };

    for (let player in symbols) {
        const symbol = symbols[player];
        if (winningCombos.some(combo => combo.every(index => board[index] === symbol))) {
            game.winner = player === 'Player' ? 'Player' : 'AI';
            return true;
        }
    }

    if (!board.includes('-')) {
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
    const imageBuffer = generateWaitingImage(currentPixelColor);
    waitingPlayersImages[playerId] = imageBuffer;
}

function updateGameBoardImage(game, playerId, pixelColor, message) {
    const imageBuffer = generateGameBoardImage(game, playerId, pixelColor, message);
    game.images[playerId] = imageBuffer;
}

function updateSinglePlayerGameBoardImage(game, playerId, pixelColor, message) {
    const imageBuffer = generateSinglePlayerGameBoardImage(game, playerId, pixelColor, message);
    game.image = imageBuffer;
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

let currentPixelColor = getRandomColor();

setInterval(() => {
    currentPixelColor = getRandomColor();

    for (const pid in waitingPlayersStreams) {
        updateWaitingImage(pid);
    }

    for (const gameId in games) {
        const game = games[gameId];
        for (const pid in game.streams) {
            updateGameBoardImage(game, pid, currentPixelColor);
        }
    }

    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (game.image) {
            updateSinglePlayerGameBoardImage(game, game.player, currentPixelColor);
        }
    }

}, 1000); 

setInterval(() => {
    for (const pid in waitingPlayersStreams) {
        const streamObj = waitingPlayersStreams[pid];
        const stream = streamObj.stream;
        const image = waitingPlayersImages[pid] || generateWaitingImage(currentPixelColor);
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

function getAIMove(board, aiSymbol, playerSymbol, randomMoveProbability = 0.3) {

    if (Math.random() < randomMoveProbability) {

        const availableSpots = board.split('').map((val, idx) => val === '-' ? idx : null).filter(val => val !== null);
        if (availableSpots.length === 0) return -1; 
        const randomIndex = availableSpots[Math.floor(Math.random() * availableSpots.length)];
        return randomIndex;
    }

    function minimax(newBoard, player) {
        const availSpots = newBoard.split('').map((val, idx) => val === '-' ? idx : null).filter(val => val !== null);

        const winner = checkWinner(newBoard);
        if (winner === playerSymbol) {
            return { score: -10 };
        } else if (winner === aiSymbol) {
            return { score: 10 };
        } else if (availSpots.length === 0) {
            return { score: 0 };
        }

        const moves = [];

        for (let i = 0; i < availSpots.length; i++) {
            const move = {};
            move.index = availSpots[i];
            newBoard = newBoard.substring(0, availSpots[i]) + player + newBoard.substring(availSpots[i] + 1);
            if (player === aiSymbol) {
                const result = minimax(newBoard, playerSymbol);
                move.score = result.score;
            } else {
                const result = minimax(newBoard, aiSymbol);
                move.score = result.score;
            }
            newBoard = newBoard.substring(0, availSpots[i]) + '-' + newBoard.substring(availSpots[i] + 1);
            moves.push(move);
        }

        let bestMove;
        if (player === aiSymbol) {
            let bestScore = -Infinity;
            for (let i = 0; i < moves.length; i++) {
                if (moves[i].score > bestScore) {
                    bestScore = moves[i].score;
                    bestMove = moves[i];
                }
            }
        } else {
            let bestScore = Infinity;
            for (let i = 0; i < moves.length; i++) {
                if (moves[i].score < bestScore) {
                    bestScore = moves[i].score;
                    bestMove = moves[i];
                }
            }
        }

        return bestMove;
    }

    function checkWinner(bd) {
        const winningCombos = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6],
        ];

        for (let combo of winningCombos) {
            const [a, b, c] = combo;
            if (bd[a] !== '-' && bd[a] === bd[b] && bd[a] === bd[c]) {
                return bd[a];
            }
        }

        return null;
    }

    const bestMove = minimax(board, aiSymbol);
    return bestMove.index;
}

function makeAIMove(game) {
    if (game.winner) return;

    const aiSymbol = 'O';
    const playerSymbol = 'X';
    const board = game.board;
    const randomMoveProbability = game.randomMoveProbability || 0.3; 

    const thinkingDelay = Math.floor(Math.random() * 1500) + 500; 

    setTimeout(() => {
        const move = getAIMove(board, aiSymbol, playerSymbol, randomMoveProbability);

        if (move !== undefined && move !== -1 && game.board[move] === '-') {
            game.board = game.board.substring(0, move) + aiSymbol + game.board.substring(move + 1);
            console.log(`AI placed ${aiSymbol} in cell ${move} of single-player game ${game.id}.`);

            if (checkSinglePlayerGameOver(game)) {
                const message = game.winner === 'Draw' ? "It's a draw!" :
                    (game.winner === 'Player' ? 'You win!' : 'You lose!');
                updateSinglePlayerGameBoardImage(game, game.player, currentPixelColor, message);
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

            updateSinglePlayerGameBoardImage(game, game.player, currentPixelColor);
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
            console.error(`AI attempted to place on an occupied cell ${move} in game ${game.id}.`);

        }
    }, thinkingDelay);
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
        board: '---------',
        currentPlayer: 'Player', 
        stream: mjpegReqHandler,
        image: null,
        lastActive: Date.now(),
        winner: null,
        timeout: null,
        randomMoveProbability: randomMoveProbability, 
    };
    singlePlayerGames[gameId] = newGame;
    singlePlayerIdToGame[playerId] = gameId;
    playerIdToHashedIP[playerId] = hashIP(req.connection.remoteAddress);

    console.log(`Single-player Game ${gameId} started for player ${playerId} with difficulty '${difficulty}'`);

    setupSinglePlayerStreamListeners(playerId, newGame);

    updateSinglePlayerGameBoardImage(newGame, playerId, currentPixelColor);
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
    const playerId = getPlayerId(req);
    const cell = parseInt(req.query.cell);

    if (!singlePlayerIdToGame[playerId]) {

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    const gameId = singlePlayerIdToGame[playerId];
    const game = singlePlayerGames[gameId];

    if (!game) {

        console.log(`Single-player Game ${gameId} not found for player ${playerId}.`);
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    if (game.currentPlayer !== 'Player') {
        sendSinglePlayerError(game, playerId, 'Not your turn.');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    if (isNaN(cell) || cell < 0 || cell > 8 || game.board[cell] !== '-') {
        sendSinglePlayerError(game, playerId, 'Invalid move.');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    const playerSymbol = 'X';
    game.board = game.board.substring(0, cell) + playerSymbol + game.board.substring(cell + 1);
    game.currentPlayer = 'AI';

    console.log(`Player ${playerId} placed ${playerSymbol} in cell ${cell} of single-player game ${gameId}.`);

    if (checkSinglePlayerGameOver(game)) {
        const message = game.winner === 'Draw' ? "It's a draw!" :
            (game.winner === 'Player' ? 'You win!' : 'You lose!');
        updateSinglePlayerGameBoardImage(game, playerId, currentPixelColor, message);
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

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    updateSinglePlayerGameBoardImage(game, playerId, currentPixelColor);
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

    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': transparentPNGBuffer.length,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    });
    res.end(transparentPNGBuffer);
});

function sendSinglePlayerError(game, playerId, message) {
    console.log(`Error for player ${playerId}: ${message}`);
    updateSinglePlayerGameBoardImage(game, playerId, currentPixelColor, message);

    setTimeout(() => {
        updateSinglePlayerGameBoardImage(game, playerId, currentPixelColor);
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

function handleDisconnectedPlayer(playerId, gameId) {
    const game = games[gameId];
    if (!game) return;

    console.log(`Player ${playerId} disconnected from game ${gameId}. Ending game.`);

    game.players.forEach((pid) => {
        if (pid !== playerId && game.streams[pid]) {
            updateGameBoardImage(game, pid, currentPixelColor, 'Opponent disconnected. You win by default.');
            try {
                game.streams[pid].stream.write(game.images[pid]);
                game.streams[pid].lastActive = Date.now(); 
            } catch (err) {
                console.error(`Error notifying player ${pid} about opponent disconnection:`, err);
                handleDisconnectedPlayer(pid, gameId);
            }
        }
    });

    endGame(gameId);
}

app.get('/stream', (req, res) => {
    const playerId = getPlayerId(req);

    const mjpegReqHandler = new MJPEG.createReqHandler(req, res);

    if (!playerIdToGame[playerId]) {

        waitingPlayersStreams[playerId] = {
            stream: mjpegReqHandler,
            lastActive: Date.now()
        };

        updateWaitingImage(playerId);

        pairPlayer(playerId);

        setupStreamListeners(playerId, null, 'waiting');

        return;
    }

    const gameId = playerIdToGame[playerId];
    const game = games[gameId];

    if (!game) {

        console.log(`Game ${gameId} not found for player ${playerId}.`);
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    game.streams[playerId] = {
        stream: mjpegReqHandler,
        lastActive: Date.now()
    };

    setupStreamListeners(playerId, game, 'game');

    updateGameBoardImage(game, playerId, currentPixelColor);
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
});

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

    const opponentId = game.players.find(pid => pid !== playerId);
    console.log(`Player ${playerId} disconnected from game ${gameId}. Ending game.`);

    if (game.streams[opponentId]) {
        updateGameBoardImage(game, opponentId, currentPixelColor, 'Opponent disconnected.');
        const opponentStreamObj = game.streams[opponentId];
        if (opponentStreamObj && game.images[opponentId]) {
            try {
                opponentStreamObj.stream.write(game.images[opponentId]);
            } catch (err) {
                console.error(`Error notifying opponent ${opponentId} about disconnection:`, err);
                handleDisconnectedPlayer(opponentId, gameId);
            }
        }
    }

    endGame(gameId);
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
}

setInterval(checkInactiveStreams, 5000); 

app.get('/make_move', (req, res) => {
    const playerId = getPlayerId(req);
    const cell = parseInt(req.query.cell);

    if (!playerIdToGame[playerId]) {

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    const gameId = playerIdToGame[playerId];
    const game = games[gameId];

    if (!game) {

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    if (game.currentPlayer !== playerId) {
        sendError(game, playerId, 'Not your turn.');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    if (isNaN(cell) || cell < 0 || cell > 8 || game.board[cell] !== '-') {
        sendError(game, playerId, 'Invalid move.');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    const symbol = getSymbol(playerId, game);
    game.board = game.board.substring(0, cell) + symbol + game.board.substring(cell + 1);
    game.currentPlayer = game.players.find((pid) => pid !== playerId);

    console.log(`Player ${playerId} placed ${symbol} in cell ${cell} of game ${gameId}.`);

    if (checkGameOver(game)) {
        const message = game.winner === 'Draw' ? "It's a draw!" :
            (getSymbol(playerId, game) === game.winner ? 'You win!' : 'You lose!');
        game.players.forEach((pid) => {
            updateGameBoardImage(game, pid, currentPixelColor, message);
            const streamObj = game.streams[pid];
            if (streamObj && game.images[pid]) {
                try {
                    streamObj.stream.write(game.images[pid]);
                    streamObj.lastActive = Date.now(); 
                } catch (err) {
                    console.error(`Error writing game over image to player ${pid}:`, err);
                    handleDisconnectedPlayer(pid, gameId);
                }
            }
        });

        console.log(`Game ${gameId} concluded with result: ${game.winner}.`);

        game.timeout = setTimeout(() => {
            endGame(gameId);
        }, 10000); 

        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': transparentPNGBuffer.length,
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        });
        res.end(transparentPNGBuffer);
        return;
    }

    game.players.forEach((pid) => {
        updateGameBoardImage(game, pid, currentPixelColor);
        const streamObj = game.streams[pid];
        if (streamObj && game.images[pid]) {
            try {
                streamObj.stream.write(game.images[pid]);
                streamObj.lastActive = Date.now(); 
            } catch (err) {
                console.error(`Error writing updated game board to player ${pid}:`, err);
                handleDisconnectedPlayer(pid, gameId);
            }
        }
    });

    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': transparentPNGBuffer.length,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    });
    res.end(transparentPNGBuffer);
});

app.get('/', (req, res) => {
    res.json({});
});

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));

const server = https.createServer(options, app);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});