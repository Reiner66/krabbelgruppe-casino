const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Datenbank-Datei im aktuellen Ordner definieren
const dbPath = path.join(__dirname, 'casino.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Fehler beim Öffnen der Datenbank:', err.message);
    } else {
        console.log('Erfolgreich mit der SQLite-Datenbank verbunden.');
    }
});

// Tabellen initialisieren
db.serialize(() => {
    // 1. Users Tabelle (Garantiert mit Spalte 'role'!)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        secret_question TEXT NOT NULL,
        secret_answer TEXT NOT NULL,
        coins INTEGER DEFAULT 100,
        title TEXT DEFAULT 'Frischling',
        name_color TEXT DEFAULT '#ffffff',
        has_crown INTEGER DEFAULT 0,
        role TEXT DEFAULT 'player'
    )`);

    // 2. Tables Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_type TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        bet_amount INTEGER NOT NULL,
        is_tournament INTEGER DEFAULT 0,
        tournament_id INTEGER DEFAULT NULL
    )`);

    // 3. Table Players Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS table_players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        is_bot INTEGER DEFAULT 0,
        seat_number INTEGER NOT NULL,
        FOREIGN KEY (table_id) REFERENCES tables (id) ON DELETE CASCADE
    )`);

    // 4. Game States Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS game_states (
        table_id INTEGER PRIMARY KEY,
        state_data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (table_id) REFERENCES tables (id) ON DELETE CASCADE
    )`);

    // 5. Tournaments Tabelle
    db.run(`CREATE TABLE IF NOT EXISTS tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT DEFAULT 'registration',
        bet_amount INTEGER NOT NULL,
        bracket_data TEXT NOT NULL
    )`);

    // 6. Statistiken (Zusammenfassung pro Spieler)
    db.run(`CREATE TABLE IF NOT EXISTS statistics (
        user_id INTEGER PRIMARY KEY,
        games_played INTEGER DEFAULT 0,
        games_won INTEGER DEFAULT 0,
        tournaments_won INTEGER DEFAULT 0,
        all_time_high_coins INTEGER DEFAULT 100,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`);

    // 7. Spiel-Historie (Für Wochen-/Monats-Auswertungen)
    db.run(`CREATE TABLE IF NOT EXISTS game_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        game_type TEXT NOT NULL,
        is_tournament INTEGER DEFAULT 0,
        outcome TEXT NOT NULL, -- 'win' oder 'loss'
        coins_changed INTEGER NOT NULL,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);


    console.log('Alle Tabellen wurden erfolgreich geprüft und angelegt.');
});

module.exports = db;
