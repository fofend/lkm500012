const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

/* =========================
   정적 파일 서빙
========================= */
app.use(express.static(__dirname));

/* =========================
   메인 페이지
========================= */
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});


app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\n\nSitemap: https://nanachat-unzb.onrender.com/sitemap.xml');
});

/* =========================
   사이트맵 명시 서빙
========================= */
app.get('/sitemap.xml', (req, res) => {
    res.sendFile(__dirname + '/sitemap.xml');
});

/* =========================
   catch-all (SPA 대응)
========================= */
app.get('/{*splat}', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

/* =========================
   매칭 시스템
========================= */
let waitingUsers = [];
let totalConnections = 0;

/* =========================
   유틸 함수
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

function endCurrentChat(socket, message = null) {
    const partnerSocket = getPartnerSocket(socket);
    const roomId = socket.roomId;

    removeFromWaitingQueue(socket.id);

    if (partnerSocket) {
        removeFromWaitingQueue(partnerSocket.id);
    }

    if (partnerSocket && roomId && message) {
        partnerSocket.emit('partner-left', message);
    }

    if (partnerSocket) {
        if (roomId) partnerSocket.leave(roomId);
        resetSocketState(partnerSocket);
    }

    if (roomId) socket.leave(roomId);
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

/* =========================
   Socket 연결
========================= */

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

    /* =========================
       차단
    ========================= */
    socket.on('block-user', () => {
        if (!socket.currentPartnerId || !socket.roomId) return;

        socket.blacklist.add(socket.currentPartnerId);

        endCurrentChat(socket, '상대방이 당신을 차단하고 떠났습니다.');

        socket.emit('start-re-match');
    });

    /* =========================
       신고 (차단 포함)
    ========================= */
    socket.on('report-user', () => {
        if (!socket.currentPartnerId || !socket.roomId) return;

        socket.blacklist.add(socket.currentPartnerId);

        endCurrentChat(socket, '상대방이 당신을 신고하고 대화를 종료했습니다.');

        socket.emit('start-re-match');
    });

    /* =========================
       매칭 시작
    ========================= */
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

    /* =========================
       메시지
    ========================= */
    socket.on('message', (msg) => {
        if (!socket.roomId) return;

        const cleanMsg = String(msg || '').trim();
        if (!cleanMsg) return;



        socket.emit('message-ok', cleanMsg);
        socket.to(socket.roomId).emit('chat-msg', {
            sender: socket.nickname,
            text: cleanMsg
        });

        socket.to(socket.roomId).emit('stop-partner-typing');
    });

    /* =========================
       타이핑
    ========================= */
    socket.on('typing', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('partner-typing');
    });

    socket.on('stop-typing', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('stop-partner-typing');
    });

    /* =========================
       재매칭
    ========================= */
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

    /* =========================
       연결 종료
    ========================= */
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

/* =========================
   서버 실행
========================= */
http.listen(3000, () => {
    console.log('Server running on 3000');
});