const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

let waitingUsers = [];
let totalConnections = 0;

io.on('connection', (socket) => {
    totalConnections++;
    socket.blacklist = new Set();
    
    const updateStats = () => io.emit('server-stats', { currentUsers: totalConnections, waiting: waitingUsers.length });
    updateStats();

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

            socket.emit('matched', { msg: `연결됨`, partnerGender: partner.gender });
            partner.socket.emit('matched', { msg: `연결됨`, partnerGender: socket.gender });
            waitingUsers.splice(partnerIndex, 1);
        } else {
            if (!waitingUsers.some(u => u.id === socket.id)) {
                waitingUsers.push({ id: socket.id, gender: socket.gender, wantGender: socket.wantGender, nickname: socket.nickname, socket });
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