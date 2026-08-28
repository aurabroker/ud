-- Schemat bazy D1 monitoringu.
--
-- Świadomie nie Supabase: monitor sprawdza między innymi Supabase, więc
-- trzymanie w nim własnego stanu oznaczałoby, że przy awarii bazy monitor
-- traci zdolność zapisania, że baza padła. D1 leży u innego dostawcy usługi
-- i awarie obu naraz są znacznie mniej prawdopodobne niż awaria jednej.

-- Pojedyncze pomiary. Trzymamy 30 dni — dłuższa historia nie zmienia decyzji,
-- a rośnie w nieskończoność.
CREATE TABLE IF NOT EXISTS pomiar (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sonda     TEXT    NOT NULL,
  czas      INTEGER NOT NULL,           -- unix ms
  ok        INTEGER NOT NULL,           -- 0 / 1
  ms        INTEGER,                    -- czas odpowiedzi
  kod       INTEGER,                    -- status HTTP, gdy dotyczy
  szczegoly TEXT                        -- powód niepowodzenia, skrócony
);

CREATE INDEX IF NOT EXISTS pomiar_sonda_czas ON pomiar (sonda, czas DESC);

-- Bieżący stan każdej sondy. Osobna tabela, bo alerty wysyłamy na PRZEJŚCIU
-- między stanami, a nie przy każdym pomiarze — inaczej po godzinie awarii
-- adresat ma dwanaście identycznych wiadomości i wycisza kanał.
CREATE TABLE IF NOT EXISTS stan (
  sonda     TEXT    PRIMARY KEY,
  ok        INTEGER NOT NULL,
  pod_rzad  INTEGER NOT NULL DEFAULT 1, -- ile pomiarów z rzędu w tym stanie
  od        INTEGER NOT NULL,           -- unix ms wejścia w ten stan
  zgloszony INTEGER NOT NULL DEFAULT 0, -- czy alert o tym stanie już poszedł
  szczegoly TEXT
);
