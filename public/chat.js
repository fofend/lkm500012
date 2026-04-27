            const socket = io({ reconnection: true });

            function escapeHtml(str) {
                return String(str)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }

            let myData = { nickname: '', gender: '', wantGender: '', interest: '' };
            let currentStep = 1;
            let partnerGender = "";
            let partnerNickname = "";
            let partnerInterest = "";
            let lastMessage = "";
            let lastMessageTime = 0;
            let repeatCount = 0;
            const SAME_MESSAGE_RESET_MS = 3000;
            let alertShown = false;
            let isRematching = false;
            let lastEnterTime = 0;

            let typingTimeout;
            let startX = 0;
            let currentX = 0;
            let lastTap = 0;
            let nextPointerHandled = false;

            const chatScreen = document.getElementById('chat-screen');
            const chatBox = document.getElementById('chat-box');
            const msgInput = document.getElementById('msg-input');
            const sendBtn = document.getElementById('send-btn');
            const nextBtn = document.getElementById('next-btn');
            const inputArea = document.querySelector('.input-area');





            function removeTypingLoader() {
                const loader = document.getElementById('typing-loader');
                if (loader) loader.remove();
                if (typingTimeout) clearTimeout(typingTimeout);
            }

            function goNext(step) {
                if (step === 1) {
                    const nick = document.getElementById('nickname').value.trim();
                    if (!nick) return alert("닉네임을 입력해 주세요!");
                    myData.nickname = nick;
                }

                const currentElem = document.getElementById(`step-${currentStep}`);
                if (currentElem) {
                    currentElem.classList.remove('active');
                    currentElem.style.display = 'none';
                }

                currentStep = step + 1;

                const nextElem = document.getElementById(`step-${currentStep}`);
                if (nextElem) {
                    nextElem.classList.add('active');
                    nextElem.style.display = 'flex';
                }
            }



            function selectGender(v) {
                myData.gender = v;
                goNext(2);
            }

            function selectWantGender(v) {
                myData.wantGender = v;
                goNext(3);
            }

            function startMatching() {
                if (isRematching) return;
                isRematching = true;

                myData.nickname = document.getElementById('nickname').value.trim() || "익명";
                myData.interest = document.getElementById('interest').value.trim();
                document.getElementById('msg-input').value = '';
                socket.emit('join', myData);

                document.getElementById('setup-screen').style.display = 'none';
                document.getElementById('chat-screen').style.display = 'flex';
                document.getElementById('chat-top-bar').style.display = 'flex';
                document.getElementById('top-stats').style.display = 'flex';
                setTimeout(() => scrollToBottom(true), 150);
                showAd();

                const notices = [
                    "지금 이 대화가 맘에 안든다면? 오른쪽에서 왼쪽으로 슥- 스와이프해서 다음 설렘을 찾아보세요. 🎈",
                    "손가락 하나로 슥- PC에선 Shift + . 키로 다음 분을 모실게요. ⌨️",
                    "우리 사이의 소중한 매너! 개인정보를 묻거나 공개하지 않기로 약속해요. 🙌",
                    "불편한 대화는 참지 마세요. 차단 버튼이 여러분의 기분을 지켜드릴게요. 🛡️",
                    "전화번호, 카카오톡, SNS 등 외부 연락처 공유 시 개인정보 유출이나 사칭 위험이 있을 수 있으니 주의해주세요."
                ];
                const notice = notices[Math.floor(Math.random() * notices.length)];
                chatBox.innerHTML = `<div class="system">🚀 새로운 상대를 검색 중입니다...</div><div class="system" style="color:#a855f7; border:1px solid rgba(168,85,247,0.25);">${notice}</div>`;
                scrollToBottom(true);

                setInputState(false);
                setActionButtons(false);

            }

            socket.on('partner-typing', () => {
                let loader = document.getElementById('typing-loader');

                if (!loader) {
                    loader = document.createElement('div');
                    loader.id = 'typing-loader';
                    loader.className = 'msg-line partner';
                    loader.innerHTML = `
                    <div class="bubble typing-bubble" style="padding: 10px 15px;">
                        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                    </div>`;
                    chatBox.appendChild(loader);
                    scrollToBottom(true);
                }

                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    const currentLoader = document.getElementById('typing-loader');
                    if (currentLoader) currentLoader.remove();
                }, 2500);
            });

            socket.on('system-msg', (text) => {
                chatBox.innerHTML += `
       <div class="system" style="color:var(--error); border:1px solid rgba(255,59,48,0.35); white-space:pre-line; padding:8px 14px; line-height:1.35; margin:8px auto;">
            ${escapeHtml(text)}
        </div>`;
                scrollToBottom(true);
            });

            socket.on('stop-partner-typing', () => {
                const loader = document.getElementById('typing-loader');
                if (loader) loader.remove();
                if (typingTimeout) clearTimeout(typingTimeout);
            });

            socket.on('matched', (d) => {
                removeTypingLoader();
                isRematching = false;

                partnerGender = d.partnerGender;
                partnerNickname = d.partnerNickname;
                partnerInterest = d.partnerInterest;

                hideAd();

                const tagColor = partnerGender === 'male' ? 'var(--male)' : 'var(--female)';
                const tagText = partnerGender === 'male' ? '남' : '여';
                const interestTxt = partnerInterest
                    ? ` <span style="color:#8e8e93; font-weight:normal;">(${partnerInterest})</span>`
                    : "";

                chatBox.innerHTML = `
                <div class="system">
                    <span class="gender-tag" style="background:${tagColor}">${tagText}</span> 
                    <b>${partnerNickname}</b>님과 연결되었습니다.${interestTxt}
                </div>`;

                setInputState(true);
                setActionButtons(true);
                scrollToBottom();
            });

            socket.on('message-ok', (t) => {
                chatBox.innerHTML += `<div class="msg-line me"><div class="bubble">${escapeHtml(t)}</div></div>`;
                scrollToBottom();
            });

            socket.on('chat-msg', (d) => {
                const loader = document.getElementById('typing-loader');
                if (loader) loader.remove();

                const tagColor = partnerGender === 'male' ? 'var(--male)' : 'var(--female)';
                const tagText = partnerGender === 'male' ? '남' : '여';
                const interestDisplay = partnerInterest
                    ? `<span style="font-size:11px; color:#d8b4fe; margin-left:4px;">(${escapeHtml(partnerInterest)})</span>`
                    : "";

                chatBox.innerHTML += `
    <div class="msg-line partner" style="margin-top: 12px;">
        <div style="margin-bottom: 4px; padding-left: 5px; display: flex; align-items: center;">
            <span class="gender-tag" style="background:${tagColor}; margin-right:5px;">${tagText}</span>
           <span style="font-size:13px; font-weight:700; color:#e9def7; text-shadow:0 1px 2px rgba(0,0,0,0.35);">
    ${escapeHtml(partnerNickname)}
</span>
            ${interestDisplay}
        </div>
        <div class="bubble">${escapeHtml(d.text)}</div>
    </div>`;
                scrollToBottom();
            });

            socket.on('partner-left', (m) => {
                removeTypingLoader();
                isRematching = false;
                socket.roomId = null;

                document.getElementById('ad-container').style.display = 'block';

                const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                const tipMsg = isMobile
                    ? "📱 화면을 <b>두 번 톡톡</b> 두드려보세요!"
                    : "⌨️ <b>엔터(Enter) 두 번</b>으로 매칭 시작!";

                chatBox.innerHTML += `
                <div class="system">⚠️ ${escapeHtml(m)}</div>
                <div class="system" style="background:#f2f2f7; color:#8e8e93; border: 1px dashed #d1d1d6; margin-top:10px;">
                    ${tipMsg}
                </div>`;
                setInputState(false);
                document.getElementById('msg-input').value = '';
                setActionButtons(false);
                const notices = [
                    "지금 이 대화가 맘에 안든다면? 오른쪽에서 왼쪽으로 슥- 스와이프해서 다음 설렘을 찾아보세요. 🎈",
                    "손가락 하나로 슥- PC에선 Shift + . 키로 다음 분을 모실게요. ⌨️",
                    "우리 사이의 소중한 매너! 개인정보를 묻거나 공개하지 않기로 약속해요. 🙌",
                    "불편한 대화는 참지 마세요. 차단 버튼이 여러분의 기분을 지켜드릴게요. 🛡️",
                    "전화번호, 카카오톡, SNS 등 외부 연락처 공유 시 개인정보 유출이나 사칭 위험이 있을 수 있으니 주의해주세요."
                ];
                const notice = notices[Math.floor(Math.random() * notices.length)];
                chatBox.innerHTML += `<div class="system" style="color:#a855f7; border:1px solid rgba(168,85,247,0.25);">${notice}</div>`;
                scrollToBottom(true);
            });

            socket.on('start-re-match', () => {
                removeTypingLoader();
                socket.emit('join', myData);
                document.getElementById('msg-input').value = '';
                const notices = [
                    "지금 이 대화가 맘에 안든다면? 오른쪽에서 왼쪽으로 슥- 스와이프해서 다음 설렘을 찾아보세요. 🎈",
                    "손가락 하나로 슥- PC에선 Shift + . 키로 다음 분을 모실게요. ⌨️",
                    "우리 사이의 소중한 매너! 개인정보를 묻거나 공개하지 않기로 약속해요. 🙌",
                    "불편한 대화는 참지 마세요. 차단 버튼이 여러분의 기분을 지켜드릴게요. 🛡️",
                    "전화번호, 카카오톡, SNS 등 외부 연락처 공유 시 개인정보 유출이나 사칭 위험이 있을 수 있으니 주의해주세요."
                ];
                const notice = notices[Math.floor(Math.random() * notices.length)];
                chatBox.innerHTML = `<div class="system">🚀 새로운 상대를 검색 중입니다...</div><div class="system" style="color:#a855f7; border:1px solid rgba(168,85,247,0.25);">${notice}</div>`;
                scrollToBottom(true);

                setInputState(false);
                setActionButtons(false);
            });

            socket.on('server-stats', (d) => {
                const statsBar = document.getElementById('top-stats');
                const sLeft = document.getElementById('stat-left');
                const sRight = document.getElementById('stat-right');

                if (document.getElementById('chat-screen').style.display === 'flex') {
                    statsBar.style.display = 'flex';

                    if (d.currentUsers >= 50) {
                        sLeft.innerHTML = `접속자: <span>${d.currentUsers}</span>명`;
                        sRight.innerHTML = `대기중: <span>${d.waiting}</span>명`;
                    } else if (d.currentUsers <= 5) {
                        sLeft.innerHTML = `실시간 매칭 중`;
                        sRight.innerHTML = `✨ 매칭 상태 원활`;
                    } else {
                        sLeft.innerHTML = `실시간 매칭 중`;
                        sRight.innerHTML = `💬 원활한 대화 가능`;
                    }
                } else {
                    statsBar.style.display = 'none';
                }
            });

            function send(event) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                const v = msgInput.value.trim();
                if (!v || msgInput.disabled || !socket.connected) {
                    return;
                }

                const now = Date.now();

                if (v === lastMessage && now - lastMessageTime <= SAME_MESSAGE_RESET_MS) {
                    repeatCount++;
                } else {
                    repeatCount = 1;
                    alertShown = false;
                }

                if (repeatCount > 5) {
                    if (!alertShown) {
                        chatBox.innerHTML += `<div class="system" style="color:var(--error); border:1px solid var(--error); font-weight:bold;">⚠️ 동일한 문구를 반복해서 보낼 수 없습니다.</div>`;
                        alertShown = true;
                        scrollToBottom();
                    }

                    msgInput.value = '';
                    socket.emit('stop-typing');
                    return;
                }

                socket.emit('message', v);
                lastMessage = v;
                lastMessageTime = now;
                msgInput.value = '';

                setTimeout(() => {
                    scrollToBottom(true);
                }, 80);
            }
            document.addEventListener('touchstart', (e) => {
                if (chatScreen.style.display !== 'flex') return;

                const isInput = e.target === msgInput;
                const isSendBtn = e.target === sendBtn || e.target.closest('#send-btn');
                const isTopButton = e.target.closest('#report-btn, #block-btn');
                const isInputArea = e.target.closest('.input-area');

                // 원래 눌러야 하는 버튼/입력창은 통과
                if (isInput || isSendBtn || isTopButton) return;

                // 입력창 영역의 빈 공간을 누르면 키보드 내려가지 않게 막기
                if (isInputArea && !msgInput.disabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    msgInput.focus();
                }
            }, { passive: false, capture: true });
            sendBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (sendBtn.disabled) return;

                send(e);
            });
            nextBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                nextPointerHandled = true;
                requestRematch();
            });
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (nextPointerHandled) {
                    nextPointerHandled = false;
                    return;
                }

                requestRematch();
            });


            msgInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                if (val.length > 0) {
                    socket.emit('typing');
                } else {
                    socket.emit('stop-typing');
                }
            });
            msgInput.addEventListener('focus', () => {
                setTimeout(() => scrollToBottom(true), 250);
            });


            function setInputState(enabled) {
                msgInput.disabled = !enabled;
                sendBtn.disabled = !enabled;
                msgInput.placeholder = enabled ? "메시지 입력..." : "상대를 찾는 중...";
                if (enabled && window.innerWidth >= 768) {
                    setTimeout(() => msgInput.focus(), 150);
                }
            }

            function scrollToBottom(force = false) {
                requestAnimationFrame(() => {
                    chatBox.scrollTop = chatBox.scrollHeight;

                    if (force) {
                        setTimeout(() => {
                            chatBox.scrollTop = chatBox.scrollHeight;
                        }, 30);
                    }
                });
            }

            function requestRematch() {
                isRematching = false;
                triggerAutoMatch();
            }

            function triggerAutoMatch() {
                if (isRematching) return;

                isRematching = true;
                socket.roomId = null;
                socket.emit('re-match');

                const notices = ["지금 이 대화가 아쉽다면? 오른쪽에서 왼쪽으로 슥- 스와이프해서 다음 설렘을 찾아보세요. 🎈", "손가락 하나로 슥- PC에선 Shift + . 키로 다음 분을 모실게요. ⌨️", "우리 사이의 소중한 매너! 개인정보를 묻거나 공개하지 않기로 약속해요. 🙌", "불편한 대화는 참지 마세요. 차단 버튼이 여러분의 기분을 지켜드릴게요. 🛡️"];
                const notice = notices[Math.floor(Math.random() * notices.length)];
                chatBox.innerHTML = `<div class="system">🚀 새로운 인연을 찾는 중...</div><div class="system" style="color:#a855f7; border:1px solid rgba(168,85,247,0.25);">${notice}</div>`;
                scrollToBottom();

                setInputState(false);
                showAd();
            }

            function exitToSetup() {
                if (confirm("나갈까요?")) location.reload();
            }

            function blockUser() {
                if (confirm("차단하고 다음 상대를 찾을까요?")) {
                    socket.roomId = null;
                    socket.emit('block-user');
                }
            }
            function reportUser() {
                const reportBtn = document.getElementById('report-btn');
                if (reportBtn && reportBtn.disabled) return;

                if (confirm("이 사용자를 신고하고 다시 매칭되지 않도록 할까요?")) {
                    socket.roomId = null;
                    socket.emit('report-user');
                }
            }




            function goToSetupDirect() {
                const openingScreen = document.getElementById('opening-screen');
                const landingPage = document.getElementById('landing-page');
                const setupScreen = document.getElementById('setup-screen');

                if (openingScreen) {
                    openingScreen.style.display = 'none';
                    openingScreen.style.opacity = '0';
                }

                if (landingPage) {
                    landingPage.style.display = 'none';
                }

                setupScreen.style.display = 'flex';
                setupScreen.style.opacity = '1';

                document.getElementById('nickname').value = '';
                document.getElementById('interest').value = '';

                const nicknameInput = document.getElementById('nickname');
                if (nicknameInput) {
                    setTimeout(() => nicknameInput.focus(), 150);
                }
            }

            function openLandingPage() {
                const openingScreen = document.getElementById('opening-screen');
                const landingPage = document.getElementById('landing-page');

                if (openingScreen) {
                    openingScreen.style.display = 'none';
                    openingScreen.style.opacity = '0';
                }

                if (landingPage) {
                    landingPage.style.display = 'block';
                }
            }

            function backToOpening() {
                const openingScreen = document.getElementById('opening-screen');
                const landingPage = document.getElementById('landing-page');

                if (landingPage) {
                    landingPage.style.display = 'none';
                }

                if (openingScreen) {
                    openingScreen.style.display = 'flex';
                    openingScreen.style.opacity = '1';
                }
            }
            document.querySelector('.opening-btn-primary').addEventListener('click', openLandingPage);
            document.querySelector('.opening-btn-secondary').addEventListener('click', goToSetupDirect);
            document.querySelector('.landing-btn-primary').addEventListener('click', goToSetupDirect);
            document.querySelector('.landing-btn-secondary').addEventListener('click', backToOpening);
            document.getElementById('nickname').addEventListener('keypress', (event) => {
                if (event.keyCode == 13) goNext(1);
            });
            document.querySelector('#step-1 .btn-next-circle').addEventListener('click', () => goNext(1));
            document.querySelectorAll('#step-2 .option-btn')[0].addEventListener('click', () => selectGender('male'));
            document.querySelectorAll('#step-2 .option-btn')[1].addEventListener('click', () => selectGender('female'));
            document.querySelectorAll('#step-3 .option-btn')[0].addEventListener('click', () => selectWantGender('all'));
            document.querySelectorAll('#step-3 .option-btn')[1].addEventListener('click', () => selectWantGender('female'));
            document.querySelectorAll('#step-3 .option-btn')[2].addEventListener('click', () => selectWantGender('male'));
            document.getElementById('interest').addEventListener('keypress', (event) => {
                if (event.keyCode == 13) startMatching();
            });
            document.querySelector('#step-4 button').addEventListener('click', startMatching);
            document.addEventListener('keydown', (e) => {
                const isChatVisible = document.getElementById('chat-screen').style.display === 'flex';
                if (!isChatVisible) return;

                if (e.shiftKey && (e.key === '.' || e.key === '>')) {
                    e.preventDefault();

                    if (confirm("현재 대화를 종료하고 다음 상대를 찾을까요?")) {
                        triggerAutoMatch();
                    } else if (!msgInput.disabled) {
                        msgInput.focus();
                    }
                    return;
                }

                if (e.key === 'Enter' && msgInput.disabled) {
                    const currentTime = Date.now();

                    if (currentTime - lastEnterTime < 300) {
                        e.preventDefault();
                        triggerAutoMatch();
                        lastEnterTime = 0;
                    } else {
                        lastEnterTime = currentTime;
                    }
                }
            }, true);

            chatScreen.addEventListener('touchstart', (e) => {
                if (chatScreen.style.display !== 'flex') return;
                if (e.target.closest('input, button')) return;

                startX = e.touches[0].clientX;
                currentX = startX;
                chatScreen.classList.remove('swipe-transition');
            }, { passive: true });

            chatScreen.addEventListener('touchmove', (e) => {

                if (startX === 0) return;

                currentX = e.touches[0].clientX;
                const diff = currentX - startX;

                if (diff < 0) {
                    const moveX = diff * 0.5;
                    const rotate = diff / 35;
                    const baseX = window.innerWidth < 768 ? '0px' : '-50%';
                    chatScreen.style.transform = `translateX(calc(${baseX} + ${moveX}px)) rotate(${rotate}deg)`;
                    chatScreen.style.opacity = 1 + (moveX / 800);
                }
            }, { passive: true });

            chatScreen.addEventListener('touchend', (e) => {

                if (startX === 0) return;

                if (currentX === 0 && e.changedTouches && e.changedTouches.length > 0) {
                    currentX = e.changedTouches[0].clientX;
                }

                const diff = currentX - startX;
                const currentTime = Date.now();

                chatScreen.classList.add('swipe-transition');

                if (currentX !== 0 && diff < -100) {
                    const baseX = window.innerWidth < 768 ? '0px' : '-50%';
                    chatScreen.style.transform = `translateX(calc(${baseX} - 120%)) rotate(-15deg)`;
                    chatScreen.style.opacity = '0';

                    triggerAutoMatch();

                    setTimeout(() => {
                        chatScreen.style.transform = window.innerWidth < 768 ? 'translateX(0) rotate(0deg)' : 'translateX(-50%) rotate(0deg)';
                        chatScreen.style.opacity = '1';
                    }, 450);
                } else {
                    chatScreen.style.transform = window.innerWidth < 768
                        ? 'translateX(0) rotate(0deg)'
                        : 'translateX(-50%) rotate(0deg)';
                    chatScreen.style.opacity = '1';

                    const tapLength = currentTime - lastTap;
                    if (Math.abs(diff) < 20) {
                        if (tapLength < 300 && tapLength > 0) {
                            if (msgInput.disabled) {
                                triggerAutoMatch();
                            }
                            lastTap = 0;
                        } else {
                            lastTap = currentTime;
                        }
                    }
                }

                startX = 0;
                currentX = 0;
            }, { passive: true });

            window.addEventListener('load', () => {
                const params = new URLSearchParams(window.location.search);

                const opScreen = document.getElementById('opening-screen');
                const setupScreen = document.getElementById('setup-screen');
                const landingPage = document.getElementById('landing-page');

                // 👉 landing 요청이면 opening 강제 차단
                if (params.get('page') === 'landing') {
                    if (opScreen) {
                        opScreen.style.display = 'none';
                        opScreen.style.opacity = '0';
                    }

                    if (landingPage) {
                        landingPage.style.display = 'block';
                    }

                    return; // ⭐ 여기 중요 (아래 코드 실행 막기)
                }

                // 기본 상태
                if (opScreen) {
                    opScreen.style.display = 'flex';
                    opScreen.style.opacity = '1';
                }

                if (setupScreen) {
                    setupScreen.style.display = 'none';
                    setupScreen.style.opacity = '0';
                }

                if (landingPage) {
                    landingPage.style.display = 'none';
                }
            });
            function loadCoupangAd() {
                /*
                const adArea = document.getElementById('ad-content-area');
            
                adArea.innerHTML = `
                    <a 
                        href="https://link.coupang.com/a/elZ2oh" 
                        target="_blank" 
                        referrerpolicy="unsafe-url"
                        rel="nofollow sponsored noopener"
                        style="display:block; width:100%; text-align:center;"
                    >
                        <img 
                            src="https://ads-partners.coupang.com/banners/979326?subId=&traceId=V0-301-5a8c79a76485eb21-I979326&w=320&h=50"
                            alt="쿠팡 추천 배너"
                            style="display:block; width:100%; max-width:320px; height:auto; margin:0 auto; border:0;"
                        >
                    </a>
                `;
                */
            }

            function showAd() {
                return;
            }
            function hideAd() {
                document.getElementById('ad-container').style.display = 'none';
            }

            function setActionButtons(enabled) {
                const reportBtn = document.getElementById('report-btn');
                const blockBtn = document.getElementById('block-btn');

                if (!reportBtn || !blockBtn) return;

                reportBtn.disabled = !enabled;
                blockBtn.disabled = !enabled;

                reportBtn.style.opacity = enabled ? '1' : '0.4';
                blockBtn.style.opacity = enabled ? '1' : '0.4';

                reportBtn.style.pointerEvents = enabled ? 'auto' : 'none';
                blockBtn.style.pointerEvents = enabled ? 'auto' : 'none';
            }
            window.addEventListener('DOMContentLoaded', () => {
                const params = new URLSearchParams(window.location.search);

                if (params.get('page') === 'landing') {
                    document.getElementById('opening-screen').style.display = 'none';
                    document.getElementById('opening-screen').style.opacity = '0';
                    document.getElementById('landing-page').style.display = 'block';
                }
            });
