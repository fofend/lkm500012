const express = require('express');
const app = express();

// 👉 301 리디렉션 (중요)
app.use((req, res, next) => {
    const host = req.headers.host;

    if (host === 'nanachat-unzb.onrender.com' || host === 'www.nanachatapp.com') {
        return res.redirect(301, 'https://nanachatapp.com' + req.url);
    }

    next();
});

const http = require('http').createServer(app);
const io = require('socket.io')(http);

const path = require('path');

/* =========================
   정적 파일 서빙
========================= */
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
   메인 페이지
========================= */
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});


app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\n\nSitemap: https://nanachatapp.com/sitemap.xml');
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
const reportLogs = [];
const reportCounts = new Map();
const reportCooldowns = new Map();
const restrictedUsers = new Map();
const roomWarningShown = new Set();

const REPORT_COOLDOWN_MS = 60 * 1000;
const REPORT_RESTRICT_THRESHOLD = 3;
const REPORT_RESTRICT_MS = 30 * 60 * 1000;
const MESSAGE_MAX_LENGTH = 300;
const SPAM_WINDOW_MS = 3000;
const SPAM_MAX_MESSAGES = 5;
const SAME_MESSAGE_RESET_MS = 3000;
const MAX_REPORT_LOGS = 500;

const CONTACT_WARNING_MESSAGE = '⚠️ 외부 연락처나 링크 공유 시 개인정보 유출, 사칭, 사기 위험이 있을 수 있어요. 신중하게 대화해 주세요.';
const RESTRICTED_JOIN_MESSAGE = '신고 누적으로 일시적으로 이용이 제한되었습니다.';
const SPAM_BLOCK_MESSAGE = '도배 방지를 위해 잠시 후 다시 입력해주세요.';
const MESSAGE_LENGTH_MESSAGE = '메시지는 300자 이하로 입력해주세요.';

/* =========================
   유틸 함수
========================= */

function updateStats() {
    cleanupRestrictedUsers();
    cleanupWaitingUsers();
    io.emit('server-stats', {
        currentUsers: totalConnections,
        waiting: waitingUsers.length
    });
}

function cleanupRestrictedUsers() {
    const now = Date.now();
    for (const [socketId, restrictedUntil] of restrictedUsers.entries()) {
        if (restrictedUntil <= now) {
            restrictedUsers.delete(socketId);
        }
    }
}

function removeFromWaitingQueue(socketId) {
    waitingUsers = waitingUsers.filter(user => user.id !== socketId);
}

function cleanupWaitingUsers() {
    waitingUsers = waitingUsers.filter(user => {
        if (!user || !user.socket) return false;

        const liveSocket = io.sockets.sockets.get(user.id);
        if (!liveSocket) return false;
        if (liveSocket.disconnected) return false;

        return true;
    });
}

function resetSocketState(socket) {
    socket.roomId = null;
    socket.currentPartnerId = null;
}

function sanitizeNickname(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '익명';
    return trimmed.slice(0, 8);
}

function sanitizeInterest(value) {
    return String(value || '').trim().slice(0, 15);
}

function sanitizeGender(value) {
    const allowed = new Set(['male', 'female']);
    return allowed.has(value) ? value : '';
}

function sanitizeWantGender(value) {
    const allowed = new Set(['all', 'male', 'female']);
    return allowed.has(value) ? value : 'all';
}

function isRestricted(socketId) {
    const restrictedUntil = restrictedUsers.get(socketId);
    if (!restrictedUntil) return false;
    if (Date.now() > restrictedUntil) {
        restrictedUsers.delete(socketId);
        return false;
    }
    return true;
}

function detectContactPattern(text) {
    const patterns = [
        /(open\.kakao\.com|오픈채팅)/i,
        /(kakao|카카오)\s*(id|아이디|톡)/i,
        /https?:\/\/[^\s]+/i,
        /(instagram|insta|인스타|텔레그램|telegram|line|라인)\s*[:@]?\s*[a-z0-9._-]{2,}/i,
        /(?:\+?82[-\s]?)?01[0-9][-\s]?\d{3,4}[-\s]?\d{4}/
    ];

    return patterns.some((pattern) => pattern.test(text));
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
    if (roomId) roomWarningShown.delete(roomId);

    updateStats();
}

function findMatchFor(socket) {
    cleanupWaitingUsers();

    return waitingUsers.findIndex(user => {
        if (!user || !user.socket) return false;
        if (user.id === socket.id) return false;

        const otherSocket = user.socket;

        if (socket.roomId || otherSocket.roomId) return false;
        if (isRestricted(user.id) || isRestricted(socket.id)) return false;

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

    // 중복 매칭 방지: 이미 매칭된 소켓은 매칭하지 않음
    if (socket.roomId || partnerSocket.roomId) {
        return;
    }

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
    socket.messageTimestamps = [];
    socket.spamBlockedUntil = 0;
    socket.lastMessageText = '';
    socket.sameMessageCount = 0;
    socket.lastMessageAt = 0;

    updateStats();

    /* =========================
       차단
    ========================= */
    socket.on('block-user', () => {
        const partnerSocket = getPartnerSocket(socket);
        if (!partnerSocket || !socket.roomId) return;

        socket.blacklist.add(partnerSocket.id);
        partnerSocket.blacklist.add(socket.id);

        endCurrentChat(socket, '상대방이 당신을 차단하고 떠났습니다.');

        socket.emit('start-re-match');
    });

    /* =========================
       신고 (차단 포함)
    ========================= */
    socket.on('report-user', () => {
        const partnerSocket = getPartnerSocket(socket);
        if (!partnerSocket || !socket.roomId) return;

        const cooldownKey = `${socket.id}:${partnerSocket.id}`;
        const now = Date.now();
        const lastReportAt = reportCooldowns.get(cooldownKey) || 0;
        if (now - lastReportAt < REPORT_COOLDOWN_MS) {
            socket.emit('system-msg', '같은 사용자를 너무 짧은 시간에 반복 신고할 수 없습니다.');
            return;
        }
        reportCooldowns.set(cooldownKey, now);

        reportLogs.push({
            reporterId: socket.id,
            targetId: partnerSocket.id,
            targetNickname: partnerSocket.nickname || '익명',
            reason: 'user-report',
            createdAt: new Date(now).toISOString()
        });
        if (reportLogs.length > MAX_REPORT_LOGS) {
            reportLogs.shift();
        }

        socket.blacklist.add(partnerSocket.id);
        partnerSocket.blacklist.add(socket.id);

        const nextCount = (reportCounts.get(partnerSocket.id) || 0) + 1;
        reportCounts.set(partnerSocket.id, nextCount);
        if (nextCount >= REPORT_RESTRICT_THRESHOLD) {
            restrictedUsers.set(partnerSocket.id, now + REPORT_RESTRICT_MS);
            removeFromWaitingQueue(partnerSocket.id);
            partnerSocket.emit('system-msg', RESTRICTED_JOIN_MESSAGE);
        }

        endCurrentChat(socket, '상대방이 당신을 신고하고 대화를 종료했습니다.');

        socket.emit('start-re-match');
    });

    /* =========================
       매칭 시작
    ========================= */
    socket.on('join', (data) => {
        cleanupRestrictedUsers();
        removeFromWaitingQueue(socket.id);
        cleanupWaitingUsers();

        // 이미 매칭 중이면 무시
        if (socket.roomId) {
            updateStats();
            return;
        }

        if (isRestricted(socket.id)) {
            socket.emit('system-msg', RESTRICTED_JOIN_MESSAGE);
            updateStats();
            return;
        }

        socket.nickname = sanitizeNickname(data?.nickname);
        socket.gender = sanitizeGender(data?.gender);
        socket.wantGender = sanitizeWantGender(data?.wantGender);
        socket.interest = sanitizeInterest(data?.interest);

        const partnerIndex = findMatchFor(socket);

        if (partnerIndex !== -1) {
            const partner = waitingUsers[partnerIndex];
            matchUsers(socket, partner);
        } else {
            const alreadyWaiting = waitingUsers.some(user => user.id === socket.id);

            if (!alreadyWaiting) {
                waitingUsers.push({
                    id: socket.id,
                    gender: socket.gender,
                    wantGender: socket.wantGender,
                    nickname: socket.nickname,
                    interest: socket.interest,
                    socket
                });
            }

            updateStats();
        }
    });

    /* =========================
       메시지
    ========================= */
    socket.on('message', (msg) => {
        if (!socket.roomId) return;

        const partnerSocket = getPartnerSocket(socket);
        if (!partnerSocket || partnerSocket.disconnected) {
            socket.emit('partner-left', '상대방 연결 끊김');
            endCurrentChat(socket);
            return;
        }

        const cleanMsg = String(msg || '').trim();
        if (!cleanMsg) return;
        if (cleanMsg.length > MESSAGE_MAX_LENGTH) {
            socket.emit('system-msg', MESSAGE_LENGTH_MESSAGE);
            return;
        }

        const now = Date.now();
        if (socket.spamBlockedUntil && now < socket.spamBlockedUntil) {
            socket.emit('system-msg', '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 입력해주세요.');
            return;
        }

        socket.messageTimestamps = (socket.messageTimestamps || []).filter((ts) => now - ts <= SPAM_WINDOW_MS);
        socket.messageTimestamps.push(now);
        if (socket.messageTimestamps.length > SPAM_MAX_MESSAGES) {
            socket.spamBlockedUntil = now + 3000;
            socket.emit('system-msg', '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 입력해주세요.');
            return;
        }

        if (
            socket.lastMessageText === cleanMsg &&
            socket.lastMessageAt &&
            now - socket.lastMessageAt <= SAME_MESSAGE_RESET_MS
        ) {
            socket.sameMessageCount = (socket.sameMessageCount || 1) + 1;
        } else {
            socket.lastMessageText = cleanMsg;
            socket.sameMessageCount = 1;
        }
        socket.lastMessageAt = now;

        if (socket.sameMessageCount > 5) {
            socket.emit('system-msg', '동일한 문구를 반복해서 보낼 수 없습니다.');
            return;
        }

        if (detectContactPattern(cleanMsg) && !roomWarningShown.has(socket.roomId)) {
            roomWarningShown.add(socket.roomId);
            io.to(socket.roomId).emit('system-msg', CONTACT_WARNING_MESSAGE);
        }

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