require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { BOT_NAMES } = require('./bots');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
let activeTournament = null;

// CRASH-SCHUTZ: Prüft beim Serverstart, ob ein Turnier in der DB offen war
db.get(`SELECT * FROM tournaments WHERE status != 'finished' ORDER BY id DESC LIMIT 1`, [], (err, row) => {
    if (!err && row) {
        try {
            const bracket = JSON.parse(row.bracket_data);
            activeTournament = {
                id: row.id,
                status: row.status, // 'Anmeldung' oder 'Aktiv'
                bet_amount: row.bet_amount,
                game_type: bracket.game_type || 'Mau-Mau',
                boss: bracket.boss || 'Reiner',
                players: bracket.players || [],
                currentMatches: bracket.currentMatches || [],
                byePlayersNextRound: bracket.byePlayersNextRound || [],
                payouts: bracket.payouts || null
            };
            console.log(`[Crash-Schutz] Offenes Turnier #${row.id} erfolgreich aus der DB wiederhergestellt!`);
        } catch (e) { console.error('[Crash-Schutz] Fehler beim Laden der Turnierdaten:', e.message); }
    }
});


const activeTables = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/register', async (req, res) => {
    const { username, password, question, answer } = req.body;
    if (!username || !password || !question || !answer) {
        return res.status(400).json({ error: 'Alle Felder ausfüllen!' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        const answerHash = await bcrypt.hash(answer.toLowerCase().trim(), 10);
        const sql = `INSERT INTO users (username, password_hash, secret_question, secret_answer, coins) VALUES (?, ?, ?, ?, 100)`;
        db.run(sql, [username, passwordHash, question, answerHash], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Name vergeben!' });
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: 'Konto erstellt!' });
        });
    } catch (err) { res.status(500).json({ error: 'Fehler' }); }
});

// ROUTE 2: LOGIN (Erweitert um automatische Admin-Prüfung und Rollen-Übergabe)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Falsche Daten!' });
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Falsche Daten!' });

        // NEU: Wenn sich der Name "Reiner" einloggt, wird er permanent zum Admin gemacht
        if (user.username.toLowerCase() === 'reiner' && user.role !== 'admin') {
            db.run(`UPDATE users SET role = 'admin' WHERE id = ?`, [user.id]);
            user.role = 'admin';
        }

        res.json({
            success: true,
            user: { 
                username: user.username, 
                coins: user.coins, 
                title: user.title, 
                name_color: user.name_color, 
                has_crown: user.has_crown,
                role: user.role // NEU: Übergibt 'admin', 'moderator' oder 'player' an die Lobby
            }
        });
    });
});

// ROUTE 3: PASSWORT VERGESSEN
app.post('/api/forgot', (req, res) => {
    const { username, question, answer, newPassword } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND secret_question = ?`, [username, question], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: 'Falsche Daten!' });
        
        const validAnswer = await bcrypt.compare(answer.toLowerCase().trim(), user.secret_answer);
        if (!validAnswer) return res.status(400).json({ error: 'Falsche Antwort!' });
        
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [newPasswordHash, user.id], (updateErr) => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            res.json({ success: true, message: 'Passwort geändert!' });
        });
    });
});

wss.on('connection', (ws) => {
    console.log('Ein Spieler ist im Portal aktiv.');
    sendGlobalTableAndTournamentUpdate();
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. CHAT-NACHRICHT (Inklusive Admin- & Turnierleiter-Befehlen)
            if (data.type === 'chat_message') {
                const msg = data.message.trim();

                // Erst die Rolle des Schreibers aus der DB holen für die Rechteprüfung
                db.get(`SELECT role FROM users WHERE username = ?`, [data.username], (err, row) => {
                    if (err || !row) return;
                    const uRole = row.role; // 'admin', 'moderator' oder 'player'

                    // BEFEHL A: TURNIER ANKÜNDIGEN (Darf Admin und Moderator!)
                    if (msg.startsWith('!turnier')) {
                        if (uRole !== 'admin' && uRole !== 'moderator') {
                            ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Schluss mit den Mucken, ${data.username}! Du bist kein Turnierleiter!`, color: '#ffc107' }));
                            return;
                        }

                        const parts = msg.split(' ');
                        const gameType = parts[1] || 'Mau-Mau';
                        
                        let betAmount;
                        // Wenn kein Einsatz angegeben wurde, würfle einen Wert zwischen 5 und 10 aus
                        if (!parts[2]) {
                            betAmount = Math.floor(Math.random() * (10 - 5 + 1)) + 5;
                        } else {
                            // Wenn ein Einsatz angegeben wurde, kappe ihn hart auf den Bereich 5 bis 10
                            betAmount = parseInt(parts[2]) || 10;
                            if (betAmount < 5) betAmount = 5;
                            if (betAmount > 10) betAmount = 10;
                        }

                        if (activeTournament) {
                            ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Es läuft bereits ein Turnier!`, color: '#ffc107' }));
                            return;
                        }

                        activeTournament = {
                            id: Math.floor(Math.random() * 900) + 100,
                            game_type: gameType,
                            bet_amount: betAmount,
                            boss: data.username, // Der Ersteller ist der Boss dieser Instanz
                            status: 'Anmeldung',
                            players: []
                        };

                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'chat_broadcast',
                                    username: '🤖 Kommentator',
                                    message: `🚨 TURNIER-ALARM! Turnierleiter ${data.username} hat ein ${gameType}-Turnier eröffnet! Einsatz: ${betAmount} Coins. Meldet euch an! 🏆`,
                                    color: '#ffc107'
                                }));
                            }
                        });
                        sendGlobalTableAndTournamentUpdate();
                        return;
                    }

                    // BEFEHL B: TURNIER ECHT STARTEN (Nur der jeweilige Boss oder Admin!)
                    if (msg === '!start') {
                        if (!activeTournament) return;
                        if (activeTournament.boss !== data.username && uRole !== 'admin') {
                            ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Nur der Turnierleiter ${activeTournament.boss} oder ein Admin darf starten!`, color: '#ffc107' }));
                            return;
                        }
                        if (activeTournament.players.length < 2) {
                            ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Turnier abgesagt! Wir brauchen mindestens 2 echte Menschen.`, color: '#ffc107' }));
                            return;
                        }

                        activeTournament.status = 'Aktiv';
                        
                        // Erste Runde generieren und Freilos prüfen
                        const { matches, byePlayer } = generateFirstRound(activeTournament.players);
                        activeTournament.currentMatches = matches;
                        activeTournament.byePlayersNextRound = byePlayer ? [byePlayer] : [];

                        // Gewinnverteilung exakt berechnen (aufgerundet)
                        const payouts = calculateTournamentPayout(activeTournament.players.length, activeTournament.bet_amount);
                        activeTournament.payouts = payouts;

                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'chat_broadcast',
                                    username: '🤖 Kommentator',
                                    message: `🏁 DAS TURNIER IST ERÖFFNET! Gesamt-Pot: ${payouts.totalPot} Coins! (Platz 1: ${payouts.place1} | Platz 2: ${payouts.place2} | Platz 3: ${payouts.place3} Coins!)`,
                                    color: '#ffc107'
                                }));

                                if (byePlayer) {
                                    client.send(JSON.stringify({
                                        type: 'chat_broadcast',
                                        username: '🤖 Kommentator',
                                        message: `🎰 FREILOS-GLÜCK: ${byePlayer} hat in Runde 1 spielfrei und rutscht direkt weiter! Gönn dir! 🍻`,
                                        color: '#ffd700'
                                    }));
                                }

                                matches.forEach(m => {
                                    client.send(JSON.stringify({
                                        type: 'chat_broadcast',
                                        username: '🤖 Kommentator',
                                        message: `⚔️ BEGEGNUNG #${m.id}: [ ${m.p1} ] gegen [ ${m.p2} ]! Macht euch bereit!`,
                                        color: '#007bff'
                                    }));
                                });
                            }
                        });

                        sendGlobalTableAndTournamentUpdate();
                        return;
                    }

                    // BEFEHL C: NEUEN TURNIERLEITER ERNENNEN (Nur der Admin!)
                    if (msg.startsWith('!tl')) {
                        if (uRole !== 'admin') {
                            ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Netter Versuch, aber nur der absolute Boss Reiner darf Turnierleiter ernennen!`, color: '#ffc107' }));
                            return;
                        }
                        const targetUser = msg.split(' ')[1];
                        if (!targetUser) return;

                        db.run(`UPDATE users SET role = 'moderator' WHERE username = ?`, [targetUser], function(err) {
                            if (err) return;
                            
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({
                                        type: 'chat_broadcast',
                                        username: '🤖 Kommentator',
                                        message: `👑 HÖRT HÖRT! Boss Reiner hat ${targetUser} offiziell in den Ritterstand der TURNIERLEITER erhoben! Ab jetzt darf er Turniere leiten! 🏆`,
                                        color: '#ffc107'
                                    }));
                                }
                            });
                        });
                        return;
                    }

                    // Normale Chat-Nachricht (falls kein Befehl)
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'chat_broadcast', username: data.username, message: data.message, color: data.color || '#ffffff' }));
                        }
                    });
                });
            }


            if (data.type === 'beg_coins') {
                db.get(`SELECT coins FROM users WHERE username = ?`, [data.username], (err, row) => {
                    if (err || !row) return;
                    if (row.coins < 10) {
                        const targetCoins = Math.floor(Math.random() * (16 - 12 + 1)) + 12;
                        db.run(`UPDATE users SET coins = ? WHERE username = ?`, [targetCoins, data.username], () => {
                            ws.send(JSON.stringify({ type: 'beg_success', coins: targetCoins }));
                            const botPhrases = [
                                `Briten Chrissi kichert und wirft ${data.username} Coins in den Hut!`,
                                `Captain Olli spendiert eine Runde Trost-Coins für ${data.username}.`,
                                `Chefin Sika seufzt und füllt das leere Konto von ${data.username} auf.`
                            ];
                            const randomPhrase = botPhrases[Math.floor(Math.random() * botPhrases.length)];
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `${randomPhrase} Stand: ${targetCoins} Coins.`, color: '#ffc107' }));
                                }
                            });
                        });
                    } else {
                        ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Haut ab! ${data.username} hat noch ${row.coins} Coins!`, color: '#ffc107' }));
                    }
                });
            }

            if (data.type === 'create_table') {
                const userAlreadyInTable = Object.values(activeTables).some(t => t.players.some(p => p.username === data.username));
                if (userAlreadyInTable) {
                    ws.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `Du sitzt schon an einem Tisch, ${data.username}!`, color: '#ffc107' }));
                    return;
                }
                const tableId = Math.floor(Math.random() * 9000) + 1000;
                activeTables[tableId] = {
                    id: tableId, 
                    game_type: data.game_type, 
                    bet_amount: data.bet_amount, 
                    max_players: data.max_players || 4, 
                    boss: data.username,
                    status: 'open',
                    players: [{ username: data.username, is_bot: false }]
                };
                ws.send(JSON.stringify({ type: 'table_created', tableId: tableId }));
                wss.clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'table_list', tables: Object.values(activeTables) })); });
            }

            if (data.type === 'leave_table') {
                const t = activeTables[data.tableId];
                if (t) {
                    t.players = t.players.filter(p => p.username !== data.username);
                    if (t.players.length === 0) { 
                        delete activeTables[data.tableId]; 
                    } else if (t.boss === data.username) { 
                        t.boss = t.players[0] ? t.players[0].username : null; 
                    }
                    sendGlobalTableAndTournamentUpdate(); // <-- HIER ERSETZT
                }
            }

            if (data.type === 'join_table') {
                const t = activeTables[data.tableId];
                if (!t || t.players.length >= t.max_players || t.status === 'running') return;
                
                const userAlreadyInTable = Object.values(activeTables).some(table => table.players.some(p => p.username === data.username));
                if (userAlreadyInTable) return;

                db.get(`SELECT coins FROM users WHERE username = ?`, [data.username], (err, row) => {
                    if (err || !row || row.coins < t.bet_amount) return;
                    
                    const newCoins = row.coins - t.bet_amount;
                    db.run(`UPDATE users SET coins = ? WHERE username = ?`, [newCoins, data.username], () => {
                        ws.send(JSON.stringify({ type: 'beg_success', coins: newCoins }));
                        t.players.push({ username: data.username, is_bot: false });
                        
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `${data.username} wirft ${t.bet_amount} Coins auf den Tisch und zockt mit!`, color: '#ffc107' }));
                            }
                        });

                        if (t.players.length >= t.max_players) {
                            t.status = 'running';
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `🚨 BÄM! Tisch #${t.id} ist voll! ${t.game_type} startet JETZT!`, color: '#ffc107' }));
                                    client.send(JSON.stringify({ type: 'game_start_trigger', tableId: t.id, game_type: t.game_type }));
                                }
                            });
                        }
                        sendGlobalTableAndTournamentUpdate(); // <-- HIER ERSETZT
                    });
                });
            }

            if (data.type === 'start_game_with_bots') {
                const t = activeTables[data.tableId];
                if (!t || t.boss !== data.username || t.status === 'running') return;
                
                const freiePlaetze = t.max_players - t.players.length;

                if (freiePlaetze > 0) {
                    const verfuegbareBots = [...BOT_NAMES].sort(() => 0.5 - Math.random());
                    const aktuelleSpieler = t.players.map(p => p.username);
                    const gefilterteBots = verfuegbareBots.filter(name => !aktuelleSpieler.includes(name));
                    
                    for (let i = 0; i < freiePlaetze; i++) {
                        t.players.push({ username: gefilterteBots[i], is_bot: true });
                    }
                }
                
                t.status = 'running';
                const botListeText = t.players.filter(p => p.is_bot).map(p => p.username).join(', ');
                
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'chat_broadcast', username: '🤖 Kommentator', message: `🎲 ${t.boss} startet das Spiel! Freie Plätze besetzt durch: [${botListeText}].`, color: '#ffc107' }));
                        client.send(JSON.stringify({ type: 'game_start_trigger', tableId: t.id, game_type: t.game_type }));
                    }
                });
                sendGlobalTableAndTournamentUpdate();
            }

        } catch (err) { console.error('WebSocket Fehler:', err.message); }
    });
    
    ws.on('close', () => { console.log('Verbindung getrennt.'); });
});
function sendGlobalTableAndTournamentUpdate() {
    const tourneyList = activeTournament ? [activeTournament] : [];
    const payload = JSON.stringify({
        type: 'table_list',
        tables: Object.values(activeTables),
        tournaments: tourneyList
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
    });
}
// Hilfsfunktion: Sichert das aktuelle Turnier absolut crash-sicher in der SQLite-DB
function saveTournamentToDatabase() {
    if (!activeTournament) return;
    
    const bracketData = JSON.stringify({
        game_type: activeTournament.game_type,
        boss: activeTournament.boss,
        players: activeTournament.players,
        currentMatches: activeTournament.currentMatches,
        byePlayersNextRound: activeTournament.byePlayersNextRound,
        payouts: activeTournament.payouts
    });

    // Prüfen, ob das Turnier schon in der DB existiert (INSERT oder UPDATE)
    db.get(`SELECT id FROM tournaments WHERE id = ?`, [activeTournament.id], (err, row) => {
        if (row) {
            db.run(`UPDATE tournaments SET status = ?, bracket_data = ? WHERE id = ?`, [activeTournament.status, bracketData, activeTournament.id]);
        } else {
            db.run(`INSERT INTO tournaments (id, status, bet_amount, bracket_data) VALUES (?, ?, ?, ?)`, [activeTournament.id, activeTournament.status, activeTournament.bet_amount, bracketData]);
        }
    });
}

server.listen(PORT, '0.0.0.0', () => { console.log(`Server läuft auf Port ${PORT}`); });
