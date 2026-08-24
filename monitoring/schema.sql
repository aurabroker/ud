-- Schemat bazy D1 dla monitora.
-- Wgranie:  npx wrangler d1 execute ud-monitor --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS stan (
  id                   TEXT PRIMARY KEY,
  status               TEXT    NOT NULL,          -- up | down | unknown
  od_kiedy             TEXT    NOT NULL,          -- ISO, od kiedy trwa ten status
  pod                  INTEGER NOT NULL DEFAULT 0,-- porażki pod rząd
  ostatni_alert        TEXT,
  sms_wyslany          INTEGER NOT NULL DEFAULT 0,
  ostatni_wynik        TEXT,
  ostatnie_ms          INTEGER,
  ostatnie_sprawdzenie TEXT
);

CREATE TABLE IF NOT EXISTS historia (
  id   TEXT    NOT NULL,
  czas TEXT    NOT NULL,
  ok   INTEGER NOT NULL,
  ms   INTEGER,
  blad TEXT
);
CREATE INDEX IF NOT EXISTS historia_id_czas ON historia (id, czas DESC);
CREATE INDEX IF NOT EXISTS historia_czas    ON historia (czas);

CREATE TABLE IF NOT EXISTS zdarzenia (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  czas        TEXT NOT NULL,
  rodzaj      TEXT,          -- awaria | powrot | przypomnienie | blad-uzytkownika
  sprawdzenie TEXT,
  tresc       TEXT
);
CREATE INDEX IF NOT EXISTS zdarzenia_czas ON zdarzenia (czas DESC);
