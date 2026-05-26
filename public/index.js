let currentUser = null;
let socket = null;

// WebSocket Verbindung aufbauen
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onmessage = function(event) {
        const data = JSON.parse(event.data);

        // Chat empfangen
        if (data.type === 'chat_broadcast') {
            const chatBox = document.getElementById('chat-box');
            const msgDiv = document.createElement('div');
            msgDiv.innerHTML = `<strong style="color: ${data.color};">${data.username}:</strong> ${data.message}`;
            chatBox.appendChild(msgDiv);
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        // Betteln erfolgreich
        if (data.type === 'beg_success') {
            currentUser.coins = data.coins;
            document.getElementById('player-coins').innerText = data.coins;
        }

        // ID vom neu erstellten Tisch empfangen -> WhatsApp Link freischalten
        if (data.type === 'table_created') {
            const game = document.getElementById('create-game-type').value;
            const bet = parseInt(document.getElementById('create-bet').value);
            const serverUrl = window.location.origin;
            const inviteText = encodeURIComponent(`Komm in die Krabbelgruppe! Ich habe einen Tisch eröffnet:\n🎮 Spiel: ${game}\n💰 Einsatz: ${bet} Coins\n\nKlicke zum Mitspielen: ${serverUrl}?table=${data.tableId}`);
            
            document.getElementById('whatsapp-btn').href = `https://whatsapp.com{inviteText}`;
            document.getElementById('whatsapp-share-area').style.display = 'block';
        }

        // Live-Tischliste empfangen und ins HTML zeichnen
        // Live-Tischliste UND Turniere empfangen und ins HTML zeichnen
        if (data.type === 'table_list') {
            window.activeTablesData = data.tables; // Tische global speichern
            
            // ==========================================
            // 1. NEU: TURNIER-BEREICH LIVE AKTUALISIEREN
            // ==========================================
            const tournamentContainer = document.getElementById('active-tournaments');
            if (tournamentContainer) {
                tournamentContainer.innerHTML = '';
                
                if (!data.tournaments || data.tournaments.length === 0) {
                    tournamentContainer.innerHTML = '<div style="color:#aaa; font-size:0.9rem;">Gerade keine Turniere offen...</div>';
                } else {
                    data.tournaments.forEach(tourney => {
                        const iAmInTourney = currentUser && tourney.players.includes(currentUser.username);
                        const card = document.createElement('div');
                        card.className = 'tournament-card';
                        card.innerHTML = `
                            <div>
                                <strong style="color: #ffc107;">🏆 Mega-Turnier #${tourney.id} - ${tourney.game_type}</strong><br>
                                <small style="color:#ffd700;">Einsatz: ${tourney.bet_amount} Coins | Phase: ${tourney.status}</small><br>
                                <small style="color:#aaa;">Teilnehmer: ${tourney.players.length} Spieler</small>
                            </div>
                            <div class="table-actions">
                                ${iAmInTourney ? 
                                    `<span style="color:#28a745; font-weight:bold; font-size:0.85rem; padding-right:10px;">Angemeldet ✔</span>` : 
                                    `<button class="btn-tournament" onclick="joinTournament(${tourney.id})">Anmelden</button>`
                                }
                            </div>
                        `;
                        tournamentContainer.appendChild(card);
                    });
                }
            }

            // ==========================================
            // 2. DEIN CODE: SPIELTISCH-BEREICH AKTUALISIEREN
            // ==========================================
            const tableContainer = document.getElementById('active-tables');
            tableContainer.innerHTML = '';

            let iamInATable = false;

            if (data.tables.length === 0) {
                tableContainer.innerHTML = '<div style="color:#aaa; font-size:0.9rem;">Gerade keine offenen Tische... Erstelle einen!</div>';
                document.querySelector('.btn-create').style.background = '#28a745';
                document.querySelector('.btn-create').innerText = 'Neu ➕';
            } else {
                data.tables.forEach(t => {
                    const iAmHere = currentUser && t.players.some(p => p.username === currentUser.username);
                    const iAmBoss = currentUser && t.boss === currentUser.username;
                    if (iAmHere) iamInATable = true;

                    const card = document.createElement('div');
                    card.className = 'table-card';
                    
                    // Schaltet die passenden Buttons frei (Boss sieht Starten, Spieler sieht Verlassen)
                    let actionButtons = '';
                    if (iAmBoss) {
                        actionButtons = `
                            <button class="btn-action" style="background:#28a745; color:white; margin-right:5px;" onclick="requestStartGame(${t.id})">Starten ⚔️</button>
                            <button class="btn-action" style="background:#dc3545; color:white;" onclick="leaveTable(${t.id})">X</button>
                        `;
                    } else if (iAmHere) {
                        actionButtons = `<button class="btn-action" style="background:#dc3545; color:white;" onclick="leaveTable(${t.id})">Verlassen</button>`;
                    } else {
                        actionButtons = `<button class="btn-action btn-join" onclick="joinTable(${t.id})">Mitspielen</button>`;
                    }

                    card.innerHTML = `
                        <div>
                            <strong>Tisch #${t.id} - ${t.game_type}</strong><br>
                            <small style="color:#aaa;">Einsatz: ${t.bet_amount} Coins | Boss: ${t.boss} | Spieler: ${t.players.length}/${t.max_players}</small>
                        </div>
                        <div class="table-actions">${actionButtons}</div>
                    `;
                    tableContainer.appendChild(card);
                });
            }

            const createBtn = document.querySelector('.btn-create');
            if (iamInATable) {
                createBtn.style.background = '#555';
                createBtn.innerText = 'Im Spiel 🎮';
                createBtn.setAttribute('id', 'active-user-table-status');
            } else {
                createBtn.style.background = '#28a745';
                createBtn.innerText = 'Neu ➕';
                createBtn.removeAttribute('id');
            }
        }
    }; // Schließt socket.onmessage
} // Schließt initWebSocket

function openModal(viewId) {
    document.getElementById('auth-modal').style.display = 'flex';
    switchView(viewId);
}

function closeModal() {
    document.getElementById('auth-modal').style.display = 'none';
}

function switchView(viewId) {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('register-view').style.display = 'none';
    document.getElementById('forgot-view').style.display = 'none';
    document.getElementById('create-table-view').style.display = 'none';
    document.getElementById(viewId).style.display = 'block';
}

function openCreateTableModal() {
    if (!currentUser) {
        alert('Bitte logge dich zuerst ein, um einen Tisch zu erstellen!');
        openModal('login-view');
        return;
    }
    if (document.getElementById('active-user-table-status')) {
        alert('Du bist bereits an einem Tisch aktiv!');
        return;
    }
    document.getElementById('whatsapp-share-area').style.display = 'none';
    openModal('create-table-view');
}

function updateLobbyUI(user) {
    currentUser = user;
    document.getElementById('player-name').innerText = user.username;
    document.getElementById('lobby-username').style.color = user.name_color;
    document.getElementById('player-coins').innerText = user.coins;
    document.getElementById('player-title').innerText = user.title;
    document.getElementById('coin-bar').style.display = 'block';
    document.getElementById('crown-icon').style.display = user.has_crown ? 'inline' : 'none';
    document.getElementById('lobby-username').onclick = null;
    closeModal();
    
    initWebSocket();
}

// REGISTRIERUNG ABSENDEN
async function submitRegister() {
    const username = document.getElementById('reg-user').value;
    const password = document.getElementById('reg-pass').value;
    const question = document.getElementById('reg-question').value;
    const answer = document.getElementById('reg-answer').value;

    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, question, answer })
    });
    const data = await res.json();
    if (data.success) { alert(data.message); switchView('login-view'); } else { alert('Fehler: ' + data.error); }
}

// LOGIN ABSENDEN
async function submitLogin() {
    const username = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) { updateLobbyUI(data.user); } else { alert('Fehler: ' + data.error); }
}

// PASSWORT ZURÜCKSETZEN
async function submitForgot() {
    const username = document.getElementById('forgot-user').value;
    const question = document.getElementById('forgot-question').value;
    const answer = document.getElementById('forgot-answer').value;
    const newPassword = document.getElementById('forgot-newpass').value;

    const res = await fetch('/api/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, question, answer, newPassword })
    });
    const data = await res.json();
    if (data.success) { alert(data.message); switchView('login-view'); } else { alert('Fehler: ' + data.error); }
}

// CHAT-NACHRICHT SENDEN
function sendChatMessage() {
    const input = document.getElementById('chat-msg');
    if (!input || !input.value.trim() || !currentUser) return;

    socket.send(JSON.stringify({
        type: 'chat_message',
        username: currentUser.username,
        message: input.value,
        color: currentUser.name_color
    }));
    input.value = '';
}

// ECHTE BETTEL-LOGIK
function submitBeg() {
    if (!currentUser) return;
    socket.send(JSON.stringify({
        type: 'beg_coins',
        username: currentUser.username
    }));
}

// TISCH ERSTELLEN UEBER WEBSOCKET
function submitCreateTable() {
    const game = document.getElementById('create-game-type').value;
    const bet = parseInt(document.getElementById('create-bet').value);
    const maxPlayers = parseInt(document.getElementById('create-max-players').value);

    if (bet < 1 || bet > 5) { alert('Einsatz muss zwischen 1 and 5 Coins liegen!'); return; }
    if (currentUser.coins < bet) { alert('Nicht genug Coins!'); return; }

    socket.send(JSON.stringify({
        type: 'create_table',
        game_type: game,
        bet_amount: bet,
        max_players: maxPlayers,
        username: currentUser.username
    }));
}

// TISCH VERLASSEN LOGIK
function leaveTable(tableId) {
    if (!currentUser || !socket) return;
    socket.send(JSON.stringify({
        type: 'leave_table',
        tableId: tableId,
        username: currentUser.username
    }));
}
