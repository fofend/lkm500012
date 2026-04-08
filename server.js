const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// robots.txt와 index.html이 있는 폴더를 외부에서 접근 가능하게 설정
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/robots.txt', (req, res) => {
    res.sendFile(__dirname + '/robots.txt');
});

let waitingUsers = [];
let totalConnections = 0;

io.on('connection', (socket) => {
    totalConnections++;
    socket.blacklist = new Set();
    socket.lastMessage = "";
    socket.msgCount = 0;
    socket.lastSendTime = 0; // 메시지 간격 체크용

    io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });

    socket.on('join', (data) => {
        socket.nickname = data.nickname || "익명";
        socket.gender = data.gender;
        socket.wantGender = data.wantGender || "all"; 
        socket.interest = data.interest ? data.interest.trim() : ""; 

        // [치명적 오류 수정] 대기 명단에서 '나 자신'을 제외하고 파트너를 찾습니다.
        let partnerIndex = waitingUsers.findIndex(user => {
            // 1. 자기 자신 제외 (거울 매칭 방지)
            if (user.id === socket.id) return false;

            // 2. 차단 여부 확인
            const isNotBlacklisted = !socket.blacklist.has(user.id) && !user.socket.blacklist.has(socket.id);
            if (!isNotBlacklisted) return false;

            // 3. 성별 매칭 조건
            const iWantThem = (socket.wantGender === "all") || (socket.wantGender === user.gender);
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
            
            // 매칭된 상대방을 대기 명단에서 제거
            waitingUsers.splice(partnerIndex, 1);
        } else {
            // 매칭 상대가 없으면 대기 명단에 추가 (이미 명단에 있으면 중복 추가 방지)
            const alreadyWaiting = waitingUsers.some(u => u.id === socket.id);
            if (!alreadyWaiting) {
                waitingUsers.push({ 
                    id: socket.id, 
                    gender: socket.gender, 
                    wantGender: socket.wantGender,
                    interest: socket.interest, 
                    nickname: socket.nickname, 
                    socket 
                });
            }
        }
        io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });
    });

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
            // 동일 문구 반복 도배 체크
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