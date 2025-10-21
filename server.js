const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/mafia_game.html');
});

const rooms = {};
let nightActionResolvers = {};

// --- UTILITY FUNCTIONS ---
function playSoundToRoom(roomId, soundFile) { io.to(roomId).emit('game-update', { event: 'play-sound', file: soundFile }); }
function logToRoom(roomId, message, type = 'narrative') { io.to(roomId).emit('game-update', { event: 'log', message, type }); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function generateDailyHint(room) {
    const { players, roles, previousVotes, eliminatedYesterday, nightActions } = room.gameState;
    const alivePlayers = players.filter(p => p.isAlive);

    if (alivePlayers.length < 4) return null;

    const hintPool = [];

    if (alivePlayers.length >= 2) {
        hintPool.push(() => {
            let player1 = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            let potentialPlayer2 = alivePlayers.filter(p => p.name !== player1.name);
            let player2 = potentialPlayer2[Math.floor(Math.random() * potentialPlayer2.length)];
            return `تقرير الشرطة: شوهد ${player1.name} و ${player2.name} بالقرب من مسرح الجريمة الليلة الماضية.`;
        });
    }
    
    hintPool.push(() => `تقرير الشرطة: يسود الهدوء المريب أحيانًا. بعض الناس يفضلون الاختباء في الظل.`);

    if (nightActions && nightActions.mafiaTarget && nightActions.mafiaTarget === nightActions.doctorSave) {
        hintPool.push(() => `همسة مجهولة: الطبيب نجح في إنقاذ روح بريئة هذه الليلة.`);
    }

    if (previousVotes && eliminatedYesterday && roles[eliminatedYesterday] && roles[eliminatedYesterday].title !== 'المافيا') {
        const aliveMafia = alivePlayers.filter(p => roles[p.name].title === 'المافيا');
        const suspiciousMafia = aliveMafia.find(mafia => previousVotes[mafia.name] === eliminatedYesterday);
        if (suspiciousMafia) {
            hintPool.push(() => `همسة مجهولة: أحد الذين صوتوا ضد ${eliminatedYesterday} بالأمس يخفي سرًا مظلمًا.`);
        }
    }

    if (hintPool.length === 0) return null;
    
    if (Math.random() < 0.25) return null;

    const chosenHintGenerator = hintPool[Math.floor(Math.random() * hintPool.length)];
    return chosenHintGenerator();
}


// --- GAME STATE & LOGIC ---
function createGameState(players, settings) {
    const playerNames = players.map(p => p.name);
    const gameState = {
        players: playerNames.map(name => ({ name, isAlive: true })),
        roles: {}, 
        phase: 'SETUP', 
        dayCount: 0,
        settings,
        previousVotes: null,
        eliminatedYesterday: null,
        eliminatedPlayers: []
    };
    let rolesToAssign = [];
    if (settings && settings.roles) {
        for (const role in settings.roles) {
            for (let i = 0; i < settings.roles[role]; i++) {
                rolesToAssign.push(role);
            }
        }
    }
    rolesToAssign.sort(() => Math.random() - 0.5);
    players.forEach((player, index) => {
        const role = rolesToAssign[index] || 'مواطن';
        const descriptions = {
            'المافيا': 'أنت القاتل. في الليل، اختر ضحية لقتلها.',
            'المحقق': 'أنت الحقيقة. في الليل، اختر شخصًا لكشف هويته.',
            'الطبيب': 'أنت المنقذ. في الليل، اختر شخصًا لحمايته من المافيا.',
            'مواطن': 'أنت بريء. استخدم ذكاءك في النهار لكشف المافيا.'
        };
        const icon = role === 'المافيا' ? '🔪' : role === 'المحقق' ? '🕵️‍♂️' : role === 'الطبيب' ? '👨‍⚕️' : '👤';
        gameState.roles[player.name] = { title: role, icon, description: descriptions[role] };
    });
    return gameState;
}

function checkWinCondition(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameState) return false;
    const alivePlayers = room.gameState.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.isAlive && room.gameState.roles[p.name].title === 'المافيا');
    const aliveCitizens = alivePlayers.length - aliveMafia.length;

    if (aliveMafia.length === 0) {
        logToRoom(roomId, "لقد تم القضاء على كل المافيا! المواطنون ينتصرون!", 'narrative');
        io.to(roomId).emit('game-over', 'المواطنون فازوا!');
        return true;
    }
    if (aliveMafia.length >= aliveCitizens) {
        logToRoom(roomId, "المافيا تسيطر على المدينة! لقد انتصروا!", 'narrative');
        io.to(roomId).emit('game-over', 'المافيا فازت!');
        return true;
    }
    return false;
}

async function startNightPhase(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    room.gameState.phase = 'NIGHT';
    room.gameState.nightActions = {};
    room.gameState.nightActionsSubmitted = {}; 
    nightActionResolvers[roomId] = {};
    
    logToRoom(roomId, `الليلة ${room.gameState.dayCount + 1}... تغلق المدينة أبوابها.`, 'narrative');
    playSoundToRoom(roomId, 'night-begins.mp3');
    io.to(roomId).emit('game-update', { event: 'set-theme', theme: 'night' });
    io.to(roomId).emit('mute-all');
    await delay(4000);

    playSoundToRoom(roomId, 'mafia-awakes.mp3');
    const mafiaChoice = await getNightAction(roomId, 'المافيا', 'أيها المافيا، اختر ضحيتك.', true);
    room.gameState.nightActions.mafiaTarget = mafiaChoice;
    await delay(1000);

    playSoundToRoom(roomId, 'detective-awakes.mp3');
    const detectiveChoice = await getNightAction(roomId, 'المحقق', 'أيها المحقق، اختر من تريد التحقيق فيه.', false);
    if (detectiveChoice) {
        const targetRole = room.gameState.roles[detectiveChoice].title;
        const detective = room.players.find(p => room.gameState.roles[p.name].title === 'المحقق' && room.gameState.players.find(gp => gp.name === p.name && gp.isAlive));
        if (detective) {
            io.to(detective.id).emit('game-update', { event: 'log', message: `نتيجة التحقيق: ${detectiveChoice} هو ${targetRole === 'المافيا' ? 'مافيا!' : 'بريء.'}`, type: 'system' });
        }
    }
    await delay(1000);

    playSoundToRoom(roomId, 'doctor-awakes.mp3');
    const doctorChoice = await getNightAction(roomId, 'الطبيب', 'أيها الطبيب، اختر من تريد إنقاذه.', true);
    room.gameState.nightActions.doctorSave = doctorChoice;
    await delay(1000);
    
    startDayPhase(roomId);
}

function getNightAction(roomId, role, prompt, canChooseSelf) {
    return new Promise(resolve => {
        const room = rooms[roomId];
        const actionTakers = room.players.filter(p => room.gameState.roles[p.name]?.title === role && room.gameState.players.find(gp => gp.name === p.name && gp.isAlive));
        
        if (actionTakers.length > 0) {
            nightActionResolvers[roomId][role] = resolve;
            actionTakers.forEach(player => {
                io.to(player.id).emit('perform-night-action', { prompt, canChooseSelf });
            });
        } else {
            resolve(null);
        }
    });
}

async function startDayPhase(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;

    room.gameState.phase = 'DAY';
    room.gameState.dayCount++; 
    logToRoom(roomId, `النهار ${room.gameState.dayCount}. تشرق الشمس على المدينة...`, 'narrative');
    playSoundToRoom(roomId, 'day-begins.mp3');
    io.to(roomId).emit('game-update', { event: 'set-theme', theme: 'day' });

    const { mafiaTarget, doctorSave } = room.gameState.nightActions;
    const victimName = (mafiaTarget && mafiaTarget !== doctorSave) ? mafiaTarget : null;

    if (victimName) {
        const victim = room.gameState.players.find(p => p.name === victimName);
        if (victim && victim.isAlive) {
            victim.isAlive = false;
            const victimRole = room.gameState.roles[victimName].title;
            room.gameState.eliminatedPlayers.push({ name: victimName, role: victimRole });
            io.to(roomId).emit('player-eliminated', { playerName: victimName, role: victimRole });
            playSoundToRoom(roomId, 'player-eliminated-night.mp3');
            logToRoom(roomId, `بعد ليلة مرعبة، تم العثور على ${victimName} مقتولاً!`, 'alert');
        }
    } else {
        playSoundToRoom(roomId, 'no-one-died.mp3');
        logToRoom(roomId, 'بفضل تدخل ما، مرت الليلة بسلام!', 'narrative');
    }

    await delay(2000);

    if (checkWinCondition(roomId)) return;

    const report = generateDailyHint(room);
    if (report) {
        logToRoom(roomId, report, 'system');
        await delay(4000);
    }

    io.to(roomId).emit('unmute-all');
    playSoundToRoom(roomId, 'discussion-begins.mp3');
    startSpeakingPhase(roomId);
}

function startSpeakingPhase(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    room.gameState.phase = 'SPEAKING';
    room.gameState.speakingOrder = room.gameState.players.filter(p => p.isAlive).map(p => p.name).sort(() => Math.random() - 0.5);
    room.gameState.currentSpeakerIndex = 0;
    giveTurnToNextSpeaker(roomId);
}

function giveTurnToNextSpeaker(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    if (room.gameState.speakerTimer) clearTimeout(room.gameState.speakerTimer);
    if (room.gameState.currentSpeakerIndex >= room.gameState.speakingOrder.length) {
        startVotingPhase(roomId);
        return;
    }
    const speakerName = room.gameState.speakingOrder[room.gameState.currentSpeakerIndex];
    const speakingTime = (room.settings && room.settings.speakingTime) || 60;
    io.to(roomId).emit('start-speaker-turn', { speakerName, time: speakingTime });
    room.gameState.speakerTimer = setTimeout(() => {
        giveTurnToNextSpeaker(roomId);
    }, (speakingTime + 1) * 1000);
    room.gameState.currentSpeakerIndex++;
}

function startVotingPhase(roomId) {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    room.gameState.phase = 'VOTING';
    room.gameState.votes = {};
    playSoundToRoom(roomId, 'voting-begins.mp3');
    logToRoom(roomId, "حان وقت التصويت!", 'alert');
    io.to(roomId).emit('perform-vote');
}

io.on('connection', (socket) => {
    socket.on('create-game', (playerName, settings) => {
        const roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
        rooms[roomId] = { players: [], hostId: socket.id, gameState: null, settings: settings };
        socket.emit('game-created', roomId);
    });

    socket.on('join-room', (roomId, playerName) => {
        const room = rooms[roomId];
        if (!room) { return socket.emit('error-message', 'الغرفة غير موجودة.'); }
        if (room.gameState) { return socket.emit('error-message', 'اللعبة قد بدأت بالفعل.'); }
        if (room.settings && room.players.length >= room.settings.playerCount) { return socket.emit('error-message', 'الغرفة ممتلئة.'); }

        socket.join(roomId);
        room.players.push({ id: socket.id, name: playerName });
        socket.emit('joined-successfully', roomId);
        io.to(roomId).emit('update-room-info', { room: rooms[roomId] });
        socket.to(roomId).emit('user-joined', socket.id);
    });
    
    socket.on('start-game', (roomId) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id && !room.gameState) {
            room.gameState = createGameState(room.players, room.settings);
            
            room.players.forEach(player => {
                const roleInfo = room.gameState.roles[player.name];
                io.to(player.id).emit('receive-role', roleInfo);
            });
            setTimeout(() => {
                startNightPhase(roomId);
            }, 5000);
        }
    });

    socket.on('skip-speaker-turn', (roomId) => {
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        if (room && room.gameState && room.gameState.phase === 'SPEAKING' && player && player.name === room.gameState.speakingOrder[room.gameState.currentSpeakerIndex - 1]) {
            giveTurnToNextSpeaker(roomId);
        }
    });

    socket.on('submit-night-action', (roomId, choice) => {
        const room = rooms[roomId];
        if (!room || !room.gameState) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const role = room.gameState.roles[player.name].title;

        if (room.gameState.nightActionsSubmitted[role]) {
            return;
        }

        if (nightActionResolvers[roomId] && nightActionResolvers[roomId][role]) {
            room.gameState.nightActionsSubmitted[role] = true;
            nightActionResolvers[roomId][role](choice);
        }
    });

    socket.on('submit-vote', (roomId, choice) => {
        const room = rooms[roomId];
        if (!room || !room.gameState || room.gameState.phase !== 'VOTING') return;
        const player = room.players.find(p => p.id === socket.id);
        if(!player || !room.gameState.players.find(p => p.name === player.name && p.isAlive)) return;
        room.gameState.votes[player.name] = choice;
        
        const alivePlayers = room.gameState.players.filter(p => p.isAlive);
        if (Object.keys(room.gameState.votes).length === alivePlayers.length) {
            const voteCounts = {};
            Object.values(room.gameState.votes).forEach(v => { voteCounts[v] = (voteCounts[v] || 0) + 1; });
            let maxVotes = 0;
            let playerToEliminate = null;
            let tie = false;
            for(const playerName in voteCounts) {
                if (voteCounts[playerName] > maxVotes) {
                    maxVotes = voteCounts[playerName];
                    playerToEliminate = playerName;
                    tie = false;
                } else if (voteCounts[playerName] === maxVotes && maxVotes > 0) {
                    tie = true;
                }
            }
            if (playerToEliminate && !tie) {
                const eliminated = room.gameState.players.find(p => p.name === playerToEliminate);
                if(eliminated) {
                    eliminated.isAlive = false;
                    const eliminatedRole = room.gameState.roles[playerToEliminate].title;
                    room.gameState.eliminatedPlayers.push({ name: playerToEliminate, role: eliminatedRole });
                    io.to(roomId).emit('player-eliminated', { playerName: playerToEliminate, role: eliminatedRole });
                    playSoundToRoom(roomId, 'player-eliminated-day.mp3');
                    logToRoom(roomId, `قررت المدينة طرد ${playerToEliminate}. لقد كان... ${eliminatedRole}!`, 'alert');
                }
            } else { 
                logToRoom(roomId, 'لم يتمكن أهل المدينة من الاتفاق على قرار بسبب تعادل الأصوات.', 'narrative'); 
            }
            
            room.gameState.previousVotes = { ...room.gameState.votes };
            room.gameState.eliminatedYesterday = (playerToEliminate && !tie) ? playerToEliminate : null;

            if (checkWinCondition(roomId)) return;

            setTimeout(() => startNightPhase(roomId), 5000);
        }
    });

    socket.on('offer', (targetSocketId, offer) => { socket.to(targetSocketId).emit('offer', socket.id, offer); });
    socket.on('answer', (targetSocketId, answer) => { socket.to(targetSocketId).emit('answer', socket.id, answer); });
    socket.on('ice-candidate', (targetSocketId, candidate) => { socket.to(targetSocketId).emit('ice-candidate', socket.id, candidate); });
    
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const disconnectedPlayerName = room.players[playerIndex].name;
                room.players.splice(playerIndex, 1);
                
                if (room.gameState && room.gameState.players) {
                    const gamePlayer = room.gameState.players.find(p => p.name === disconnectedPlayerName);
                    if (gamePlayer) {
                        gamePlayer.isAlive = false;
                        const disconnectedRole = room.gameState.roles[disconnectedPlayerName].title;
                        room.gameState.eliminatedPlayers.push({ name: disconnectedPlayerName, role: disconnectedRole });
                        io.to(roomId).emit('player-eliminated', { playerName: disconnectedPlayerName, role: disconnectedRole });
                        logToRoom(roomId, `${disconnectedPlayerName} قد غادر اللعبة.`, 'system');
                        checkWinCondition(roomId);
                    }
                }

                if (room.hostId === socket.id && room.players.length > 0) { room.hostId = room.players[0].id; }
                
                io.to(roomId).emit('update-room-info', { room: rooms[roomId] });
                io.to(roomId).emit('user-left', socket.id);

                if (room.players.length === 0) { delete rooms[roomId]; }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
