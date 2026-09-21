# Fejlesztési Ötletek és Roadmap

## Következő Lépések
1. **[B] Könyvelői Integrációk (Folyamatban)**
   - Exportálás specifikus könyvelőprogramoknak (RLB-60 elsőként).
   - "Szállító" (bejövő) számlák CSV formátuma az RLB fix struktúrája alapján.

2. **[C] Csoportos munka és jogosultságok (Kkv fókusz)**
   - `Organization` modell bevezetése.
   - `Roles`: Admin (Cégvezető), Uploader (Alkalmazott), Viewer (Könyvelő).
   - Az alkalmazottak csak a saját maguk által lefotózott blokkokat látják, a vezetőség egyben az egészet.

3. **"Villanyszerelő Józsi" Funkciók (Maximális UX egyszerűsítés)**
   - **Hangalapú Diktálás:** Mikrofon gomb az alkalmazásban. A felhasználó bediktálja a számla paramétereit (Kinek, hova, mit csinált, mennyiért), a Gemini AI pedig azonnal strukturált számla adattá (JSON) és E-számlává alakítja gépelés nélkül.
   - **Okos Címtár (Partner Memória):** Elég csak egy nevet bemondani ("Kovács Kft"), a rendszer a korábbi számlák vagy a Számlázz.hu partner adatbázis alapján kitölti az adószámot és címet.

## Haladó Fejlesztések (Vízió)
- **[E] NAV Online Számla Közvetlen Bekötés:** Bejövő számlák automatikus szinkronizálása a NAV rendszereiből. A felhasználónak csak azokat a blokkokat kell befotóznia, amelyek nincsenek a NAV rendszerében (külföldi, ÁFA mentes kisnyugta stb.).
- **Dedikált Bejövő Email Fiók:** (pl. `szamla@cegem.szamlazzjol.hu`) Ahova a szolgáltatók (Telekom, Google) küldik a PDF-et, a rendszer pedig automatikusan behúzza, feldolgozza és listázza jóváhagyásra.
- **Kategorizáció & Analitika:** Költségek automatikus felcímkézése (Marketing, Rezsi, Utazás) és vizuális Dashboard megjelenítése.

