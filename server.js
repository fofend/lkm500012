const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(
`User-agent: *
Allow: /

Sitemap: https://nanachat-unzb.onrender.com/sitemap.xml`
    );
});

// Express 5 대응용 catch-all 라우트
app.get('/{*splat}', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let waitingUsers = [];
let totalConnections = 0;

/* =========================
   공통 유틸
========================= */

function updateStats() {
    io.emit('server-stats', {
        currentUsers: totalConnections,
        waiting: waitingUsers.length
    });
}

function removeFromWaitingQueue(socketId) {
    waitingUsers = waitingUsers.filter(user => user.id !== socketId);
}

function resetSocketState(socket) {
    socket.roomId = null;
    socket.currentPartnerId = null;
}

function getPartnerSocket(socket) {
    if (!socket.currentPartnerId) return null;
    return io.sockets.sockets.get(socket.currentPartnerId) || null;
}

function endCurrentChat(socket, partnerLeftMessage = null) {
    const partnerSocket = getPartnerSocket(socket);
    const roomId = socket.roomId;

    removeFromWaitingQueue(socket.id);

    if (partnerSocket) {
        removeFromWaitingQueue(partnerSocket.id);
    }

    if (partnerSocket && roomId && partnerLeftMessage) {
        partnerSocket.emit('partner-left', partnerLeftMessage);
    }

    if (partnerSocket) {
        if (roomId) {
            partnerSocket.leave(roomId);
        }
        resetSocketState(partnerSocket);
    }

    if (roomId) {
        socket.leave(roomId);
    }
    resetSocketState(socket);

    updateStats();
}

function findMatchFor(socket) {
    return waitingUsers.findIndex(user => {
        if (!user || !user.socket) return false;
        if (user.id === socket.id) return false;

        const otherSocket = user.socket;

        if (socket.roomId || otherSocket.roomId) return false;

        const isNotBlacklisted =
            !socket.blacklist.has(user.id) &&
            !otherSocket.blacklist.has(socket.id);

        if (!isNotBlacklisted) return false;

        const iWantThem =
            socket.wantGender === 'all' || socket.wantGender === user.gender;

        const theyWantMe =
            user.wantGender === 'all' || user.wantGender === socket.gender;

        return iWantThem && theyWantMe;
    });
}

function matchUsers(socket, partnerEntry) {
    const partnerSocket = partnerEntry.socket;

    removeFromWaitingQueue(socket.id);
    removeFromWaitingQueue(partnerSocket.id);

    const roomId = `room-${partnerSocket.id}-${socket.id}`;

    socket.join(roomId);
    partnerSocket.join(roomId);

    socket.roomId = roomId;
    partnerSocket.roomId = roomId;

    socket.currentPartnerId = partnerSocket.id;
    partnerSocket.currentPartnerId = socket.id;

    socket.emit('matched', {
        msg: '연결됨',
        partnerGender: partnerEntry.gender,
        partnerInterest: partnerEntry.interest,
        partnerNickname: partnerEntry.nickname
    });

    partnerSocket.emit('matched', {
        msg: '연결됨',
        partnerGender: socket.gender,
        partnerInterest: socket.interest,
        partnerNickname: socket.nickname
    });

    updateStats();
}

io.on('connection', (socket) => {
    totalConnections++;

    socket.blacklist = new Set();
    socket.nickname = '익명';
    socket.gender = '';
    socket.wantGender = 'all';
    socket.interest = '';
    socket.roomId = null;
    socket.currentPartnerId = null;

    updateStats();

    socket.on('block-user', () => {
        if (!socket.currentPartnerId || !socket.roomId) return;

        socket.blacklist.add(socket.currentPartnerId);

        endCurrentChat(socket, '상대방이 당신을 차단하고 떠났습니다.');

        socket.emit('start-re-match');
    });

    socket.on('join', (data) => {
        removeFromWaitingQueue(socket.id);

        socket.nickname = data.nickname || '익명';
        socket.gender = data.gender || '';
        socket.wantGender = data.wantGender || 'all';
        socket.interest = data.interest ? data.interest.trim() : '';

        if (socket.roomId) {
            updateStats();
            return;
        }

        const partnerIndex = findMatchFor(socket);

        if (partnerIndex !== -1) {
            const partner = waitingUsers[partnerIndex];
            matchUsers(socket, partner);
        } else {
            waitingUsers.push({
                id: socket.id,
                gender: socket.gender,
                wantGender: socket.wantGender,
                nickname: socket.nickname,
                interest: socket.interest,
                socket
            });
            updateStats();
        }
    });

    socket.on('message', (msg) => {
        if (!socket.roomId) return;

        socket.emit('message-ok', msg);
        socket.to(socket.roomId).emit('chat-msg', {
            sender: socket.nickname,
            text: msg
        });
        socket.to(socket.roomId).emit('stop-partner-typing');
    });

    socket.on('typing', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('partner-typing');
    });

    socket.on('stop-typing', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('stop-partner-typing');
    });

    socket.on('re-match', () => {
        if (socket.roomId) {
            endCurrentChat(socket, '상대방이 종료했습니다.');
        } else {
            removeFromWaitingQueue(socket.id);
            resetSocketState(socket);
            updateStats();
        }

        socket.emit('start-re-match');
    });

    socket.on('disconnect', () => {
        totalConnections--;

        if (socket.roomId) {
            endCurrentChat(socket, '상대방 연결 끊김');
        } else {
            removeFromWaitingQueue(socket.id);
            resetSocketState(socket);
            updateStats();
        }
    });
});

http.listen(3000, () => {
    console.log('Server running on 3000');
});