# 🛡️ Coolify Stack Audit & EV-Biztos Micro-SaaS Mesterterv

> **Dokumentum:** `plans/BIZTONSAGOS_EV_SAAS_MASTERPLAN.md`  
> **Dátum:** 2026. szeptember 23.  
> **Szerver:** Netcup VPS (4 vCPU, 8 GB RAM, 160 GB SSD) — Coolify PaaS felügyelettel (`netcup_szerver`)  
> **Státusz:** Hivatalos Egyéni Vállalkozói (EV) jogi kockázatminimalizálás + Többtermékes (Multi-SaaS) architektúra

---

## 📸 1. A Jelenlegi Coolify Stack Elemzése (A Képernyőkép Alapján)

A Coolify felületeden jelenleg **6 aktív szolgáltatás** fut zölden (`Running`):

```
┌───────────────────────────────────┬─────────────┬─────────────────┬──────────────────────┐
│ Szolgáltatás Neve                 │ Típus       │ Becsült RAM     │ Szerepe a rendszerben│
├───────────────────────────────────┼─────────────┼─────────────────┼──────────────────────┤
│ 1. metabase-tdaeph96gpew2x5...    │ Service     │ ~ 650 – 850 MB  │ Java/JVM BI analitika│
│ 2. minio                          │ Service     │ ~ 150 – 200 MB  │ Helyi S3 képtároló   │
│ 3. postgre                        │ Database    │ ~ 800 – 1100 MB │ Központi adatbázis   │
│ 4. szamlazo_backend               │ Application │ ~ 200 – 300 MB  │ Hono Node.js API     │
│ 5. szamlazo_frontend              │ Application │ ~ 100 – 150 MB  │ Astro SSR felület    │
│ 6. umami-qdecuydia6m5xktz5...     │ Service     │ ~ 150 – 200 MB  │ Webforgalom elemző   │
│ + Coolify Core & Traefik Engine   │ System      │ ~ 400 – 500 MB  │ Reverse proxy, SSL   │
├───────────────────────────────────┴─────────────┼─────────────────┼──────────────────────┤
│ ÖSSZESEN HASZNÁLT MEMÓRIA JELENLEG:             │ ~ 2.5 – 3.3 GB  │                      │
│ SZABADON ELÉRHETŐ MEMÓRIA ÚJ SAAS-OKRA:         │ ~ 4.7 – 5.5 GB  │ (Több mint 60%!)     │
│ SZABAD LEMEZTERÜLET (160 GB SSD-ből):           │ ~ 110+ GB       │                      │
└─────────────────────────────────────────────────┴─────────────────┴──────────────────────┘
```

### 💡 Technikai Észrevételek a futó szolgáltatásokról:
1. **A Metabase jelenléte:** A Metabase zseniális BI dashboard, de mivel **Java JVM alapú**, ez a szervered leginkább memória-éhes komponense (~750 MB). Ha még több új SaaS-t teszel a szerverre, érdemes a Coolify-ban a Metabase környezeti változói közé felvenni: `JAVA_OPTS: "-Xmx512m"` (hogy 512 MB-nál maximalizálja a heap méretét).
2. **Közös infrastruktúra aranybánya:** A `postgre`, a `minio`, az `umami` és a `metabase` már fut! Ez azt jelenti, hogy **bármilyen új SaaS-t építesz, NEM kell új adatbázist vagy képtárolót felhúznod**. Csak egy új adatbázis-sémát csinálsz a meglévő PostgreSQL-ben, és egy új bucketot a meglévő MinIO-ban. Az új appjaid szerverigénye szinte nulla lesz!
3. **Teszt domainek (`sslip.io`):** A backend és frontend jelenleg ideiglenes `*.sslip.io` aldomaineken fut. Élesítés előtt a Coolify-ban saját domainre kell állítani (`api.teceged.hu`, `app.teceged.hu`), amit a Traefik automatikusan ingyen SSL-lel (HTTPS) fog ellátni.

---

## 🛑 2. A Jelenlegi Számla AI Jogbiztonsági Átszabása (EV Védelmi Vonal)

Mivel **hivatalos Egyéni Vállalkozó vagy, a teljes magánvagyonoddal felelsz**. Ezért a jelenlegi alkalmazást úgy kell átalakítani, hogy **zéró jogi felelősséged legyen a számlák valódiságáért és a NAV megfelelésért**.

### Mit kell módosítani a kódban és a felületen?

#### 1. Átpozicionálás és Névcsere (Termékkategória védelem)
* ❌ **KERÜLENDŐ:** „Számlázó AI”, „Online Számlázóprogram”, „NAV számlázó”.
*  **ALKALMAZANDÓ:** **„Számla AI — Bizonylat-digitalizáló és Költségrendező Kiegészítő a Számlázz.hu-hoz”** (Nemzetközi példák: Dext, Hubdoc, Rossum — egyik sem számlázó, mégis dollármilliókat keresnek).
* **A jogi státusz:** Adminisztrációs OCR előkészítő szoftver, nem számlázóprogram (így nem vonatkozik rá a 23/2014. NGM rendelet megfelelőségi kötelezettsége).

#### 2. A Split-View Szerkesztő és Kiállítás Gomb ([`SplitViewModal.astro`](file:///d:/github/szamlazo-app/frontend/src/components/modals/SplitViewModal.astro))
* A felhasználó nem a te szoftvereden keresztül számláz, hanem a Számlázz.hu Agent API-ját hívja a saját fiókjával.
* **Módosítás a gombon:**  
  A *"Számla kiállítása"* helyett:  
  👉 **„Piszkozat átadása a Számlázz.hu fiókomnak”**.
* **Kötelező felelősségi jelölőnégyzet (Checkbox) a gomb felett:**  
  `[x] Kijelentem, hogy az AI által kinyert adatokat és összegeket ellenőriztem, a számla kiállítását a Számlázz.hu rendszerében jóváhagyom.`  
  *(A gomb csak akkor váljon kattinthatóvá, ha a felhasználó ezt bepipálta! Ez bírósági szinten védi ki a te felelősségedet).*

#### 3. A közvetlen NAV Számlabeküldés TÖRLÉSE a tervekből
* **A NAV Online Számla 3.0 adatszolgáltatást 100%-ban végezze el a Számlázz.hu!**
* Te soha ne hozz létre önálló számlasorszámot, és a te szervered ne küldjön közvetlen számlabeküldő XML-t a NAV-nak. A Számlázz.hu erre garanciát vállal, te pedig a Számlázz.hu Agent védőernyője alatt maradsz.

#### 4. Az ÁSZF ([`plans/ASZF.md`](file:///d:/github/szamlazo-app/plans/ASZF.md)) Frissítése
* Az ÁSZF-ben vastag betűvel rögzíteni:  
  *„A Szolgáltató nem számlázóprogramot üzemeltet, hanem dokumentum-digitalizáló és előkészítő szoftvert. A számlakibocsátást, sorszámozást és a hatósági (NAV) adatszolgáltatást a Felhasználó által beállított hivatalos számlázási szolgáltató (Számlázz.hu) végzi. A Felhasználó köteles az OCR által felismert adatokat jóváhagyás előtt ellenőrizni.”*

---

## 🚀 3. Milyen ÚJ SaaS Projektek Férnek El a Netcup Szerveren? (Ahol könnyebb pénzt keresni)

Mivel van még **~5 GB szabad RAM-od és 110 GB SSD-d**, a meglévő PostgreSQL, MinIO és Umami mellé **további 2-3 független SaaS projektet is gond nélkül elindíthatsz ugyanazon a Coolify-on**.

Íme a két legmagasabb profitpotenciálú, **zéró NAV kockázatú** ötlet:

---

### 🥇 1. PROJEKT: MesterMunkalap & SzervizFlow PWA (Terepi Munkalap Szakembereknek)
> **Miért ebben van a leggyorsabb pénz?**  
> A magyar szakemberek (klímások, villanyszerelők, gázkazán-szerelők, autószerelők, redőnyösök) jól keresnek, de utálják a papírmunkát. A megrendelőik azonnali árajánlatot és garanciális igazolást várnak.

* **Miért 0 jogi kockázat?**  
  A munkalap **NEM adóügyi bizonylat**, hanem műszaki teljesítésigazolás! Nincs NAV, nincs számviteli bírság.
* **Hogyan épül fel a meglévő elemeidből?**
  1. **Mobil PWA:** A meglévő Astro + DaisyUI frontenddel.
  2. **Hangalapú tétel-diktálás:** A meglévő [`voice.ts`](file:///d:/github/szamlazo-app/frontend/src/scripts/voice.ts) modullal a szaki a létra tetején bemondja: *"4 méter rézcső, 1 db fali konzol, 2 óra munkadíj"*.
  3. **Fotók a MinIO-ba:** Munka előtti és utáni fotók feltöltése a meglévő MinIO tárolódba.
  4. **Érintőképernyős Aláírás:** A megrendelő a helyszínen a telefon kijelzőjén ujjal aláírja a munkalapot (HTML5 Canvas).
  5. **1-Kattintásos PDF:** A Gotenberg vagy Weasyprint motor legenerál egy profi, céges fejléces munkalap PDF-et, ami automatikusan kimegy az ügyfél emailjére.
  6. **Számla (Opcionális):** Ha a szaki akarja, a meglévő Számlázz.hu integrációddal a munkalap lezárásakor generálhat egy díjbekérőt vagy számlát.
* **Üzleti modell:** 4.900 – 7.900 Ft / hó / mester.  
  *Ha 30 klímás vagy villanyszerelő előfizet rá szakmai Facebook csoportokból, az havi 150.000 – 240.000 Ft tiszta bevétel!*
* **Szerverigény a Coolify-ban:** +200 MB RAM (ugyanaz a Postgres és MinIO!).

---

### 🥈 2. PROJEKT: B2B Webshop Beszállítói Feed & Ár-Készlet Szinkronizáló (FeedSync)
> **Miért imádják a webshoposok?**  
> Magyarországon több mint 10 000 webáruház működik Unas, Shoprenter és WooCommerce motoron. A legtöbbnek 2-5 nagykereskedő beszállítója van, akik minden reggel küldenek egy 5 000 soros CSV vagy XML fájlt az aktuális raktárkészletről és beszerzési árakról. A webshop tulajdonosok kézzel vagy drága egyedi fejlesztésekkel küzdenek ezzel.

* **A megoldás:**
  1. A felhasználó megadja a beszállítói XML/CSV feed URL-jét vagy FTP elérhetőségét.
  2. Beállítja az árrés szabályt: pl. *"Ha a beszerzési ár < 10 000 Ft, akkor +40% haszon, ha drágább, akkor +25%, és kerekítsd 990-re"*.
  3. A te backend-ed minden reggel 6:00-kor egy cron jobbal lehúzza a fájlt, átkalkulálja, és a Shoprenter / Unas / WooCommerce REST API-n frissíti a webshop árait és készleteit.
* **Miért 0 jogi kockázat?**  
  Tiszta technikai adattranszformáció és API szinkronizáció. Nincs pénzkezelés, nincs NAV.
* **Üzleti modell:** 9.900 – 19.900 Ft / hó / webshop (a webshopoknak ez filléres tétel a megspórolt napi 2 óra Excel munka mellett).  
  *15 webshop = havi 200.000 Ft ismétlődő bevétel (MRR).*
* **Szerverigény a Coolify-ban:** +150 MB RAM (cron alatt pörög csak fel a CPU 1-2 percre).

---

## 🛠️ 4. Priorizált Akcióterv (Mit csináljunk most?)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AKCIÓTERV IDŐVONAL                              │
├────────────────────────────────┬───────────────────────────────────────┤
│ 1. LÉPÉS (Azonnal - 1-2 nap)   │ A meglévő Számla AI jogi és UI        │
│                                │ biztonságosítása (EV védelem)         │
├────────────────────────────────┼───────────────────────────────────────┤
│ 2. LÉPÉS (1 hét)               │ MesterMunkalap MVP felépítése         │
│                                │ a meglévő kódokból (Hang + Fotó + PWA)│
├────────────────────────────────┼───────────────────────────────────────┤
│ 3. LÉPÉS (2. hét)              │ Tesztelés szakemberekkel & indulás    │
└────────────────────────────────┴───────────────────────────────────────┘
```

### 1. Fázis: A meglévő Számla AI biztonságosítása (Azonnal elvégezhető):
1. **Frontend UI szövegek finomítása:**
   * A "Számla kiállítása" gomb átnevezése "Számlázz.hu fiókba továbbítás"-ra.
   * Jóváhagyó ellenőrző jelölőnégyzet beépítése a Split View modálba.
2. **ÁSZF és Adatvédelem véglegesítése:**
   * Rögzíteni a felelősségkizárást: te csak bizonylat-digitalizáló segédeszközt nyújtasz a Számlázz.hu elé.
3. **Coolify beállítások:**
   * A teszt `sslip.io` domainek helyett éles domainek hozzárendelése.

### 2. Fázis: A MesterMunkalap PWA megépítése a Netcup szerveren:
1. Új Hono backend route és Astro oldal létrehozása a meglévő kódbázisban (vagy egy különálló könnyű Coolify alkalmazásként).
2. A már létező hangalapú diktálás ([`voice.ts`](file:///d:/github/szamlazo-app/frontend/src/scripts/voice.ts)) bekötése a munkalap tételeihez.
3. Aláírás komponens hozzáadása és a MinIO-ba mentése.
4. Munkalap PDF generálás (ügyfélnek és szakinak kiküldve).

---

*A terv a Netcup szerveren futó Coolify állapot és a magyar egyéni vállalkozói jogszabályok pontos ismeretében készült.*
