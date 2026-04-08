const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let waitingUsers = [];
let totalConnections = 0;

io.on('connection', (socket) => {
    totalConnections++;
    socket.blacklist = new Set();
    socket.lastMessage = "";
    socket.msgCount = 0;

    io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });

    socket.on('join', (data) => {
        socket.nickname = data.nickname || "익명";
        socket.gender = data.gender;
        socket.wantGender = data.wantGender || "all"; // [추가] 유저가 원하는 상대 성별
        socket.interest = data.interest ? data.interest.trim() : ""; 

        // [핵심 수정] 매칭 조건 로직
        let partnerIndex = waitingUsers.findIndex(user => {
            // 1. 차단 여부 확인
            const isNotBlacklisted = !socket.blacklist.has(user.id) && !user.socket.blacklist.has(socket.id);
            if (!isNotBlacklisted) return false;

            // 2. 성별 매칭 조건 (서로의 요구사항이 맞아야 함)
            // 내가 원하는 성별 조건 만족하는지 확인
            const iWantThem = (socket.wantGender === "all") || (socket.wantGender === user.gender);
            // 상대가 원하는 성별 조건 만족하는지 확인
            const theyWantMe = (user.wantGender === "all") || (user.wantGender === socket.gender);

            return iWantThem && theyWantMe;
        });

        if (partnerIndex !== -1) {
            const partner = waitingUsers[partnerIndex];
            const roomId = partner.id + socket.id;

            partner.socket.join(roomId);
            socket.join(roomId);
            socket.roomId = roomId;
            partner.socket.roomId = roomId;
            
            socket.currentPartnerId = partner.id;
            partner.socket.currentPartnerId = socket.id;

            socket.emit('matched', { 
                msg: `[${partner.nickname}]님과 연결되었습니다!`, 
                partnerGender: partner.gender,
                partnerInterest: partner.interest 
            });
            partner.socket.emit('matched', { 
                msg: `[${socket.nickname}]님과 연결되었습니다!`, 
                partnerGender: socket.gender,
                partnerInterest: socket.interest
            });
            
            waitingUsers.splice(partnerIndex, 1);
        } else {
            // 대기열에 추가할 때 wantGender 정보도 함께 저장해야 합니다.
            waitingUsers.push({ 
                id: socket.id, 
                gender: socket.gender, 
                wantGender: socket.wantGender, // 중요!
                interest: socket.interest, 
                nickname: socket.nickname, 
                socket 
            });
        }
        io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });
    });

    // ... (이하 block-user, re-match, message, leave-chat, disconnect 로직은 동일)
    // 단, disconnect와 leave-chat 시 waitingUsers 필터링 부분은 그대로 유지하면 됩니다.

    socket.on('block-user', () => {
        if (socket.currentPartnerId) {
            socket.blacklist.add(socket.currentPartnerId);
            if (socket.roomId) {
                socket.to(socket.roomId).emit('partner-left', '상대방이 당신을 차단하고 떠났습니다.');
                socket.leave(socket.roomId);
                socket.roomId = null;
            }
            socket.emit('start-re-match');
        }
    });

    socket.on('re-match', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner-left', '상대방이 대화를 종료했습니다.');
            socket.leave(socket.roomId);
            socket.roomId = null;
        }
        socket.emit('start-re-match');
    });

    socket.on('message', (msg) => {
        if (socket.roomId) {
            if (socket.lastMessage === msg) {
                socket.msgCount++; 
            } else {
                socket.lastMessage = msg;
                socket.msgCount = 1; 
            }

            if (socket.msgCount >= 5) {
                return socket.emit('system-err', '도배 방지를 위해 동일 문구 전송이 제한되었습니다.');
            }
            
            socket.emit('message-ok', msg);
            socket.to(socket.roomId).emit('chat-msg', { 
                sender: socket.nickname, 
                text: msg,
                interest: socket.interest
            });
        }
    });

    socket.on('leave-chat', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner-left', '상대방이 대화를 종료했습니다.');
            socket.leave(socket.roomId);
            socket.roomId = null;
        }
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        socket.emit('return-to-setup');
    });

    socket.on('disconnect', () => {
        totalConnections--;
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });
        if (socket.roomId) socket.to(socket.roomId).emit('partner-left', '상대방의 연결이 끊어졌습니다.');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`서버 가동 중: 포트 ${PORT}`);
});