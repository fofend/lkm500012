const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// 3️⃣ robots.txt (수정 버전)
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(
`User-agent: *
Allow: /

Sitemap: https://nanachat-unzb.onrender.com/sitemap.xml`
    );
});

app.get('*', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let waitingUsers = [];
let totalConnections = 0;

/* =========================
   공통 유틸
========================= */

// 현재 접속 소켓 수 / 대기열 수 브로드캐스트
function updateStats() {
    io.emit('server-stats', {
        currentUsers: totalConnections,
        waiting: waitingUsers.length
    });
}

// 대기열에서 특정 소켓 제거
function removeFromWaitingQueue(socketId) {
    waitingUsers = waitingUsers.filter(user => user.id !== socketId);
}

// 소켓 기본 상태 초기화
function resetSocketState(socket) {
    socket.roomId = null;
    socket.currentPartnerId = null;
}

// 상대 소켓 찾기
function getPartnerSocket(socket) {
    if (!socket.currentPartnerId) return null;
    return io.sockets.sockets.get(socket.currentPartnerId) || null;
}

// 현재 방/상태를 양쪽 모두 정리
function endCurrentChat(socket, partnerLeftMessage = null) {
    const partnerSocket = getPartnerSocket(socket);
    const roomId = socket.roomId;

    // 내 자신은 대기열에서 제거
    removeFromWaitingQueue(socket.id);

    // 상대가 있으면 상대도 대기열에서 제거
    if (partnerSocket) {
        removeFromWaitingQueue(partnerSocket.id);
    }

    // 상대에게 종료 알림
    if (partnerSocket && roomId && partnerLeftMessage) {
        partnerSocket.emit('partner-left', partnerLeftMessage);
    }

    // 상대 상태 정리
    if (partnerSocket) {
        if (roomId) {
            partnerSocket.leave(roomId);
        }
        resetSocketState(partnerSocket);
    }

    // 내 상태 정리
    if (roomId) {
        socket.leave(roomId);
    }
    resetSocketState(socket);

    updateStats();
}

// 매칭 가능한 상대 찾기
function findMatchFor(socket) {
    return waitingUsers.findIndex(user => {
        if (!user || !user.socket) return false;
        if (user.id === socket.id) return false;

        const otherSocket = user.socket;

        // 이미 방에 있는 유저는 대기열 대상 아님
        if (socket.roomId || otherSocket.roomId) return false;

        // 블랙리스트 상호 체크
        const isNotBlacklisted =
            !socket.blacklist.has(user.id) &&
            !otherSocket.blacklist.has(socket.id);

        if (!isNotBlacklisted) return false;

        // 성별 조건 체크
        const iWantThem =
            socket.wantGender === 'all' || socket.wantGender === user.gender;

        const theyWantMe =
            user.wantGender === 'all' || user.wantGender === socket.gender;

        return iWantThem && theyWantMe;
    });
}

// 1:1 매칭 성립
function matchUsers(socket, partnerEntry) {
    const partnerSocket = partnerEntry.socket;

    // 혹시라도 남아 있는 대기열 중복 제거
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

        // 내 블랙리스트에 상대 추가
        socket.blacklist.add(socket.currentPartnerId);

        // 현재 채팅 종료 + 상대에게 알림
        endCurrentChat(socket, '상대방이 당신을 차단하고 떠났습니다.');

        // 나는 새 매칭 시작
        socket.emit('start-re-match');
    });

    socket.on('join', (data) => {
        // 혹시 join 중복 호출되어도 대기열 중복 방지
        removeFromWaitingQueue(socket.id);

        socket.nickname = data.nickname || '익명';
        socket.gender = data.gender || '';
        socket.wantGender = data.wantGender || 'all';
        socket.interest = data.interest ? data.interest.trim() : '';

        // 이미 방에 들어가 있으면 join 무시
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
        // 기존 채팅 완전히 종료
        if (socket.roomId) {
            endCurrentChat(socket, '상대방이 종료했습니다.');
        } else {
            removeFromWaitingQueue(socket.id);
            resetSocketState(socket);
            updateStats();
        }

        // 본인에게 새 매칭 시작 신호
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
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});
http.listen(3000, () => {
    console.log('Server running on 3000');
});