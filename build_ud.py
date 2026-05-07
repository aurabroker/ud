#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_ud.py - Generator stron zawodowych dla utratadochodu.pl
Użycie: python3 build_ud.py --out ./dist
"""

import os
import json
import argparse
from datetime import date
from html import escape

# ── LISTA ZAWODÓW ─────────────────────────────────────────────────────────────
PROFESSIONS = [
    # PRAWO
    ("adwokat", "Adwokat", "prawo"),
    ("radca-prawny", "Radca Prawny", "prawo"),
    ("notariusz", "Notariusz", "prawo"),
    ("prawnik", "Prawnik", "prawo"),
    ("mediator", "Mediator", "prawo"),
    ("rzecznik-patentowy", "Rzecznik Patentowy", "prawo"),
    ("syndyk", "Syndyk Masy Upadłościowej", "prawo"),
    # MEDYCYNA
    ("lekarz", "Lekarz", "medycyna"),
    ("chirurg", "Chirurg", "medycyna"),
    ("kardiolog", "Kardiolog", "medycyna"),
    ("ortopeda", "Ortopeda", "medycyna"),
    ("neurolog", "Neurolog", "medycyna"),
    ("onkolog", "Onkolog", "medycyna"),
    ("psychiatra", "Psychiatra", "medycyna"),
    ("ginekolog", "Ginekolog", "medycyna"),
    ("pediatra", "Pediatra", "medycyna"),
    ("dermatolog", "Dermatolog", "medycyna"),
    ("okulista", "Okulista", "medycyna"),
    ("urolog", "Urolog", "medycyna"),
    ("endokrynolog", "Endokrynolog", "medycyna"),
    ("pulmonolog", "Pulmonolog", "medycyna"),
    ("gastroenterolog", "Gastroenterolog", "medycyna"),
    ("reumatolog", "Reumatolog", "medycyna"),
    ("radiolog", "Radiolog", "medycyna"),
    ("anestezjolog", "Anestezjolog", "medycyna"),
    ("patolog", "Patolog", "medycyna"),
    ("internista", "Internista", "medycyna"),
    ("hematolog", "Hematolog", "medycyna"),
    ("nefrolog", "Nefrolog", "medycyna"),
    ("alergolog", "Alergolog", "medycyna"),
    ("immunolog", "Immunolog", "medycyna"),
    ("infectolog", "Specjalista Chorób Zakaźnych", "medycyna"),
    ("neonatolog", "Neonatolog", "medycyna"),
    ("medycyna-pracy", "Lekarz Medycyny Pracy", "medycyna"),
    ("medycyna-sadowa", "Lekarz Medycyny Sądowej", "medycyna"),
    ("geriatria", "Geriatra", "medycyna"),
    ("rehabilitacja", "Lekarz Rehabilitacji", "medycyna"),
    ("transplantologia", "Transplantolog", "medycyna"),
    ("seksuolog", "Seksuolog", "medycyna"),
    ("neurochirurg", "Neurochirurg", "medycyna"),
    ("torakochirurg", "Torakochirurg", "medycyna"),
    ("wenerolog", "Wenerolog", "medycyna"),
    ("nuklearny", "Lekarz Medycyny Nuklearnej", "medycyna"),
    ("toksykolog", "Toksykolog Kliniczny", "medycyna"),
    ("balneolog", "Balneolog", "medycyna"),
    ("chirurgia-plastyczna", "Chirurg Plastyczny", "medycyna"),
    ("chirurgia-naczyn", "Chirurg Naczyniowy", "medycyna"),
    ("weterynarz", "Weterynarz", "medycyna"),
    # STOMATOLOGIA
    ("stomatolog", "Stomatolog", "stomatologia"),
    ("ortodonta", "Ortodonta", "stomatologia"),
    ("periodontolog", "Periodontolog", "stomatologia"),
    ("chirurg-szczekowy", "Chirurg Szczękowo-Twarzowy", "stomatologia"),
    ("protetyk", "Protetyk Stomatologiczny", "stomatologia"),
    ("endodontolog", "Endodontolog", "stomatologia"),
    # PIELĘGNIARSTWO
    ("pielegniarka", "Pielęgniarka", "pielegniarstwo"),
    ("polozna", "Położna", "pielegniarstwo"),
    ("ratownik-medyczny", "Ratownik Medyczny", "pielegniarstwo"),
    ("fizjoterapeuta", "Fizjoterapeuta", "pielegniarstwo"),
    ("logopeda", "Logopeda", "pielegniarstwo"),
    ("dietetyk", "Dietetyk", "pielegniarstwo"),
    ("psycholog", "Psycholog", "pielegniarstwo"),
    ("optometrysta", "Optometrysta", "pielegniarstwo"),
    ("technik-rtg", "Technik Radiologii", "pielegniarstwo"),
    # FARMACJA
    ("farmaceuta", "Farmaceuta", "farmacja"),
    ("diagnosta", "Diagnosta Laboratoryjny", "farmacja"),
    ("farmaceuta-aptekarz", "Aptekarz", "farmacja"),
    # IT
    ("programista", "Programista", "it"),
    ("developer", "Developer", "it"),
    ("frontend-developer", "Frontend Developer", "it"),
    ("backend-developer", "Backend Developer", "it"),
    ("fullstack-developer", "Fullstack Developer", "it"),
    ("devops", "DevOps Engineer", "it"),
    ("tester", "Tester Oprogramowania", "it"),
    ("analityk-danych", "Analityk Danych", "it"),
    ("data-scientist", "Data Scientist", "it"),
    ("cybersecurity", "Specjalista Cyberbezpieczeństwa", "it"),
    ("administrator-sieci", "Administrator Sieci", "it"),
    ("ux-designer", "UX Designer", "it"),
    ("product-manager", "Product Manager", "it"),
    ("scrum-master", "Scrum Master", "it"),
    ("architect-it", "Architekt IT", "it"),
    ("ai-engineer", "AI Engineer", "it"),
    # FINANSE
    ("ksiegowy", "Księgowy", "finanse"),
    ("doradca-finansowy", "Doradca Finansowy", "finanse"),
    ("makler", "Makler Giełdowy", "finanse"),
    ("analityk-finansowy", "Analityk Finansowy", "finanse"),
    ("audytor", "Audytor", "finanse"),
    ("doradca-podatkowy", "Doradca Podatkowy", "finanse"),
    ("aktuariusz", "Aktuariusz", "finanse"),
    ("ekonomista", "Ekonomista", "finanse"),
    ("agent-ubezpieczeniowy", "Agent Ubezpieczeniowy", "finanse"),
    ("rzeczoznawca", "Rzeczoznawca Majątkowy", "finanse"),
    # BUDOWNICTWO
    ("architekt", "Architekt", "budownictwo"),
    ("inzynier-budowlany", "Inżynier Budowlany", "budownictwo"),
    ("elektryk", "Elektryk", "budownictwo"),
    ("hydraulik", "Hydraulik", "budownictwo"),
    ("murarz", "Murarz", "budownictwo"),
    ("glazurnik", "Glazurnik", "budownictwo"),
    ("dekarz", "Dekarz", "budownictwo"),
    ("ciesla", "Cieśla", "budownictwo"),
    ("spawacz", "Spawacz", "budownictwo"),
    ("slusarz", "Ślusarz", "budownictwo"),
    ("mechanik", "Mechanik", "budownictwo"),
    ("instalator", "Instalator", "budownictwo"),
    ("geodeta", "Geodeta", "budownictwo"),
    # TRANSPORT
    ("kierowca-zawodowy", "Kierowca Zawodowy", "transport"),
    ("taksowkarz", "Taksówkarz", "transport"),
    ("kurier", "Kurier", "transport"),
    ("pilot", "Pilot", "transport"),
    ("kapitan-statku", "Kapitan Statku", "transport"),
    ("maszynista", "Maszynista", "transport"),
    # BEAUTY
    ("fryzjer", "Fryzjer", "beauty"),
    ("kosmetyczka", "Kosmetyczka", "beauty"),
    ("kosmetolog", "Kosmetolog", "beauty"),
    ("masazysta", "Masażysta", "beauty"),
    ("esteta", "Esteta Medyczny", "beauty"),
    ("tatuazysta", "Tatuażysta", "beauty"),
    ("terapeuta", "Terapeuta", "beauty"),
    # GASTRONOMIA
    ("kucharz", "Kucharz", "gastronomia"),
    ("szef-kuchni", "Szef Kuchni", "gastronomia"),
    ("cukiernik", "Cukiernik", "gastronomia"),
    ("barista", "Barista", "gastronomia"),
    ("sommelier", "Sommelier", "gastronomia"),
    ("kelner", "Kelner", "gastronomia"),
    # EDUKACJA
    ("nauczyciel", "Nauczyciel", "edukacja"),
    ("wykladowca", "Wykładowca", "edukacja"),
    ("trener-personalny", "Trener Personalny", "edukacja"),
    ("coach", "Coach", "edukacja"),
    ("pedagog", "Pedagog", "edukacja"),
    ("lektor", "Lektor Języków", "edukacja"),
    # BIZNES
    ("manager", "Manager", "biznes"),
    ("konsultant", "Konsultant", "biznes"),
    ("wlasciciel-firmy", "Właściciel Firmy", "biznes"),
    ("handlowiec", "Handlowiec", "biznes"),
    ("przedstawiciel-handlowy", "Przedstawiciel Handlowy", "biznes"),
    ("marketing-specialist", "Specjalista ds. Marketingu", "biznes"),
    ("hr-specialist", "Specjalista HR", "biznes"),
    ("project-manager", "Project Manager", "biznes"),
    ("copywriter", "Copywriter", "biznes"),
    # SZTUKA / MEDIA
    ("fotograf", "Fotograf", "sztuka"),
    ("grafik", "Grafik", "sztuka"),
    ("dziennikarz", "Dziennikarz", "sztuka"),
    ("aktor", "Aktor", "sztuka"),
    ("muzyk", "Muzyk", "sztuka"),
    ("rezyser", "Reżyser", "sztuka"),
    ("tlumacz", "Tłumacz", "sztuka"),
    ("youtuber", "Youtuber / Twórca", "sztuka"),
    ("pisarz", "Pisarz", "sztuka"),
    # BEZPIECZEŃSTWO
    ("policjant", "Policjant", "bezpieczenstwo"),
    ("strazak", "Strażak", "bezpieczenstwo"),
    ("ochroniarz", "Pracownik Ochrony", "bezpieczenstwo"),
    ("detektyw", "Detektyw", "bezpieczenstwo"),
    ("straznik-miejski", "Strażnik Miejski", "bezpieczenstwo"),
    ("kryminolog", "Kryminolog", "bezpieczenstwo"),
    # MEDYCYNA — dodatkowe specjalizacje
    ("medycyna-sportowa", "Lekarz Medycyny Sportowej", "medycyna"),
    ("medycyna-ratunkowa", "Lekarz Medycyny Ratunkowej", "medycyna"),
    ("kardiochirurg", "Kardiochirurg", "medycyna"),
    ("androlog", "Androlog", "medycyna"),
    ("foniatra", "Foniatra", "medycyna"),
    ("epidemiolog", "Epidemiolog", "medycyna"),
    ("medycyna-hiperbaryczna", "Lekarz Medycyny Hiperbarycznej", "medycyna"),
    ("medycyna-tropikalna", "Lekarz Medycyny Tropikalnej", "medycyna"),
    ("onkolog-kliniczny", "Onkolog Kliniczny", "medycyna"),
    ("chirurgia-onkologiczna", "Chirurg Onkologiczny", "medycyna"),
    # PIELĘGNIARSTWO — dodatkowe
    ("pielegniarka-operacyjna", "Pielęgniarka Operacyjna", "pielegniarstwo"),
    ("terapeuta-zajęciowy", "Terapeuta Zajęciowy", "pielegniarstwo"),
    ("technik-elektroradiolog", "Technik Elektroradiolog", "pielegniarstwo"),
    ("higienistka-stomatologiczna", "Higienistka Stomatologiczna", "pielegniarstwo"),
    ("pielegniarka-srodowiskowa", "Pielęgniarka Środowiskowa", "pielegniarstwo"),
    # FARMACJA — dodatkowe
    ("technik-farmaceutyczny", "Technik Farmaceutyczny", "farmacja"),
    ("analityk-laboratoryjny", "Analityk Laboratoryjny", "farmacja"),
    # IT — dodatkowe
    ("mobile-developer", "Mobile Developer", "it"),
    ("cloud-architect", "Cloud Architect", "it"),
    ("game-developer", "Game Developer", "it"),
    ("blockchain-developer", "Blockchain Developer", "it"),
    ("security-analyst", "Security Analyst", "it"),
    ("business-analyst", "Business Analyst", "it"),
    ("solution-architect", "Solution Architect", "it"),
    ("ml-engineer", "Machine Learning Engineer", "it"),
    # FINANSE — dodatkowe
    ("controller", "Controller Finansowy", "finanse"),
    ("compliance-officer", "Compliance Officer", "finanse"),
    ("wealth-manager", "Wealth Manager", "finanse"),
    ("analityk-kredytowy", "Analityk Kredytowy", "finanse"),
    ("treasury-analyst", "Treasury Analyst", "finanse"),
    # BUDOWNICTWO — dodatkowe
    ("architekt-wnetrz", "Architekt Wnętrz", "budownictwo"),
    ("kierownik-budowy", "Kierownik Budowy", "budownictwo"),
    ("kosztorysant", "Kosztorysant Budowlany", "budownictwo"),
    ("inspektor-nadzoru", "Inspektor Nadzoru Budowlanego", "budownictwo"),
    ("rzeczoznawca-budowlany", "Rzeczoznawca Budowlany", "budownictwo"),
    # TRANSPORT — dodatkowe
    ("dyspozytor", "Dyspozytor", "transport"),
    ("logistyk", "Logistyk", "transport"),
    ("spedytor", "Spedytor", "transport"),
    ("agent-celny", "Agent Celny", "transport"),
    # BEAUTY — dodatkowe
    ("stylista", "Stylista", "beauty"),
    ("nail-artist", "Nail Artist", "beauty"),
    ("wizazysta", "Wizażysta", "beauty"),
    # GASTRONOMIA — dodatkowe
    ("technolog-zywnosci", "Technolog Żywności", "gastronomia"),
    ("menedzer-restauracji", "Menedżer Restauracji", "gastronomia"),
    # EDUKACJA — dodatkowe
    ("doradca-zawodowy", "Doradca Zawodowy", "edukacja"),
    ("instruktor-jazdy", "Instruktor Jazdy", "edukacja"),
    ("animator", "Animator Kultury", "edukacja"),
    ("bibliotekarz", "Bibliotekarz", "edukacja"),
    # BIZNES — dodatkowe
    ("sales-manager", "Sales Manager", "biznes"),
    ("brand-manager", "Brand Manager", "biznes"),
    ("event-manager", "Event Manager", "biznes"),
    ("rekruter", "Rekruter", "biznes"),
    ("key-account-manager", "Key Account Manager", "biznes"),
    ("public-relations", "Specjalista PR", "biznes"),
    ("dyrektor", "Dyrektor", "biznes"),
    # SZTUKA / MEDIA — dodatkowe
    ("scenarzysta", "Scenarzysta", "sztuka"),
    ("operator-kamery", "Operator Kamery", "sztuka"),
    ("montazysta", "Montażysta", "sztuka"),
    ("ilustrator", "Ilustrator", "sztuka"),
    ("choreograf", "Choreograf", "sztuka"),
    ("animator-3d", "Animator 3D", "sztuka"),
    ("lektor-radiowy", "Lektor Radiowy", "sztuka"),
    # NIERUCHOMOŚCI
    ("agent-nieruchomosci", "Agent Nieruchomości", "finanse"),
    ("zarzadca-nieruchomosci", "Zarządca Nieruchomości", "finanse"),
    ("posrednik-nieruchomosci", "Pośrednik w Obrocie Nieruchomościami", "finanse"),
    # NAUKA / BADANIA
    ("naukowiec", "Naukowiec / Badacz", "edukacja"),
    ("analityk-naukowy", "Analityk Naukowy", "edukacja"),
    ("statystyk", "Statystyk", "finanse"),
]

# ── DOMYŚLNE DANE PER KATEGORIA ───────────────────────────────────────────────
CATEGORY_DEFAULTS = {
    "medycyna": {
        "subtitle": "Jeden miesiąc przerwy w pracy to utrata kontraktu, dyżurów i tysięcy złotych przychodów -- bez żadnej gwarancji ze strony ZUS.",
        "risks": [
            {"icon": "🦠", "title": "Zakażenie zawodowe", "desc": "Codzienny kontakt z pacjentami naraża na patogeny, w tym HCV, HBV i inne choroby zakaźne."},
            {"icon": "🤒", "title": "Choroba zakaźna sezonowa", "desc": "Grypa, angina czy COVID mogą wykluczyć z pracy na kilka tygodni -- bez żadnego wynagrodzenia na B2B."},
            {"icon": "🦴", "title": "Urazy narządu ruchu", "desc": "Wielogodzinna praca w pochyleniu lub przy stole operacyjnym prowadzi do zmian zwyrodnieniowych kręgosłupa."},
        ],
        "income_without": "0 zł / mies. (B2B) lub ~80% podstawy (etat, po 30 dniach)",
        "income_with": "nawet 500 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy mogę się ubezpieczyć na kontrakcie B2B?", "a": "Tak -- polisa jest dedykowana samozatrudnionym i kontraktowym. To dla nich ZUS nie zapewnia żadnej ochrony od pierwszego dnia."},
            {"q": "Ile wynosi karencja?", "a": "Standardowo 30 dni od daty zawarcia umowy. Po upłynięciu karencji ochrona działa od 1. dnia niezdolności."},
            {"q": "Co z chorobami zdiagnozowanymi przed ubezpieczeniem?", "a": "Choroby istniejące w dniu zawarcia umowy mogą być wyłączone z ochrony. Doradca ocenia każdy przypadek indywidualnie."},
            {"q": "Jaka jest maksymalna suma ubezpieczenia?", "a": "Do 80% udokumentowanego miesięcznego dochodu netto -- maksymalnie 30 000 zł miesięcznie."},
        ],
    },
    "stomatologia": {
        "subtitle": "Złamany palec, choroba dłoni czy infekcja -- i gabinet stomatologiczny stoi pusty. Nie musisz się na to godzić.",
        "risks": [
            {"icon": "🤚", "title": "Uraz dłoni i nadgarstka", "desc": "Mikrourazy podczas zabiegów precyzyjnych mogą wykluczyć z pracy na tygodnie lub miesiące."},
            {"icon": "🦠", "title": "Zakażenie krwiopochodne", "desc": "Praca z ostrymi narzędziami przy pacjencie to ryzyko ekspozycji na HBV, HCV i inne patogeny."},
            {"icon": "🎧", "title": "Uszkodzenie słuchu", "desc": "Długotrwała praca z wiertłami i ultradźwiękami może prowadzić do trwałego uszkodzenia narządu słuchu."},
        ],
        "income_without": "0 zł / mies. (gabinet bez stomatologa nie generuje przychodu)",
        "income_with": "nawet 400 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje choroby zawodowe stomatologów?", "a": "Tak -- choroby dłoni, alergiczne reakcje na lateks i inne schorzenia zawodowe mogą być objęte ochroną."},
            {"q": "Czy mogę ubezpieczyć się jako właściciel gabinetu?", "a": "Tak -- polisa chroni Twój osobisty dochód z pracy zawodowej, niezależnie od formy prowadzenia działalności."},
            {"q": "Co z zasiłkiem ZUS?", "a": "Dentysta na B2B nie ma prawa do zasiłku chorobowego ZUS. Polisa jest jedyną realną ochroną."},
            {"q": "Jak szybko otrzymam świadczenie?", "a": "Po dostarczeniu dokumentacji (ZLA lub równoważnej) -- zazwyczaj w ciągu 5–10 dni roboczych."},
        ],
    },
    "pielegniarstwo": {
        "subtitle": "Praca zmianowa, ciężkie dyżury i kontakt z chorymi -- pielęgniarki i ratownicy są szczególnie narażeni na nagłą niezdolność do pracy.",
        "risks": [
            {"icon": "💉", "title": "Zakłucie igłą", "desc": "Jedno niefortunne zakłucie może wyłączyć z zawodu na miesiące -- zwłaszcza gdy wymagana jest kwarantanna lub leczenie."},
            {"icon": "🦴", "title": "Urazy kręgosłupa", "desc": "Przenoszenie pacjentów i praca w wymuszonej pozycji to najczęstszy powód długotrwałych zwolnień w tej grupie."},
            {"icon": "🤒", "title": "Choroby zakaźne", "desc": "Codzienny kontakt z chorymi pacjentami to stałe narażenie na infekcje wirusowe i bakteryjne."},
        ],
        "income_without": "~80% podstawy (etat) po 30 dniach; 0 zł na B2B",
        "income_with": "nawet 350 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje zakłucia i ekspozycje zawodowe?", "a": "Tak -- niezdolność do pracy w wyniku zakłucia igłą lub ekspozycji na materiał biologiczny jest objęta ochroną."},
            {"q": "Czy pracując na etacie też mogę się ubezpieczyć?", "a": "Tak -- polisa uzupełnia świadczenia ZUS, które często nie pokrywają realnej straty dochodu."},
            {"q": "Ile wynosi minimalna suma dzienna?", "a": "Możesz wybrać świadczenie dzienne od 100 zł wzwyż, dopasowane do realnego dochodu."},
            {"q": "Czy polisa obejmuje choroby psychiczne?", "a": "Polisa obejmuje niezdolność do pracy spowodowaną chorobą psychiczną zdiagnozowaną i potwierdzoną przez lekarza psychiatrę. Wypalenie zawodowe jako samodzielna diagnoza nie jest objęte ochroną."},
        ],
    },
    "farmacja": {
        "subtitle": "Aptekarz i diagnosta laboratoryjny pracują na kontaktach. Choroba to nie tylko utrata zdrowia -- to utrata przychodów bez żadnej siatki bezpieczeństwa.",
        "risks": [
            {"icon": "🧪", "title": "Ekspozycja na substancje chemiczne", "desc": "Codzienne obcowanie z lekami i odczynnikami może wywołać alergię lub chorobę zawodową."},
            {"icon": "🦠", "title": "Zakażenie od pacjentów", "desc": "Bezpośredni kontakt z osobami chorymi przy okienku aptecznym lub w laboratorium."},
            {"icon": "🦴", "title": "Przeciążenie układu ruchu", "desc": "Wielogodzinna praca stojąca prowadzi do chorób kręgosłupa i kończyn dolnych."},
        ],
        "income_without": "~80% podstawy (etat) lub 0 zł (B2B)",
        "income_with": "nawet 300 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy alergia na leki to choroba zawodowa objęta polisą?", "a": "Tak -- alergie zawodowe powodujące niezdolność do pracy są objęte ochroną standardową."},
            {"q": "Jak szybko można zawrzeć umowę?", "a": "Wniosek online zajmuje ok. 5 minut. Umowa wchodzi w życie po akceptacji przez towarzystwo."},
            {"q": "Czy polisa obejmuje urlop macierzyński lub ojcowski?", "a": "Nie -- polisa obejmuje niezdolność do pracy z powodu choroby lub wypadku, nie przerwy planowe."},
            {"q": "Czy mogę zmienić wysokość świadczenia w trakcie trwania umowy?", "a": "Tak -- co roku przy wznowieniu możesz dostosować sumę do aktualnych dochodów."},
        ],
    },
    "it": {
        "subtitle": "Na kontrakcie B2B jedno zdanie brzmi szczególnie groźnie: 'brak faktury w tym miesiącu'. Choroba to nie urlop -- to brak wypłaty.",
        "risks": [
            {"icon": "🖱️", "title": "RSI i przeciążenia nadgarstka", "desc": "Wielogodzinna praca przy klawiaturze i myszy prowadzi do zespołu przeciążeniowego rąk i nadgarstków."},
            {"icon": "🖥️", "title": "Zespół cieśni nadgarstka", "desc": "Wielogodzinna praca przy klawiaturze prowadzi do zmian nerwowych i zapalenia ścięgien dłoni."},
            {"icon": "👁️", "title": "Choroby wzroku i kręgosłupa", "desc": "Siedzący tryb pracy przed ekranem to chroniczne przeciążenie oczu i lędźwiowego odcinka kręgosłupa."},
        ],
        "income_without": "0 zł (B2B -- brak faktury = brak przychodu)",
        "income_with": "nawet 600 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa działa od pierwszego dnia choroby?", "a": "Tak -- po upłynięciu 30-dniowej karencji, świadczenie jest wypłacane od 1. dnia udokumentowanej niezdolności."},
            {"q": "Ile wynosi typowa składka dla specjalisty IT?", "a": "Przy świadczeniu 300 zł/dzień składka wynosi ok. 150–250 zł miesięcznie, w zależności od wieku."},
            {"q": "Co z wypaleniem zawodowym?", "a": "Wypalenie zawodowe jako samodzielna diagnoza nie jest objęte ochroną. Polisa chroni przed niezdolnością do pracy wynikającą z chorób somatycznych i udokumentowanych schorzeń."},
            {"q": "Czy mogę mieć kilka polis jednocześnie?", "a": "Tak, ale łączna suma świadczeń nie może przekroczyć 80% udokumentowanego dochodu netto."},
        ],
    },
    "finanse": {
        "subtitle": "Twoja praca opiera się na relacjach i zaufaniu klientów -- ale choroba nie czeka na zamknięcie kwartału.",
        "risks": [
            {"icon": "🧠", "title": "Stres i wypalenie zawodowe", "desc": "Presja wyników, odpowiedzialność za cudze pieniądze i rozliczenia podatkowe to stały stres zawodowy."},
            {"icon": "🦴", "title": "Choroby układu ruchu", "desc": "Praca biurowa przy ekranie przez 8–10 godzin dziennie prowadzi do problemów z kręgosłupem."},
            {"icon": "🫀", "title": "Choroby sercowo-naczyniowe", "desc": "Siedzący tryb pracy i stres to czynniki ryzyka chorób serca, zawału i udaru."},
        ],
        "income_without": "0 zł (B2B) lub ~80% podstawy (etat, po 30 dniach)",
        "income_with": "nawet 500 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa jest odliczana od podatku?", "a": "Składka może być kosztem uzyskania przychodu dla samozatrudnionych -- skonsultuj z doradcą podatkowym."},
            {"q": "Co jeśli choroba trwa krócej niż miesiąc?", "a": "Świadczenie jest wypłacane za każdy dzień udokumentowanej niezdolności -- bez minimalnego okresu."},
            {"q": "Czy mogę ubezpieczyć się tuż przed sezonem rozliczeniowym?", "a": "Tak -- ale obowiązuje 30-dniowa karencja od daty zawarcia umowy."},
            {"q": "Jakie dokumenty są potrzebne przy roszczeniu?", "a": "Wystarczy zaświadczenie lekarskie (ZLA lub zagraniczna forma równoważna) oraz wniosek o wypłatę świadczenia."},
        ],
    },
    "budownictwo": {
        "subtitle": "Jeden wypadek na dachu, pęknięte żebro albo przeciążony kręgosłup -- i tygodnie bez zleceń. Ochrona, której na budowie nikt Ci nie da.",
        "risks": [
            {"icon": "🪜", "title": "Upadki i urazy mechaniczne", "desc": "Praca na wysokości, rusztowaniach i przy maszynach to najwyższe ryzyko urazów w całej gospodarce."},
            {"icon": "🦴", "title": "Przeciążenia i choroby kręgosłupa", "desc": "Dźwiganie, praca w wymuszonej pozycji i drgania narzędzi prowadzą do trwałych uszkodzeń narządu ruchu."},
            {"icon": "☣️", "title": "Narażenie na substancje szkodliwe", "desc": "Pył, farby, rozpuszczalniki -- długotrwała ekspozycja to ryzyko chorób płuc i skóry."},
        ],
        "income_without": "0 zł (brak zleceń = brak przychodu)",
        "income_with": "nawet 400 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje wypadki podczas pracy fizycznej?", "a": "Tak -- niezdolność do pracy wynikająca z wypadku jest objęta ochroną standardową."},
            {"q": "Czy mogę się ubezpieczyć prowadząc jednoosobową firmę budowlaną?", "a": "Tak -- oferta jest dedykowana samozatrudnionym rzemieślnikom i wykonawcom."},
            {"q": "Co z niezdolnością po operacji kręgosłupa?", "a": "Rehabilitacja po zabiegu jest objęta ochroną -- liczy się czas faktycznej niezdolności do pracy."},
            {"q": "Jak długo może trwać wypłata świadczenia?", "a": "Do 12 lub 24 miesięcy w zależności od wariantu -- wystarczająco długo na pełną rehabilitację."},
        ],
    },
    "transport": {
        "subtitle": "Kierowca bez prawa jazdy, pilot bez orzeczenia -- jeden wpis w dokumentacji medycznej i koniec kontraktu.",
        "risks": [
            {"icon": "🚗", "title": "Utrata uprawnień zawodowych", "desc": "Nagła choroba lub wypadek może skutkować cofnięciem uprawnień i utratą jedynego źródła dochodu."},
            {"icon": "🦴", "title": "Choroby kręgosłupa", "desc": "Wielogodzinne prowadzenie pojazdu w jednej pozycji to jedno z najczęstszych źródeł chorób zawodowych."},
            {"icon": "😴", "title": "Zaburzenia snu i zmęczenie", "desc": "Nieregularny rytm dobowy, nocne kursy i zmiany stref czasowych niszczą zdrowie w długim terminie."},
        ],
        "income_without": "0 zł (brak kursu = brak wypłaty)",
        "income_with": "nawet 350 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje utratę prawa jazdy z powodu choroby?", "a": "Tak -- niezdolność do wykonywania zawodu kierowcy spowodowana chorobą jest objęta ochroną."},
            {"q": "Czy mogę ubezpieczyć się pracując dla platformy (Uber, Bolt)?", "a": "Tak -- samozatrudnieni kierowcy to jedna z głównych grup docelowych oferty."},
            {"q": "Co z wypadkiem drogowym?", "a": "Polisa obejmuje niezdolność do pracy niezależnie od okoliczności wypadku -- to nie jest OC."},
            {"q": "Jak szybko jest wypłacane świadczenie?", "a": "Po dostarczeniu zaświadczenia lekarskiego -- zazwyczaj w ciągu 5–10 dni roboczych."},
        ],
    },
    "beauty": {
        "subtitle": "Twoje ręce to Twoje narzędzia pracy. Jeden uraz nadgarstka albo zakażenie zawodowe i salon stoi pusty -- bez Ciebie.",
        "risks": [
            {"icon": "🤚", "title": "Urazy dłoni i nadgarstka", "desc": "Precyzyjna praca nożyczkami, pędzlem czy strzykawką naraża dłonie na mikrourazy i stany zapalne."},
            {"icon": "🧴", "title": "Alergie zawodowe", "desc": "Farby, utleniacze, kleje akrylowe -- substancje chemiczne stosowane w branży beauty to częste źródło chorób zawodowych."},
            {"icon": "🦠", "title": "Zakażenia krwiopochodne", "desc": "Zabiegi inwazyjne (mikronakłucia, tatuaże) niosą ryzyko ekspozycji na HBV i HCV."},
        ],
        "income_without": "0 zł (brak wizyt = brak przychodu)",
        "income_with": "nawet 300 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje alergię zawodową na substancje chemiczne?", "a": "Tak -- choroba zawodowa powodująca niezdolność do pracy jest objęta ochroną standardową."},
            {"q": "Czy mogę ubezpieczyć się jako właściciel salonu?", "a": "Tak -- polisa chroni Twoje osobiste dochody z pracy, niezależnie od formy prowadzenia salonu."},
            {"q": "Co z L4 podczas ciąży?", "a": "Polisa nie obejmuje ciąży jako zdarzenia ubezpieczeniowego, ale obejmuje powikłania chorobowe w jej trakcie."},
            {"q": "Ile wynosi minimalna składka?", "a": "Od ok. 80 zł miesięcznie przy świadczeniu 100 zł/dzień -- dopasuj do swoich realnych zarobków."},
        ],
    },
    "gastronomia": {
        "subtitle": "Kuchnia nie gotuje się sama. Jedno oparzenie, złamanie palca albo zakażenie i tracisz każdą zmianę bez żadnego wynagrodzenia.",
        "risks": [
            {"icon": "🔥", "title": "Oparzenia i urazy termiczne", "desc": "Praca przy piecu, patelni i gorących naczyniach to codzienne ryzyko urazów termicznych dłoni."},
            {"icon": "🔪", "title": "Skaleczenia i urazy kończyn", "desc": "Noże i maszyny gastronomiczne to najczęstsze źródła urazów w branży spożywczej."},
            {"icon": "🦴", "title": "Choroby kręgosłupa i nóg", "desc": "Wielogodzinna praca stojąca prowadzi do żylaków, problemów z kolanami i kręgosłupem."},
        ],
        "income_without": "0 zł (zmiana odwołana = brak wypłaty)",
        "income_with": "nawet 250 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje zwolnienie po oparzeniu?", "a": "Tak -- niezdolność do pracy z powodu wypadku (w tym oparzenia) jest objęta ochroną od pierwszego dnia po karencji."},
            {"q": "Czy mogę się ubezpieczyć pracując na umowie zlecenie?", "a": "Polisa jest dostępna dla samozatrudnionych i właścicieli lokali. Osoby na umowie zlecenie -- skonsultuj indywidualnie."},
            {"q": "Co z epidemią lub zamknięciem lokalu?", "a": "Polisa obejmuje niezdolność do pracy z przyczyn zdrowotnych, nie zamknięcie biznesu z powodów administracyjnych."},
            {"q": "Jaki jest maksymalny okres wypłaty?", "a": "Do 12 lub 24 miesięcy -- wystarczająco długo na pełną rehabilitację po poważnym urazie."},
        ],
    },
    "edukacja": {
        "subtitle": "Nauczyciel bez głosu, trener po kontuzji, wykładowca z wypaleniem -- i lekcje odwołane. A faktura przychodzi bez względu na stan zdrowia.",
        "risks": [
            {"icon": "🗣️", "title": "Choroby głosu i gardła", "desc": "Intensywna praca głosowa przez wiele godzin dziennie to jedno z największych ryzyk zawodowych nauczycieli."},
            {"icon": "🤒", "title": "Choroby układu oddechowego", "desc": "Nauczyciele mają jeden z najwyższych wskaźników zachorowań na infekcje górnych dróg oddechowych."},
            {"icon": "🦴", "title": "Urazy podczas treningów", "desc": "Trenerzy i nauczyciele WF są narażeni na urazy podczas demonstracji i prowadzenia zajęć ruchowych."},
        ],
        "income_without": "~80% podstawy (etat) po 30 dniach; 0 zł (freelance)",
        "income_with": "nawet 300 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje choroby głosu?", "a": "Tak -- schorzenia strun głosowych i krtani powodujące niezdolność do pracy są objęte ochroną."},
            {"q": "Czy mogę ubezpieczyć się jako lektor języków pracujący freelance?", "a": "Tak -- oferta jest dedykowana samozatrudnionym specjalistom, w tym lektorom i coachom."},
            {"q": "Co jeśli zachoruję w szczycie sezonu?", "a": "Polisa działa niezależnie od pory roku -- świadczenie jest wypłacane za każdy dzień udokumentowanej niezdolności do pracy."},
            {"q": "Ile wynosi składka dla trenera?", "a": "Zależy od wieku i wysokości świadczenia. Przy 200 zł/dzień -- od ok. 100 zł miesięcznie."},
        ],
    },
    "biznes": {
        "subtitle": "Nie ma Cię w biurze -- nie ma wyników. Choroba menedżera to chaos w całym projekcie i utrata przychodów.",
        "risks": [
            {"icon": "🫀", "title": "Choroby sercowo-naczyniowe", "desc": "Wysokie tempo pracy, presja wyników i podróże służbowe zwiększają ryzyko zawału i udaru."},
            {"icon": "🫀", "title": "Choroby sercowo-naczyniowe", "desc": "Menedżerowie i właściciele firm to jedna z grup o najwyższym ryzyku zawału i udaru z powodów zawodowych."},
            {"icon": "🦴", "title": "Choroby kręgosłupa", "desc": "Intensywna praca biurowa, podróże służbowe i siedzący tryb pracy prowadzą do zmian przeciążeniowych."},
        ],
        "income_without": "0 zł (B2B) lub ~80% (etat, po 30 dniach)",
        "income_with": "nawet 600 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje wypalenie zawodowe?", "a": "Wypalenie zawodowe nie jest objęte ochroną. Polisa wypłaca świadczenie przy niezdolności do pracy z tytułu chorób somatycznych i wypadków."},
            {"q": "Czy właściciel spółki może się ubezpieczyć?", "a": "Tak -- polisa obejmuje dochód z pracy zawodowej właściciela, niezależnie od formy prawnej firmy."},
            {"q": "Jaki jest maksymalny okres ochrony?", "a": "Do 24 miesięcy ciągłej niezdolności do pracy -- czas wystarczający na pełną rehabilitację."},
            {"q": "Czy mogę ubezpieczyć kilku pracowników naraz?", "a": "Oferta indywidualna chroni jedną osobę. Dla ubezpieczenia grupowego skontaktuj się z doradcą."},
        ],
    },
    "sztuka": {
        "subtitle": "Fotograf z połamaną ręką, muzyk po operacji ścięgna -- przerwa w pracy twórczej to nie tylko utrata dochodu, ale często utrata klientów na zawsze.",
        "risks": [
            {"icon": "🤚", "title": "Urazy dłoni i kończyn", "desc": "Instrumentaliści, fotografowie i graficy w szczególny sposób polegają na sprawności dłoni."},
            {"icon": "🎤", "title": "Choroby głosu i słuchu", "desc": "Wokaliści, dziennikarze i lektorzy są narażeni na zawodowe uszkodzenie strun głosowych i słuchu."},
            {"icon": "🤒", "title": "Choroby i infekcje", "desc": "Nieregularny tryb pracy, praca w plenerze i podróże służbowe obniżają odporność i zwiększają ryzyko zachorowania."},
        ],
        "income_without": "0 zł (brak zleceń = brak przychodu)",
        "income_with": "nawet 400 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje urazy dłoni muzyka lub fotografa?", "a": "Tak -- niezdolność do pracy wynikająca z urazu kończyn górnych jest objęta ochroną standardową."},
            {"q": "Czy mogę ubezpieczyć się jako freelancer z nieregularnymi dochodami?", "a": "Tak -- podstawą jest udokumentowany średni dochód z ostatnich 12 miesięcy."},
            {"q": "Co z chorobami głosu u dziennikarzy i vlogerów?", "a": "Schorzenia strun głosowych powodujące niezdolność do pracy są objęte ochroną jak każda inna choroba."},
            {"q": "Jak udokumentować dochód jako twórca?", "a": "Wystarczy PIT z poprzedniego roku lub wyciąg z konta potwierdzający wpływy z działalności twórczej."},
        ],
    },
    "bezpieczenstwo": {
        "subtitle": "Praca w służbach mundurowych to codzienne ryzyko urazu. Jedno zdarzenie i zostajesz sam -- bez gwarancji ciągłości wynagrodzenia.",
        "risks": [
            {"icon": "💥", "title": "Urazy podczas interwencji", "desc": "Wypadki służbowe, bójki i interwencje to najczęstsze przyczyny urazów w służbach mundurowych."},
            {"icon": "🤕", "title": "Urazy głowy i kończyn", "desc": "Interwencje fizyczne, pościgi i praca w trudnych warunkach prowadzą do urazów wymagających długiej rehabilitacji."},
            {"icon": "🦴", "title": "Przeciążenia i choroby zawodowe", "desc": "Noszenie ciężkiego ekwipunku, bieganie i praca w ekstremalnych warunkach niszczą stawy i kręgosłup."},
        ],
        "income_without": "~80% podstawy (etat) po 30 dniach; niewystarczające",
        "income_with": "nawet 400 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy polisa obejmuje urazy podczas służby?", "a": "Tak -- niezdolność do pracy wynikająca z urazu, niezależnie od okoliczności, jest objęta ochroną."},
            {"q": "Czy urazy dozwolone w służbie są objęte polisą?", "a": "Tak -- niezdolność do pracy wynikająca z urazu odniesionego podczas wykonywania obowiązków służbowych jest w pełni objęta ochroną."},
            {"q": "Czy pracownik etatowy służb też potrzebuje polisy?", "a": "ZUS pokrywa jedynie część utraconego dochodu. Polisa uzupełnia tę lukę do 80% Twoich realnych zarobków."},
            {"q": "Jak szybko można zawrzeć umowę?", "a": "Wniosek online zajmuje 5 minut. Ochrona startuje po 30-dniowej karencji od zawarcia umowy."},
        ],
    },
    "prawo": {
        "subtitle": "Adwokat bez zdolności do prowadzenia spraw to kancelaria bez przychodów. Jeden miesiąc choroby może kosztować Cię klientów na lata.",
        "risks": [
            {"icon": "🤒", "title": "Choroby przewlekłe i sezonowe", "desc": "Intensywna praca przy aktach, brak ruchu i stres prowadzą do obniżonej odporności i częstych infekcji."},
            {"icon": "🦴", "title": "Choroby kręgosłupa", "desc": "Wielogodzinna praca przy biurku i czytanie akt prowadzą do przeciążeń narządu ruchu."},
            {"icon": "🫀", "title": "Choroby sercowo-naczyniowe", "desc": "Prawnicy są jedną z grup zawodowych o najwyższym poziomie stresu chronicznego -- co przekłada się na zdrowie serca."},
        ],
        "income_without": "0 zł (B2B/kancelaria) lub ~80% (etat, po 30 dniach)",
        "income_with": "nawet 600 zł / dzień niezdolności",
        "faq": [
            {"q": "Czy adwokat na działalności może się ubezpieczyć?", "a": "Tak -- polisa jest dedykowana samozatrudnionym. Adwokat prowadzący kancelarię to jeden z głównych profilów klientów."},
            {"q": "Co z klientami podczas choroby?", "a": "Polisa chroni Twój dochód. Kwestię zastępstwa procesowego rozwiązuj z izbą adwokacką -- to osobny temat."},
            {"q": "Czy radca prawny na etacie też potrzebuje polisy?", "a": "ZUS pokrywa tylko część utraconego dochodu. Polisa uzupełnia lukę -- szczególnie ważne przy wysokich dochodach."},
            {"q": "Jaka jest maksymalna suma ubezpieczenia?", "a": "Do 80% udokumentowanego miesięcznego dochodu netto, maksymalnie 30 000 zł miesięcznie."},
        ],
    },
}

# ── DANE SPECYFICZNE PER ZAWÓD ─────────────────────────────────────────────────
PROFESSION_DATA = {
    "lekarz": {
        "subtitle": "Jeden miesiąc na zwolnieniu to dla lekarza kontraktowego utrata dyżurów, kontraktów i realnych pieniędzy -- bez grosza ze strony NFZ.",
        "meta_desc": "Ubezpieczenie dla lekarza utraty dochodu. Ochrona od 1. dnia choroby, nawet 500 zł/dzień. Dedykowane lekarzom na kontrakcie B2B i NFZ.",
        "income_without": "0 zł (kontrakt B2B -- brak dyżurów = brak przychodu)",
        "income_with": "nawet 500 zł / dzień niezdolności",
    },
    "chirurg": {
        "subtitle": "Chirurg niezdolny do operowania traci wszystkie kontrakty jednocześnie. Jedna kontuzja ręki i cały harmonogram operacyjny pada.",
        "meta_desc": "Ubezpieczenie dla chirurga utraty dochodu. Ochrona zdolności do pracy operacyjnej, dłoni i kontraktów. Nawet 500 zł/dzień.",
        "risks": [
            {"icon": "🤚", "title": "Uraz dłoni operacyjnej", "desc": "Chirurg opiera całą karierę na sprawności dłoni -- jeden uraz wyklucza z zawodu natychmiast."},
            {"icon": "🦠", "title": "Zakażenie podczas operacji", "desc": "Praca z krwią i tkankami naraża na zakażenia krwiopochodne, które mogą wykluczyć z pracy na miesiące."},
            {"icon": "🦴", "title": "Choroby kręgosłupa", "desc": "Wielogodzinne stanie przy stole operacyjnym w pochyleniu prowadzi do poważnych zmian zwyrodnieniowych."},
        ],
    },
    "stomatolog": {
        "subtitle": "Gabinet bez stomatologa nie generuje przychodu. Uraz nadgarstka, infekcja dłoni albo zakażenie zawodowe i klienci szukają innego lekarza.",
        "meta_desc": "Ubezpieczenie dla stomatologa utraty dochodu. Ochrona dłoni, ryzyk zawodowych i kontraktów B2B. Nawet 400 zł/dzień.",
        "risks": [
            {"icon": "🤚", "title": "Uraz dłoni i nadgarstka", "desc": "Mikrourazy podczas precyzyjnych zabiegów mogą wykluczyć z wykonywania zawodu na tygodnie."},
            {"icon": "🦠", "title": "Zakażenie krwiopochodne", "desc": "Kontakt z igłami, wiertłami i materiałem biologicznym to ryzyko ekspozycji na HBV, HCV i HIV."},
            {"icon": "🎧", "title": "Uszkodzenie słuchu", "desc": "Praca z wiertłami stomatologicznymi i ultradźwiękami może prowadzić do trwałego uszkodzenia słuchu."},
        ],
    },
    "pielegniarka": {
        "subtitle": "Pielęgniarka na zwolnieniu to nie tylko problem szpitala -- to Twój problem finansowy. ZUS nie pokryje realnej utraconej kwoty.",
        "meta_desc": "Ubezpieczenie dla pielęgniarki utraty dochodu. Ochrona od zakłucia igłą, urazów kręgosłupa i wypalenia zawodowego. Nawet 350 zł/dzień.",
    },
    "adwokat": {
        "subtitle": "Kancelaria bez Ciebie nie zarabia -- a klienci nie będą czekać. Jeden miesiąc choroby może kosztować Cię relacje, które budowałeś latami.",
        "meta_desc": "Ubezpieczenie dla adwokata utraty dochodu. Ochrona kancelarii B2B, nawet 600 zł/dzień. Wypełnij wniosek online w 5 minut.",
        "income_without": "0 zł (kancelaria bez adwokata nie zarabia)",
        "income_with": "nawet 600 zł / dzień niezdolności",
    },
    "radca-prawny": {
        "subtitle": "Radca prawny bez możliwości pracy to kancelaria bez faktur. Ochrona dochodów, której ZUS nigdy Ci nie zapewni.",
        "meta_desc": "Ubezpieczenie dla radcy prawnego utraty dochodu. Ochrona kancelarii B2B i etatowych, nawet 600 zł/dzień.",
        "income_with": "nawet 600 zł / dzień niezdolności",
    },
    "programista": {
        "subtitle": "Na B2B jedno zdanie brzmi groźniej niż notice period: 'nie wystawiam faktury w tym miesiącu'. Choroba to nie urlop -- to brak wypłaty.",
        "meta_desc": "Ubezpieczenie dla programisty utraty dochodu. Ochrona B2B, burnout, cieśń nadgarstka i RSI. Nawet 600 zł/dzień.",
        "income_without": "0 zł (B2B -- brak faktury = brak przychodu)",
        "income_with": "nawet 600 zł / dzień niezdolności",
    },
    "developer": {
        "subtitle": "Sprint bez dewelopera kończy się długiem technicznym i sprintem bez faktury. Choroba na B2B kosztuje podwójnie.",
        "meta_desc": "Ubezpieczenie dla developera utraty dochodu. Ochrona kontraktów B2B, burnout i RSI. Nawet 600 zł/dzień.",
    },
    "fizjoterapeuta": {
        "subtitle": "Fizjoterapeuta z urazem ręki nie może leczyć -- i nie może zarabiać. Paradoks zawodowy, który polisa rozwiązuje.",
        "meta_desc": "Ubezpieczenie dla fizjoterapeuty utraty dochodu. Ochrona od urazów, chorób dłoni i wypalenia. Nawet 350 zł/dzień.",
        "risks": [
            {"icon": "🤚", "title": "Urazy dłoni i nadgarstka", "desc": "Manualna praca terapeutyczna przez wiele godzin dziennie prowadzi do przeciążeń i stanów zapalnych."},
            {"icon": "🦴", "title": "Choroby kręgosłupa", "desc": "Asystowanie pacjentom i praca w wymuszonej pozycji to typowe ryzyko zawodowe fizjoterapeutów."},
            {"icon": "🤒", "title": "Zakażenia od pacjentów", "desc": "Bezpośredni kontakt fizyczny z pacjentami podczas terapii to ryzyko przeniesienia chorób zakaźnych."},
        ],
    },
    "psycholog": {
        "subtitle": "Psycholog na zwolnieniu nie może przyjmować pacjentów. Przerwa w pracy to natychmiastowe straty i ryzyko utraty stałych klientów.",
        "meta_desc": "Ubezpieczenie dla psychologa utraty dochodu. Ochrona prywatnej praktyki, burnout i B2B. Nawet 400 zł/dzień.",
        "risks": [
            {"icon": "🤒", "title": "Choroby układu nerwowego", "desc": "Intensywna praca umysłowa i emocjonalna zwiększa ryzyko chorób neurologicznych wymagających dłuższego leczenia."},
            {"icon": "🦴", "title": "Przeciążenia kręgosłupa", "desc": "Wielogodzinna praca siedząca w jednej pozycji prowadzi do zmian przeciążeniowych kręgosłupa."},
            {"icon": "🦴", "title": "Choroby kręgosłupa", "desc": "Wiele godzin dziennie w fotelu terapeutycznym w jednej pozycji to ryzyko przeciążeń kręgosłupa."},
        ],
    },
    "fryzjer": {
        "subtitle": "Twoje ręce to jedyne narzędzie pracy. Alergia na farbę, złamany palec albo stan zapalny ścięgna -- i fotel pustoszeje.",
        "meta_desc": "Ubezpieczenie dla fryzjera utraty dochodu. Ochrona alergii zawodowych, urazów dłoni i przerwy w pracy. Od 80 zł/mies.",
        "income_without": "0 zł (salon bez fryzjera nie zarabia)",
        "income_with": "nawet 300 zł / dzień niezdolności",
    },
    "kosmetyczka": {
        "subtitle": "Każde opuszczone okienko zabiegowe to strata. Alergia na preparaty, uraz nadgarstka i grafik jest pusty -- a czynsz zostaje.",
        "meta_desc": "Ubezpieczenie dla kosmetyczki utraty dochodu. Ochrona alergii, urazów i przerwy w działalności. Od 80 zł/mies.",
    },
    "ksiegowy": {
        "subtitle": "Termin VAT, zamknięcie miesiąca, rozliczenia roczne -- to nie czeka. Ale choroba też nie pyta o termin.",
        "meta_desc": "Ubezpieczenie dla księgowego utraty dochodu. Ochrona samozatrudnionych i biur rachunkowych. Nawet 500 zł/dzień.",
    },
    "elektryk": {
        "subtitle": "Jedno porażenie, upadek z drabiny albo złamanie -- i tygodnie bez zleceń. Na budowie nikt Ci ochrony nie zagwarantuje.",
        "meta_desc": "Ubezpieczenie dla elektryka utraty dochodu. Ochrona wypadków, urazów i przerwy w zleceniach. Nawet 400 zł/dzień.",
        "risks": [
            {"icon": "⚡", "title": "Porażenie prądem", "desc": "Elektricy pracują w warunkach stałego ryzyka porażenia, które może prowadzić do długiej niezdolności do pracy."},
            {"icon": "🪜", "title": "Upadek z wysokości", "desc": "Praca na drabinach, rusztowaniach i w szybach windowych to jedno z najwyższych ryzyk urazów."},
            {"icon": "🦴", "title": "Urazy mechaniczne", "desc": "Praca w ciasnych przestrzeniach, dźwiganie i montaż instalacji to częste przyczyny urazów kręgosłupa i kończyn."},
        ],
    },
    "kierowca-zawodowy": {
        "subtitle": "Kierowca bez zdolności do prowadzenia to tir stojący w bazie i kontrakt wypowiedziany z dnia na dzień.",
        "meta_desc": "Ubezpieczenie dla kierowcy zawodowego utraty dochodu. Ochrona utraty uprawnień, chorób i wypadków. Nawet 350 zł/dzień.",
    },
    "taksowkarz": {
        "subtitle": "Każda godzina poza kierownicą to stracona kwota. Na Uberze czy w korporacji -- choroba nie generuje zlecenia.",
        "meta_desc": "Ubezpieczenie dla taksówkarza utraty dochodu. Ochrona samozatrudnionych kierowców platform Uber i Bolt. Od 100 zł/mies.",
    },
    "kurier": {
        "subtitle": "Paczka czeka, a Ty na zwolnieniu. Kurier bez możliwości jazdy to brak wypłaty od pierwszego dnia -- bez wyjątku.",
        "meta_desc": "Ubezpieczenie dla kuriera utraty dochodu. Ochrona samozatrudnionych, wypadki, urazy kręgosłupa. Od 100 zł/mies.",
    },
    "fotograf": {
        "subtitle": "Ślub, sesja, reportaż -- i złamana ręka. Zlecenie przepada, klient odchodzi, a faktura zostaje nieopłacona.",
        "meta_desc": "Ubezpieczenie dla fotografa utraty dochodu. Ochrona zleceń, urazów dłoni i przerwy w działalności twórczej.",
    },
    "nauczyciel": {
        "subtitle": "Nauczyciel bez głosu nie poprowadzi lekcji. Choroba krtani, angina czy wypalenie zawodowe -- i cały plan zajęć pada.",
        "meta_desc": "Ubezpieczenie dla nauczyciela utraty dochodu. Ochrona chorób głosu, wypalenia i przerw w pracy dydaktycznej.",
    },
    "trener-personalny": {
        "subtitle": "Trener po kontuzji to trener bez klientów. W tej branży nie istnieje 'praca zdalna' -- musisz być fizycznie sprawny.",
        "meta_desc": "Ubezpieczenie dla trenera personalnego utraty dochodu. Ochrona kontuzji, urazów i przerwy w sesjach treningowych.",
        "risks": [
            {"icon": "🏋️", "title": "Kontuzje podczas demonstracji", "desc": "Trenerzy regularnie demonstrują ćwiczenia -- to naraża ich na te same urazy, co ich podopiecznych."},
            {"icon": "🦴", "title": "Przeciążenia stawów i mięśni", "desc": "Intensywna aktywność fizyczna przez całe zawodowe życie kumuluje mikrourazy prowadzące do chronicznego bólu."},
            {"icon": "🤒", "title": "Choroby i infekcje", "desc": "Praca w siłowniach i kontakt z wieloma klientami dziennie to stałe narażenie na choroby zakaźne."},
        ],
    },
    "architekt": {
        "subtitle": "Projekt architektoniczny nie czeka na powrót ze zwolnienia -- a termin oddania jest w umowie. Choroba to niewykonany kontrakt.",
        "meta_desc": "Ubezpieczenie dla architekta utraty dochodu. Ochrona samozatrudnionych i pracowni projektowych. Nawet 500 zł/dzień.",
    },
    "pilot": {
        "subtitle": "Jedno badanie lotnicze z negatywnym wynikiem i nie możesz wsiąść za stery. Utrata orzeczenia medycznego to utrata zawodu.",
        "meta_desc": "Ubezpieczenie dla pilota utraty dochodu. Ochrona utraty orzeczenia lotniczego i niezdolności do wykonywania zawodu.",
        "risks": [
            {"icon": "📋", "title": "Utrata orzeczenia medycznego", "desc": "Każda choroba wpływająca na wyniki badania lotniczego może skutkować zawieszeniem uprawnień do latania."},
            {"icon": "😴", "title": "Zaburzenia snu i rytmu dobowego", "desc": "Zmiany stref czasowych, nocne loty i nieregularny tryb pracy niszczą zdrowie w długim terminie."},
            {"icon": "🧠", "title": "Stres i presja operacyjna", "desc": "Odpowiedzialność za setki pasażerów i konieczność perfekcyjnej sprawności to ekstremalny stres zawodowy."},
        ],
    },
}

# ── HTML TEMPLATE ─────────────────────────────────────────────────────────────
HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <meta name="description" content="{meta_desc}">
  <link rel="canonical" href="https://utratadochodu.pl/{slug}/">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>body {{ font-family: 'Inter', sans-serif; }}</style>
  <script type="application/ld+json">
{jsonld}
  </script>
</head>
<body class="bg-white text-slate-800">

  <!-- NAWIGACJA -->
  <nav class="bg-blue-700 text-white px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-lg">
    <a href="/" class="font-bold text-xl tracking-tight">UtrataDochodu.pl</a>
    <a href="/formularz.html" class="bg-white text-blue-700 font-semibold px-4 py-2 rounded-lg text-sm hover:bg-blue-50 transition">Wypełnij wniosek</a>
  </nav>

  <!-- HERO -->
  <section class="relative min-h-[480px] flex items-center"
           style="background: url('/img/professions/{category}.jpg') center/cover no-repeat;">
    <div class="absolute inset-0 bg-slate-900/70"></div>
    <div class="relative z-10 max-w-4xl mx-auto px-6 py-20 text-white">
      <p class="text-sm text-blue-300 mb-3 font-semibold uppercase tracking-widest">Ubezpieczenie utraty dochodu</p>
      <h1 class="text-4xl md:text-5xl font-extrabold mb-5 leading-tight">{h1}</h1>
      <p class="text-xl text-slate-200 mb-8 max-w-2xl leading-relaxed">{subtitle}</p>
      <a href="/formularz.html"
         class="inline-block bg-blue-500 hover:bg-blue-400 text-white font-bold px-8 py-4 rounded-xl text-lg transition shadow-lg">
        Sprawdź składkę &rarr;
      </a>
    </div>
  </section>

  <!-- BREADCRUMB -->
  <div class="bg-slate-50 border-b border-slate-100 py-3 px-6 text-sm text-slate-500">
    <div class="max-w-4xl mx-auto">
      <a href="/" class="hover:text-blue-600 transition">Strona główna</a>
      <span class="mx-2">&rsaquo;</span>
      <span class="text-slate-700 font-medium">{name_pl}</span>
    </div>
  </div>

  <!-- RYZYKA -->
  <section class="py-16 bg-white">
    <div class="max-w-4xl mx-auto px-6">
      <h2 class="text-3xl font-bold text-slate-800 mb-3">Ryzyka zawodowe -- {name_pl}</h2>
      <p class="text-slate-500 mb-10 text-lg">Na co najczęściej narażeni są przedstawiciele tego zawodu?</p>
      <div class="grid md:grid-cols-3 gap-6">
{risks_html}
      </div>
    </div>
  </section>

  <!-- PORÓWNANIE -->
  <section class="py-16 bg-slate-50">
    <div class="max-w-4xl mx-auto px-6">
      <h2 class="text-3xl font-bold text-slate-800 mb-10 text-center">Co się stanie, gdy zachorujesz?</h2>
      <div class="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
        <div class="bg-white border-2 border-red-100 rounded-2xl p-8 shadow-sm">
          <div class="text-red-500 font-bold text-lg mb-4">&#10060; Bez polisy</div>
          <div class="text-2xl font-extrabold text-red-600 mb-3">{income_without}</div>
          <p class="text-slate-500 text-sm leading-relaxed">ZUS pokryje jedynie ~80% podstawy wymiaru -- i to dopiero po 30. dniu. Na B2B: zero złotych od pierwszego dnia.</p>
        </div>
        <div class="bg-white border-2 border-green-200 rounded-2xl p-8 shadow-sm">
          <div class="text-green-600 font-bold text-lg mb-4">&#9989; Z polisą UtrataDochodu</div>
          <div class="text-2xl font-extrabold text-green-700 mb-3">{income_with}</div>
          <p class="text-slate-500 text-sm leading-relaxed">Świadczenie dzienne od 1. dnia niezdolności, wypłacane co miesiąc bezpośrednio na Twoje konto.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="py-16 bg-white">
    <div class="max-w-3xl mx-auto px-6">
      <h2 class="text-3xl font-bold text-slate-800 mb-10">Najczęstsze pytania -- {name_pl}</h2>
      <div class="space-y-3">
{faq_html}
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="py-20 bg-blue-700 text-white text-center">
    <div class="max-w-2xl mx-auto px-6">
      <h2 class="text-3xl font-bold mb-4">Zabezpiecz dochody jako {name_pl}</h2>
      <p class="text-blue-100 mb-8 text-lg">Wypełnij wniosek online w 5 minut. Bez wychodzenia z domu.</p>
      <a href="/formularz.html"
         class="inline-block bg-white text-blue-700 font-bold px-10 py-4 rounded-xl text-lg hover:bg-blue-50 transition shadow-lg">
        Wypełnij wniosek teraz &rarr;
      </a>
    </div>
  </section>

  <!-- WSZYSTKIE ZAWODY -->
  <section class="bg-slate-100 py-10">
    <div class="max-w-6xl mx-auto px-6">
      <h2 class="text-base font-bold text-slate-600 uppercase tracking-wider mb-5 text-center">
        Ubezpieczenie utraty dochodu &mdash; wszystkie zawody
      </h2>
      <div class="flex flex-wrap gap-2 justify-center">
        {profession_links}
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="bg-slate-900 text-slate-400 py-8 text-center text-sm">
    <div class="max-w-4xl mx-auto px-6">
      <p class="mb-2">
        <a href="/" class="text-white font-semibold">UtrataDochodu.pl</a>
        &nbsp;&mdash;&nbsp;ubezpieczenie utraty dochodu dla samozatrudnionych i specjalistów
      </p>
      <p>&copy; {year} Aura Expert Sp. z o.o. &nbsp;|&nbsp;
        <a href="/polityka-prywatnosci.html" class="hover:text-white transition">Polityka prywatności</a>
      </p>
    </div>
  </footer>

</body>
</html>
"""


def build_risk_card(risk):
    return (
        '        <div class="bg-slate-50 rounded-xl p-6 border border-slate-100 hover:shadow-md transition">\n'
        f'          <div class="text-4xl mb-4">{risk["icon"]}</div>\n'
        f'          <h3 class="font-bold text-slate-800 mb-2">{escape(risk["title"])}</h3>\n'
        f'          <p class="text-slate-500 text-sm leading-relaxed">{escape(risk["desc"])}</p>\n'
        '        </div>'
    )


def build_faq_item(item):
    return (
        '        <details class="border border-slate-200 rounded-xl overflow-hidden">\n'
        '          <summary class="px-6 py-5 font-semibold text-slate-800 cursor-pointer hover:bg-slate-50 '
        'list-none flex justify-between items-center">\n'
        f'            {escape(item["q"])}\n'
        '            <span class="text-blue-600 ml-4 text-xl font-light select-none">+</span>\n'
        '          </summary>\n'
        '          <div class="px-6 py-5 text-slate-600 border-t border-slate-100 bg-slate-50 leading-relaxed">\n'
        f'            {escape(item["a"])}\n'
        '          </div>\n'
        '        </details>'
    )


def build_jsonld(slug, name_pl, meta_desc, year):
    data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Strona główna", "item": "https://utratadochodu.pl"},
                    {"@type": "ListItem", "position": 2, "name": name_pl, "item": f"https://utratadochodu.pl/{slug}/"},
                ],
            },
            {
                "@type": "WebPage",
                "name": f"Ubezpieczenie dla {name_pl} | Utrata Dochodu",
                "description": meta_desc,
                "url": f"https://utratadochodu.pl/{slug}/",
                "publisher": {
                    "@type": "Organization",
                    "name": "UtrataDochodu.pl",
                    "url": "https://utratadochodu.pl",
                },
            },
        ],
    }
    return json.dumps(data, ensure_ascii=False, indent=2)


def get_data(slug, name_pl, category):
    cat = CATEGORY_DEFAULTS.get(category, CATEGORY_DEFAULTS["biznes"])
    ov = PROFESSION_DATA.get(slug, {})
    meta_default = (
        f"Ubezpieczenie utraty dochodu dla zawodu {name_pl}. "
        "Ochrona od 1. dnia niezdolności do pracy. Wypełnij wniosek online na utratadochodu.pl."
    )
    return {
        "subtitle":       ov.get("subtitle",       cat["subtitle"]),
        "risks":          ov.get("risks",           cat["risks"]),
        "income_without": ov.get("income_without",  cat["income_without"]),
        "income_with":    ov.get("income_with",     cat["income_with"]),
        "faq":            ov.get("faq",             cat["faq"]),
        "meta_desc":      ov.get("meta_desc",       meta_default),
    }


def build_profession_links(current_slug):
    links = []
    for s, n, _ in PROFESSIONS:
        if s == current_slug:
            links.append(
                f'<span class="text-sm px-3 py-1 bg-blue-600 text-white rounded-full font-semibold">{escape(n)}</span>'
            )
        else:
            links.append(
                f'<a href="/{s}/" class="text-sm px-3 py-1 bg-white border border-slate-200 text-blue-700 rounded-full hover:bg-blue-50 transition">{escape(n)}</a>'
            )
    return "\n        ".join(links)


def render_page(slug, name_pl, category, out_dir):
    today = date.today()
    data = get_data(slug, name_pl, category)

    risks_html = "\n".join(build_risk_card(r) for r in data["risks"])
    faq_html = "\n".join(build_faq_item(f) for f in data["faq"])
    jsonld = build_jsonld(slug, name_pl, data["meta_desc"], today.year)
    profession_links = build_profession_links(slug)

    html = HTML_TEMPLATE.format(
        title=f"Ubezpieczenie dla {name_pl} | Utrata Dochodu",
        meta_desc=escape(data["meta_desc"]),
        slug=slug,
        category=category,
        h1=f"Ubezpieczenie dla {escape(name_pl)} na wypadek utraty dochodu",
        subtitle=escape(data["subtitle"]),
        name_pl=escape(name_pl),
        risks_html=risks_html,
        income_without=escape(data["income_without"]),
        income_with=escape(data["income_with"]),
        faq_html=faq_html,
        jsonld=jsonld,
        year=today.year,
        profession_links=profession_links,
    )

    folder = os.path.join(out_dir, slug)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)


def render_sitemap(slugs, out_dir):
    today = date.today().isoformat()
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for slug in slugs:
        lines.append(
            f"  <url><loc>https://utratadochodu.pl/{slug}/</loc>"
            f"<lastmod>{today}</lastmod><changefreq>monthly</changefreq>"
            f"<priority>0.7</priority></url>"
        )
    lines.append("</urlset>")
    path = os.path.join(out_dir, "sitemap_professions.xml")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  sitemap_professions.xml ({len(slugs)} URL-i)")


def main():
    parser = argparse.ArgumentParser(description="Generator stron zawodowych UtrataDochodu.pl")
    parser.add_argument("--out", default="./dist", help="Katalog wyjściowy (domyślnie: ./dist)")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    total = len(PROFESSIONS)
    for i, (slug, name_pl, category) in enumerate(PROFESSIONS, 1):
        render_page(slug, name_pl, category, args.out)
        print(f"[{i:3}/{total}] {slug}")

    render_sitemap([s for s, _, _ in PROFESSIONS], args.out)
    print(f"\nGotowe! {total} stron w katalogu: {args.out}")


if __name__ == "__main__":
    main()
