# ADATKEZELÉSI ÉS SÜTI (COOKIE) TÁJÉKOZTATÓ (GDPR)

**Hatálybalépés dátuma: 2026. [Hónap] [Nap].**

A **[Cégnév / Egyéni Vállalkozó neve]** (székhely: [Székhely], adószám: [Adószám], email: [Kapcsolat Email]), mint **Adatkezelő** elkötelezett a Felhasználók személyes adatainak védelme iránt. Mivel szolgáltatásunk (a **Szoftver**) kifejezetten B2B (vállalkozási) célú, a kezelt személyes adatok jellemzően a vállalkozók kapcsolattartási adatait, valamint a feltöltött dokumentumokon (számlákon) szereplő esetleges személyes adatokat érintik.

## 1. Milyen adatokat kezelünk, és miért?

**1.1. Regisztrációs és fiók adatok**
* **Kezelt adatok:** E-mail cím, titkosított jelszó (hashed password).
* **Adatkezelés célja:** A Szoftverbe történő bejelentkezés biztosítása, fiók azonosítása.
* **Jogalap:** Szerződés teljesítése (GDPR 6. cikk (1) bek. b) pont).

**1.2. Számlázási adatok és Kreditek (Stripe)**
* **Kezelt adatok:** Számlázási név, cím, adószám, bankkártya adatok (melyeket közvetlenül a Stripe kezel, a mi szerverünkre nem jutnak el).
* **Adatkezelés célja:** Pénzügyi tranzakciók lebonyolítása, számlakiállítás a kreditvásárlásról.
* **Jogalap:** Jogi kötelezettség teljesítése (Számviteli tv.) és szerződés teljesítése.

**1.3. Integrációs API Kulcsok**
* **Kezelt adatok:** Számlázz.hu API kulcs, NAV technikai felhasználó adatok (opcionális).
* **Adatkezelés célja:** A Felhasználó utasítására számlák kiállítása a külső rendszerekben.
* **Jogalap:** Szerződés teljesítése.

**1.4. Feltöltött képek (Számlák/Blokkok) és Szöveges promptok**
* **Kezelt adatok:** A feltöltött képfájlok (MinIO storage) és az azokból/szövegből kinyert JSON adatok. Ezek tartalmazhatják a Felhasználó partnereinek (vevőinek) adatait is. 
* **Figyelem:** Ezen adatok tekintetében a **Felhasználó minősül Adatkezelőnek**, a mi Szoftverünk csupán **Adatfeldolgozóként** (Data Processor) jár el! A Felhasználó felelőssége, hogy ügyfelei adatait jogszerűen töltse fel a rendszerbe.
* **Adatkezelés célja:** OCR szövegfelismerés és strukturált adatok előállítása a szolgáltatás nyújtásához.

## 2. Kik az Adatfeldolgozóink? (Harmadik felek)
A Szoftver működéséhez az alábbi megbízható technológiai partnereket használjuk, akik felé adattovábbítás történik:
1. **Google LLC. (Google Gemini API):** Mesterséges intelligencia szolgáltató. A feltöltött képek és szövegek elemzését végzi. A Google az adatokat nem használja fel saját modelljei tanítására (Enterprise API feltételek szerint). Adatközpont: EU/USA.
2. **Stripe Inc.:** Fizetési szolgáltató. Biztonságos bankkártyás fizetés feldolgozása.
3. **[Tárhelyszolgáltatód neve, pl. Hetzner / AWS / Contabo]:** A PostgreSQL adatbázis és a MinIO objektumtároló fizikai szervereinek üzemeltetője (EU adatközpont).

## 3. SÜTIK (COOKIES) ÉS MARKETING

**3.1. Alapvető (Technikai) Sütik**
A webalkalmazás működéséhez elengedhetetlen technikai tárolókat (pl. HTML5 LocalStorage `szamla_ai_token`) használunk a bejelentkezési munkamenet fenntartására. Ezek használatához a jogszabályok értelmében nem szükséges előzetes hozzájárulás, mivel a szolgáltatás nyújtásához elengedhetetlenek.

**3.2. Marketing és Analitikai Sütik (Google Ads & Analytics)**
Weboldalunk látogatottságának elemzéséhez (Google Analytics) és célzott hirdetések megjelenítéséhez (Google Ads) harmadik féltől származó sütiket használunk.
* Ezen sütik **kizárólag a Felhasználó kifejezett, önkéntes hozzájárulása (Cookie Banner / Hozzájárulási ablak)** esetén kerülnek elhelyezésre az eszközön (Google Consent Mode v2 kompatibilis módon).
* Ha a Felhasználó az ablakban elutasítja a marketing sütiket, a weboldal alapvető funkciói és a Szoftver továbbra is zavartalanul használhatók maradnak, a Google felé mérési adat nem kerül továbbításra.

## 4. Felhasználói Jogok
A Felhasználó jogosult:
* Tájékoztatást kérni adatai kezeléséről,
* Helyesbítést kérni,
* Adatai törlését kérni (a számviteli bizonylatokra vonatkozó megőrzési idő kivételével),
* Adathordozhatóságot kérni (pl. export funkciók a Szoftverben).

Kérdés vagy adattörlési igény esetén lépjen velünk kapcsolatba a **[Kapcsolat Email]** címen!

---
*Készült a Számlázó AI automatikus jogi generátora segítségével.*

