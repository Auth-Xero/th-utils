const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');
const MJPEG = require('mjpeg-server');
const { createCanvas } = require('canvas');
const crypto = require('crypto');

const app = express();
const PORT = 8443;

const options = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'privkey.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'fullchain.pem'))
};

let singlePlayerGames = {};
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

function generateTransparentPNG() {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, 1, 1);

    return canvas.toBuffer('image/png');
}

const transparentPNGBuffer = generateTransparentPNG();

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

function getRandomWord() {
    const words = ["able", "about", "account", "acid", "across", "act", "addition", "adjustment", "advertisement", "after", "again", "against", "agreement", "air", "all", "almost", "among", "amount", "amusement", "and", "angle", "angry", "animal", "answer", "ant", "any", "apparatus", "apple", "approval", "arch", "argument", "arm", "army", "art", "as", "at", "attack", "attempt", "attention", "attraction", "authority", "automatic", "awake", "baby", "back", "bad", "bag", "balance", "ball", "band", "base", "basin", "basket", "bath", "be", "beautiful", "because", "bed", "bee", "before", "behaviour", "belief", "bell", "bent", "berry", "between", "bird", "birth", "bit", "bite", "bitter", "black", "blade", "blood", "blow", "blue", "board", "boat", "body", "boiling", "bone", "book", "boot", "bottle", "box", "boy", "brain", "brake", "branch", "brass", "bread", "breath", "brick", "bridge", "bright", "broken", "brother", "brown", "brush", "bucket", "building", "bulb", "burn", "burst", "business", "but", "butter", "button", "by", "cake", "camera", "canvas", "card", "care", "carriage", "cart", "cat", "cause", "certain", "chain", "chalk", "chance", "change", "cheap", "cheese", "chemical", "chest", "chief", "chin", "church", "circle", "clean", "clear", "clock", "cloth", "cloud", "coal", "coat", "cold", "collar", "colour", "comb", "come", "comfort", "committee", "common", "company", "comparison", "competition", "complete", "complex", "condition", "connection", "conscious", "control", "cook", "copper", "copy", "cord", "cork", "cotton", "cough", "country", "cover", "cow", "crack", "credit", "crime", "cruel", "crush", "cry", "cup", "cup", "current", "curtain", "curve", "cushion", "damage", "danger", "dark", "daughter", "day", "dead", "dear", "death", "debt", "decision", "deep", "degree", "delicate", "dependent", "design", "desire", "destruction", "detail", "development", "different", "digestion", "direction", "dirty", "discovery", "discussion", "disease", "disgust", "distance", "distribution", "division", "do", "dog", "door", "doubt", "down", "drain", "drawer", "dress", "drink", "driving", "drop", "dry", "dust", "ear", "early", "earth", "east", "edge", "education", "effect", "egg", "elastic", "electric", "end", "engine", "enough", "equal", "error", "even", "event", "ever", "every", "example", "exchange", "existence", "expansion", "experience", "expert", "eye", "face", "fact", "fall", "false", "family", "far", "farm", "fat", "father", "fear", "feather", "feeble", "feeling", "female", "fertile", "fiction", "field", "fight", "finger", "fire", "first", "fish", "fixed", "flag", "flame", "flat", "flight", "floor", "flower", "fly", "fold", "food", "foolish", "foot", "for", "force", "fork", "form", "forward", "fowl", "frame", "free", "frequent", "friend", "from", "front", "fruit", "full", "future", "garden", "general", "get", "girl", "give", "glass", "glove", "go", "goat", "gold", "good", "government", "grain", "grass", "great", "green", "grey", "grip", "group", "growth", "guide", "gun", "hair", "hammer", "hand", "hanging", "happy", "harbour", "hard", "harmony", "hat", "hate", "have", "he", "head", "healthy", "hear", "hearing", "heart", "heat", "help", "high", "history", "hole", "hollow", "hook", "hope", "horn", "horse", "hospital", "hour", "house", "how", "humour", "I", "ice", "idea", "if", "ill", "important", "impulse", "in", "increase", "industry", "ink", "insect", "instrument", "insurance", "interest", "invention", "iron", "island", "jelly", "jewel", "join", "journey", "judge", "jump", "keep", "kettle", "key", "kick", "kind", "kiss", "knee", "knife", "knot", "knowledge", "land", "language", "last", "late", "laugh", "law", "lead", "leaf", "learning", "leather", "left", "leg", "let", "letter", "level", "library", "lift", "light", "like", "limit", "line", "linen", "lip", "liquid", "list", "little", "living", "lock", "long", "look", "loose", "loss", "loud", "love", "low", "machine", "make", "male", "man", "manager", "map", "mark", "market", "married", "mass", "match", "material", "may", "meal", "measure", "meat", "medical", "meeting", "memory", "metal", "middle", "military", "milk", "mind", "mine", "minute", "mist", "mixed", "money", "monkey", "month", "moon", "morning", "mother", "motion", "mountain", "mouth", "move", "much", "muscle", "music", "nail", "name", "narrow", "nation", "natural", "near", "necessary", "neck", "need", "needle", "nerve", "net", "new", "news", "night", "no", "noise", "normal", "north", "nose", "not", "note", "now", "number", "nut", "observation", "of", "off", "offer", "office", "oil", "old", "on", "only", "open", "operation", "opinion", "opposite", "or", "orange", "order", "organization", "ornament", "other", "out", "oven", "over", "owner", "page", "pain", "paint", "paper", "parallel", "parcel", "part", "past", "paste", "payment", "peace", "pen", "pencil", "person", "physical", "picture", "pig", "pin", "pipe", "place", "plane", "plant", "plate", "play", "please", "pleasure", "plough", "pocket", "point", "poison", "polish", "political", "poor", "porter", "position", "possible", "pot", "potato", "powder", "power", "present", "price", "print", "prison", "private", "probable", "process", "produce", "profit", "property", "prose", "protest", "public", "pull", "pump", "punishment", "purpose", "push", "put", "quality", "question", "quick", "quiet", "quite", "rail", "rain", "range", "rat", "rate", "ray", "reaction", "reading", "ready", "reason", "receipt", "record", "red", "regret", "regular", "relation", "religion", "representative", "request", "respect", "responsible", "rest", "reward", "rhythm", "rice", "right", "ring", "river", "road", "rod", "roll", "roof", "room", "root", "rough", "round", "rub", "rule", "run", "sad", "safe", "sail", "salt", "same", "sand", "say", "scale", "school", "science", "scissors", "screw", "sea", "seat", "second", "secret", "secretary", "see", "seed", "seem", "selection", "self", "send", "sense", "separate", "serious", "servant", "sex", "shade", "shake", "shame", "sharp", "sheep", "shelf", "ship", "shirt", "shock", "shoe", "short", "shut", "side", "sign", "silk", "silver", "simple", "sister", "size", "skin", "skirt", "sky", "sleep", "slip", "slope", "slow", "small", "smash", "smell", "smile", "smoke", "smooth", "snake", "sneeze", "snow", "so", "soap", "society", "sock", "soft", "solid", "some", "", "son", "song", "sort", "sound", "soup", "south", "space", "spade", "special", "sponge", "spoon", "spring", "square", "stage", "stamp", "star", "start", "statement", "station", "steam", "steel", "stem", "step", "stick", "sticky", "stiff", "still", "stitch", "stocking", "stomach", "stone", "stop", "store", "story", "straight", "strange", "street", "stretch", "strong", "structure", "substance", "such", "sudden", "sugar", "suggestion", "summer", "sun", "support", "surprise", "sweet", "swim", "system", "table", "tail", "take", "talk", "tall", "taste", "tax", "teaching", "tendency", "test", "than", "that", "the", "then", "theory", "there", "thick", "thin", "thing", "this", "thought", "thread", "throat", "through", "through", "thumb", "thunder", "ticket", "tight", "till", "time", "tin", "tired", "to", "toe", "together", "tomorrow", "tongue", "tooth", "top", "touch", "town", "trade", "train", "transport", "tray", "tree", "trick", "trouble", "trousers", "true", "turn", "twist", "umbrella", "under", "unit", "up", "use", "value", "verse", "very", "vessel", "view", "violent", "voice", "waiting", "walk", "wall", "war", "warm", "wash", "waste", "watch", "water", "wave", "wax", "way", "weather", "week", "weight", "well", "west", "wet", "wheel", "when", "where", "while", "whip", "whistle", "white", "who", "why", "wide", "will", "wind", "window", "wine", "wing", "winter", "wire", "wise", "with", "woman", "wood", "wool", "word", "work", "worm", "wound", "writing", "wrong", "year", "yellow", "yes", "yesterday", "you", "young", 'javascript', 'hangman', 'programming', 'developer', 'computer', 'internet'];
    return words[Math.floor(Math.random() * words.length)].toUpperCase();
}

function drawHangman(ctx, wrongGuesses) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000000';

    ctx.beginPath();
    ctx.moveTo(50, 350);
    ctx.lineTo(150, 350);
    ctx.moveTo(100, 350);
    ctx.lineTo(100, 50);
    ctx.lineTo(250, 50);
    ctx.lineTo(250, 100);
    ctx.stroke();

    if (wrongGuesses > 0) {

        ctx.beginPath();
        ctx.arc(250, 130, 30, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (wrongGuesses > 1) {

        ctx.beginPath();
        ctx.moveTo(250, 160);
        ctx.lineTo(250, 250);
        ctx.stroke();
    }
    if (wrongGuesses > 2) {

        ctx.beginPath();
        ctx.moveTo(250, 180);
        ctx.lineTo(200, 220);
        ctx.stroke();
    }
    if (wrongGuesses > 3) {

        ctx.beginPath();
        ctx.moveTo(250, 180);
        ctx.lineTo(300, 220);
        ctx.stroke();
    }
    if (wrongGuesses > 4) {

        ctx.beginPath();
        ctx.moveTo(250, 250);
        ctx.lineTo(200, 300);
        ctx.stroke();
    }
    if (wrongGuesses > 5) {

        ctx.beginPath();
        ctx.moveTo(250, 250);
        ctx.lineTo(300, 300);
        ctx.stroke();
    }
}

function generateGameImage(game, message) {
    const canvasWidth = 700;
    const canvasHeight = 400;
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    drawHangman(ctx, game.wrongGuesses);

    const hangmanAreaWidth = 300; 
    const infoAreaX = hangmanAreaWidth + 20; 
    const infoAreaWidth = canvasWidth - hangmanAreaWidth - 40; 

    ctx.fillStyle = '#000000';
    ctx.font = '36px Arial';
    ctx.textAlign = 'center';
    const displayWord = game.word.split('').map(letter => (game.correctGuesses.includes(letter) ? letter : '_')).join(' ');
    ctx.fillText(displayWord, infoAreaX + infoAreaWidth / 2, 60);

    ctx.fillStyle = '#000000';
    ctx.font = '24px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Time remaining: ${game.timer}s`, 10, 30);

    if (message) {
        ctx.fillStyle = '#ff0000';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        const messageX = infoAreaX + infoAreaWidth / 2;
        const messageY = canvasHeight - 130; 
        const lines = message.split('\n');
        const lineHeight = 30; 

        lines.forEach((line, index) => {
            ctx.fillText(line, messageX, messageY + (index * lineHeight));
        });
    }

    return canvas.toBuffer('image/jpeg');
}

function updateGameImage(game, message) {
    const imageBuffer = generateGameImage(game, message);
    game.image = imageBuffer;
}

function setupStreamListeners(playerId, game) {
    const stream = game.stream;

    stream.on('close', () => {
        console.log(`Stream closed for player ${playerId}.`);
        handleDisconnectedPlayer(playerId, game.id);
    });

    stream.on('error', (err) => {
        console.error(`Stream error for player ${playerId}:`, err);
        handleDisconnectedPlayer(playerId, game.id);
    });
}

function handleDisconnectedPlayer(playerId, gameId) {
    const game = singlePlayerGames[gameId];
    if (!game) return;

    console.log(`Player ${playerId} disconnected from game ${gameId}. Ending game.`);

    endGame(gameId);
}

function endGame(gameId) {
    const game = singlePlayerGames[gameId];
    if (game) {

        if (game.timeout) {
            clearTimeout(game.timeout);
        }

        const playerId = game.playerId;
        if (game.stream) {
            game.stream.close();
            console.log(`Stream for player ${playerId} closed.`);
        }
        delete singlePlayerGames[gameId];
        delete singlePlayerIdToGame[playerId];
        delete playerIdToHashedIP[playerId];
        console.log(`Game ${gameId} ended.`);
    }
}

app.get('/hangman.css', (req, res) => {

    const canvasWidth = 700;
    const canvasHeight = 400;

    const lettersPerRow = 13;
    const leftStartPercent = 40; 
    const leftIncrementPercent = 4; 
    const topFirstRowPercent = 72; 
    const topSecondRowPercent = 79; 

    let cssCode = `

.hangman-image {
    position: relative;
    width: 100%;
    max-width: ${canvasWidth}px;
    height: auto;
    display: block;
}

.letter {
    position: absolute;
    width: 4%;
    cursor: pointer;
    background-color: transparent;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2em;
    font-weight: bold;
    z-index: 2;
    transform: translate(-50%, -50%);
}

.letter.correct {
    color: #00aa00;
    cursor: default;
}

.letter.incorrect {
    color: #aa0000;
    cursor: default;
}
`;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < alphabet.length; i++) {
        const letter = alphabet[i];
        const col = i % lettersPerRow;
        const row = Math.floor(i / lettersPerRow);
        const xPercent = leftStartPercent + col * leftIncrementPercent;
        const yPercent = row === 0 ? topFirstRowPercent : topSecondRowPercent;

        cssCode += `

.letter-${letter} { top: ${yPercent}%; left: ${xPercent}%; }
`;
    }

    res.set('Content-Type', 'text/css');
    res.send(cssCode);
});

function resetGame(game) {

    game.word = getRandomWord();
    game.correctGuesses = [];
    game.incorrectGuesses = [];
    game.wrongGuesses = 0;
    game.lastActive = Date.now();
    game.winner = null;
    game.timer = 90;
    game.image = null;
    game.timeout = null;

    console.log(`Game ${game.id} reset. New word is "${game.word}".`);

    updateGameImage(game);
    const image = game.image;
    const stream = game.stream;
    if (image) {
        try {
            stream.write(image);
            game.lastActive = Date.now();
        } catch (err) {
            console.error(`Error writing reset image to player ${game.playerId}:`, err);
            handleDisconnectedPlayer(game.playerId, game.id);
        }
    }
}

function checkGameOver(game) {
    const wordComplete = game.word.split('').every(letter => game.correctGuesses.includes(letter));
    if (wordComplete) {
        game.winner = 'Player';
        return true;
    }
    if (game.wrongGuesses >= 6) {
        game.winner = 'AI';
        return true;
    }
    return false;
}

function checkInactiveStreams() {
    const now = Date.now();
    const timeout = 15000;

    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (now - game.lastActive > timeout) {
            console.log(`Player ${game.playerId} in game ${gameId} inactive for over 15 seconds. Ending game.`);
            endGame(gameId);
        }
    }
}

setInterval(checkInactiveStreams, 5000);

setInterval(() => {
    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (game.timer > 0 && !game.winner) {
            game.timer--;
            updateGameImage(game);
        } else if (game.timer === 0 && !game.winner) {

            game.winner = 'AI';
            console.log(`Game ${gameId} timer expired. Player loses by default.`);
            updateGameImage(game, 'Time\'s up! You lose!');
            if (game.stream && game.image) {
                try {
                    game.stream.write(game.image);
                    game.lastActive = Date.now();
                } catch (err) {
                    console.error(`Error sending final image to player ${game.playerId}:`, err);
                    handleDisconnectedPlayer(game.playerId, gameId);
                }
            }

            game.timeout = setTimeout(() => {
                resetGame(game);
            }, 10000);
        }
    }
}, 1000);  

setInterval(() => {
    for (const gameId in singlePlayerGames) {
        const game = singlePlayerGames[gameId];
        if (game.stream && game.image) {
            try {
                game.stream.write(game.image);
                game.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing to stream for player ${game.playerId} in game ${gameId}:`, err);
                handleDisconnectedPlayer(game.playerId, gameId);
            }
        }
    }
}, 100);

app.get('/hangman_stream', (req, res) => {
    const playerId = getPlayerId(req);

    const mjpegReqHandler = new MJPEG.createReqHandler(req, res);

    const gameId = generateGameId();
    const newGame = {
        id: gameId,
        playerId: playerId,
        word: getRandomWord(),
        correctGuesses: [],
        incorrectGuesses: [],
        wrongGuesses: 0,
        stream: mjpegReqHandler,
        image: null,
        lastActive: Date.now(),
        winner: null,
        timeout: null,
        timer: 90,  
    };
    singlePlayerGames[gameId] = newGame;
    singlePlayerIdToGame[playerId] = gameId;
    playerIdToHashedIP[playerId] = hashIP(req.connection.remoteAddress);

    console.log(`Game ${gameId} started for player ${playerId}. Word is "${newGame.word}".`);

    setupStreamListeners(playerId, newGame);

    updateGameImage(newGame);
    const image = newGame.image;
    const stream = newGame.stream;
    if (image) {
        try {
            stream.write(image);
            newGame.lastActive = Date.now();
        } catch (err) {
            console.error(`Error writing initial image to stream for player ${playerId}:`, err);
            handleDisconnectedPlayer(playerId, gameId);
        }
    }
});

app.get('/hangman_guess', (req, res) => {
    const playerId = getPlayerId(req);
    const letter = req.query.letter ? req.query.letter.toUpperCase() : '';

    if (!singlePlayerIdToGame[playerId]) {
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    const gameId = singlePlayerIdToGame[playerId];
    const game = singlePlayerGames[gameId];

    if (!game) {
        console.log(`Game ${gameId} not found for player ${playerId}.`);
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    if (game.winner) {

        console.log(`Player ${playerId} attempted to guess after game over in game ${gameId}.`);
        const uniqueImage = generateUniqueTransparentPNG();
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': uniqueImage.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });
        res.end(uniqueImage);
        return;
    }

    if (!letter || !/^[A-Z]$/.test(letter)) {
        sendError(game, 'Invalid guess.');
        sendTransparentImage(res);
        return;
    }

    if (game.correctGuesses.includes(letter) || game.incorrectGuesses.includes(letter)) {
        sendError(game, 'Letter already guessed.');
        sendTransparentImage(res);
        return;
    }

    if (game.word.includes(letter)) {
        game.correctGuesses.push(letter);
        console.log(`Player ${playerId} guessed correct letter "${letter}" in game ${gameId}.`);
    } else {
        game.incorrectGuesses.push(letter);
        game.wrongGuesses++;
        console.log(`Player ${playerId} guessed wrong letter "${letter}" in game ${gameId}.`);
    }

    if (checkGameOver(game)) {
        const message = game.winner === 'Player' ? 'You win!' : `You lose! The word was "${game.word}"`;
        updateGameImage(game, message);
        if (game.stream && game.image) {
            try {
                game.stream.write(game.image);
                game.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing game over image to player ${playerId}:`, err);
                handleDisconnectedPlayer(playerId, gameId);
            }
        }

        console.log(`Game ${gameId} concluded with result: ${game.winner}.`);

        game.timeout = setTimeout(() => {
            resetGame(game);
        }, 10000);

        sendTransparentImage(res);
        return;
    }

    updateGameImage(game);
    if (game.stream && game.image) {
        try {
            game.stream.write(game.image);
            game.lastActive = Date.now();
        } catch (err) {
            console.error(`Error writing updated game image to player ${playerId}:`, err);
            handleDisconnectedPlayer(playerId, gameId);
        }
    }

    sendTransparentImage(res);
});

function sendError(game, message) {
    console.log(`Error: ${message}`);
    updateGameImage(game, message);

    setTimeout(() => {
        updateGameImage(game);
        const image = game.image;
        const stream = game.stream;
        if (stream && image) {
            try {
                stream.write(image);
                game.lastActive = Date.now();
            } catch (err) {
                console.error(`Error writing to stream:`, err);
                handleDisconnectedPlayer(game.playerId, game.id);
            }
        }
    }, 2000);
}

function sendTransparentImage(res) {
    const uniqueImage = generateUniqueTransparentPNG();
    res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': uniqueImage.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    res.end(uniqueImage);
}

app.get('/', (req, res) => {
    res.json({});
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