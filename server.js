const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });
// robots.txt 요청이 오면 파일 위치 상관없이 무조건 허용 텍스트를 쏴줍니다.
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send("User-agent: *\nAllow: /");
});
let waitingUsers = [];
let totalConnections = 0;

io.on('connection', (socket) => {
    totalConnections++;
    socket.blacklist = new Set();
    
    const updateStats = () => io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });
    updateStats();

    socket.on('block-user', () => {
        if (socket.currentPartnerId) {
            // 1. 내 블랙리스트에 상대방 추가
            socket.blacklist.add(socket.currentPartnerId);
            
            // 2. 상대방에게 종료 알림 (방 번호로 전송)
            socket.to(socket.roomId).emit('partner-left', '상대방이 당신을 차단하고 떠났습니다.');
            
            // 3. 내 소켓 정보 초기화 및 방 나가기
            socket.leave(socket.roomId);
            const oldRoomId = socket.roomId; // 기존 방 번호 임시 저장
            socket.roomId = null;
            socket.currentPartnerId = null;

            // 4. 나에게 새로운 매칭 시작하라고 신호 보냄
            socket.emit('start-re-match');
        }
    });

    socket.on('join', (data) => {
        socket.nickname = data.nickname || "익명";
        socket.gender = data.gender;
        socket.wantGender = data.wantGender || "all"; 
        socket.interest = data.interest ? data.interest.trim() : ""; 

        let partnerIndex = waitingUsers.findIndex(user => {
            if (user.id === socket.id) return false;
            const isNotBlacklisted = !socket.blacklist.has(user.id) && !user.socket.blacklist.has(socket.id);
            if (!isNotBlacklisted) return false;
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
                msg: `연결됨`, 
                partnerGender: partner.gender, 
                partnerInterest: partner.interest,
                partnerNickname: partner.nickname // 👈 상대방 닉네임을 나에게 보냄
            });
            
            // 이 부분이 스크린샷의 두 번째 덩어리
            partner.socket.emit('matched', { 
                msg: `연결됨`, 
                partnerGender: socket.gender, 
                partnerInterest: socket.interest,
                partnerNickname: socket.nickname // 👈 내 닉네임을 상대방에게 보냄
            });

            waitingUsers.splice(partnerIndex, 1);
        } else {
            if (!waitingUsers.some(u => u.id === socket.id)) {
                waitingUsers.push({ 
                    id: socket.id, 
                    gender: socket.gender, 
                    wantGender: socket.wantGender, 
                    nickname: socket.nickname, 
                    interest: socket.interest, // 이 줄을 꼭 추가!
                    socket });
            }
        }
        updateStats();
    });
    

    socket.on('message', (msg) => {
        if (socket.roomId) {
            socket.emit('message-ok', msg);
            socket.to(socket.roomId).emit('chat-msg', { sender: socket.nickname, text: msg });
            // 메시지를 보냈으니 점 세 개를 지우라고 명령!
            socket.to(socket.roomId).emit('stop-partner-typing');
        }
    });

    socket.on('typing', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner-typing');
        }
    });

    // 상대방이 글자를 다 지웠을 때
    socket.on('stop-typing', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('stop-partner-typing');
        }
    });

    socket.on('re-match', () => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('partner-left', '상대방이 종료했습니다.');
            socket.leave(socket.roomId);
            socket.roomId = null;
        }
        socket.emit('start-re-match');
    });

    socket.on('disconnect', () => {
        totalConnections--;
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        updateStats();
        if (socket.roomId) socket.to(socket.roomId).emit('partner-left', '상대방 연결 끊김');
    });
});

http.listen(3000, () => { console.log('Server running on 3000'); });