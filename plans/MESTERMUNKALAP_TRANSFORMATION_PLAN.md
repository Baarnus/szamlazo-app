# 🛠️ Teljes Termék Transzformációs Mesterterv: Számla AI ➔ MesterPlatform (PWA)

> **Dokumentum:** `plans/MESTERMUNKALAP_TRANSFORMATION_PLAN.md`  
> **Verzió:** 2.0.0 (All-in-One Masterplan)  
> **Dátum:** 2026. szeptember 23.  
> **Infrastruktúra:** Netcup VPS (4 vCPU, 8 GB RAM, 160 GB SSD) — Coolify PaaS felügyelettel (`netcup_szerver`)  
> **Státusz:** Hivatalos Egyéni Vállalkozói (EV) jogi védelem + MesterMunkalap PWA és Bizonylatkezelő fúziója.

---

## 🧭 Vezetői Összefoglaló (A Megoldás Lényege)

Ez a dokumentum **egyetlen összefüggő rendszerben tartalmazza** a teljes átalakítási tervet:
1. **A Jelenlegi Kód Megtartása és Levédése:** A meglévő számlafeldolgozó kódod 100%-ban megmarad, de a jogi szerepköre tisztázódik: **nem önálló számlázóprogram** (ami NAV bírságveszéllyel járna), hanem **Bizonylat-digitalizáló és Számlakészítési Segéd a Számlázz.hu-hoz**.
2. **A MesterMunkalap PWA Nívós Integrálása:** A szakemberek (klímások, villanyszerelők, szervizesek) terepi munkalapjának, hangdiktálásának, helyszíni fotózásának és érintőképernyős aláírásának beépítése.
3. **A Közös Híd:** A lezárt munkalapból **egy kattintással hivatalos számla lesz a Számlázz.hu Agenten keresztül** — nincs dupla gépelés este!
4. **Coolify Kihasználása:** A meglévő Netcup 160 GB SSD-re épülő helyi MinIO-val **0 Ft felhős tárhelyköltséggel** fut az egész platform, és a megmaradó ~5 GB RAM-on még egy 2. SaaS (Webshop FeedSync) is elfér.

---

## ⚖️ 1. Jogi Státusz & EV Felelősségvédelem (A "Bizonylatkezelő" Jelentése)

Egyéni Vállalkozóként (EV) a **teljes magánvagyonoddal felelsz**. Ezért a jogi szerepkörök elhatárolása életmentő:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               JOGI FELELŐSSÉGMEGOSZTÁS                                 │
├──────────────────────────┬─────────────────────────────────────────────────────────────┤
│ 1. MesterMunkalap Modul  │ • Polgári jogi műszaki bizonylat (teljesítésigazolás).      │
│                          │ • NEM adóügyi bizonylat ➔ ZÉRÓ NAV kockázat, nincs bírság! │
├──────────────────────────┼─────────────────────────────────────────────────────────────┤
│ 2. Költségbizonylatok    │ • Digitális adatbeviteli asszisztens (OCR előkészítő).      │
│    (Blokk & Számla AI)   │ • A felelősség a felhasználóé (Split-View-ban jóváhagyja).  │
├──────────────────────────┼─────────────────────────────────────────────────────────────┤
│ 3. Számlakibocsátás      │ • A számlát a Számlázz.hu hivatalos Számla Agent API intézi.│
│    (Számlázz.hu Agent)   │ • A sorszámozásért és NAV beküldésért a KBOSS.hu Kft. felel!│
└──────────────────────────┴─────────────────────────────────────────────────────────────┘
```

### Mit kell módosítani a jelenlegi kódban ehhez?
* A Split-View modálban a gomb felirata:  
  👉 **„Átadás a Számlázz.hu fiókomnak”** (nem "Számla kiállítása").
* Kötelező jóváhagyási pipa a gomb fölött:  
  `[x] Az adatokat ellenőriztem, a számla létrehozását a Számlázz.hu fiókomban jóváhagyom.`
* Így az alkalmazásod megtartja a teljes kényelmi értékét, de **téged semmilyen NAV felelősség nem érhet**.

---

## 🎯 2. A Szaki Napi Munka-Körforgása

```
                      ┌─────────────────────────────────────────────────────────┐
                      │              SZAKI NAPI MUNKA-KÖRFORGÁSA                │
                      └────────────────────────────┬────────────────────────────┘
                                                   │
                ┌──────────────────────────────────┴──────────────────────────────────┐
                ▼                                                                     ▼
    ☀️ REGGEL: ANYAGBESZERZÉS                                        🔨 NAPKÖZBEN: TEREPEN AZ ÜGYFÉLNÉL
  (Meglévő Bizonylatkezelő Modul)                                      (ÚJ MesterMunkalap PWA Modul)
  • Vásárol a nagykerben (kábel, klíma, gázcső)                     • Megérkezik a megrendelőhöz (pl. Kovács Kft.)
  • Lefotózza a blokkot a telefonjával                              • Hanggal bediktálja az elvégzett munkát és anyagokat
  • A Gemini AI azonnal kiolvassa a tételeket                       • Fotót készít a javításról (előtte-utána)
  • Költségszámlaként elmentve ➔ Hó végén RLB-60 a könyvelőnek!     • Ügyfél ujjal aláírja a telefon kijelzőjén a munkalapot
                                                                    • Egy gombnyomás: Szép Munkalap PDF megy az ügyfélnek!
                                                   │                                  │
                                                   └──────────────────┬───────────────┘
                                                                      │
                                                                      ▼
                                                       🚀 FIZETÉS & SZÁMLÁZÁS (A KÖZÖS HÍD)
                                                       • Egyetlen kattintás a munkalapon:
                                                         „Számla kiállítása Számlázz.hu fiókomban”
                                                       • A munkalap tételeit a rendszer automatikusan
                                                         átemeli a számlára (nincs dupla gépelés!)
                                                       • A vevő megkapja a Számlázz.hu e-számlát.
```

---

## 📱 3. UI / UX Átalakítás: Felületi Tervek

### A) Fejléc és Főnavigáció (`Navbar.astro`)
A felső fejléc bal oldalán megjelenik az üzemmódválasztó gombcsoport:

```html
<!-- Navigációs fülválasztó -->
<div class="tabs tabs-boxed bg-base-200/60 p-1">
  <button id="navWorksheetsBtn" class="tab tab-active gap-1.5 font-bold text-xs sm:text-sm">
    <span>🛠️</span> <span>Munkalapok</span>
  </button>
  <button id="navInvoicesBtn" class="tab gap-1.5 font-medium text-xs sm:text-sm">
    <span>🧾</span> <span>Költségbizonylatok</span>
  </button>
  <button id="navPartnersBtn" class="tab gap-1.5 font-medium text-xs sm:text-sm hidden md:flex">
    <span>👥</span> <span>Partnertár</span>
  </button>
</div>
```

### B) Munkalap Főoldal (`WorksheetDashboard.astro`)
1. **Fő akció:** `[ ➕ Új Munkalap Készítése ]` (kiemelt mobilbarát zöld gomb).
2. **Állapotjelzők:** *Piszkozat (3)* | *Aláírva (5)* | *Leszámlázva (12)*.
3. **Munkalap Kártyák:** Ügyfél neve, címe, munka jellege, bruttó összeg, státusz címkék, `[ 📄 PDF ]`, `[ ✍️ Aláírás ]`, `[ 🧾 Számla ]` gombokkal.

### C) Munkalap Kitöltő és Aláíró Modál (`WorksheetModal.astro`)
* **Ügyfélkereső:** A meglévő [`partner-suggest.ts`](file:///d:/github/szamlazo-app/frontend/src/scripts/partner-suggest.ts) gépeléskor automatikusan kitölti a korábbi partnerek címét és adatait.
* **Hangalapú Tételdiktálás:** A meglévő [`voice.ts`](file:///d:/github/szamlazo-app/frontend/src/scripts/voice.ts) modullal a szaki bemondja a munkát: *"Klímatisztítás 18 000 Ft, 3 méter kondenzvíz cső 6 000 Ft"*.
* **Fotók:** Előtte és utána állapot fotózása telefonnal (a MinIO tárolóba mentve).
* **Érintős Aláírás (Digital Canvas):** Az ügyfél ujjal aláírja a telefon kijelzőjén.
* **Lezárás:** PDF generálás + 1-kattintásos Számlázz.hu kiállítás.

---

## 📲 4. PWA (Progressive Web App) Képességek

* **`manifest.json` hozzáadása:**
  * Név: *MesterLap & Számla AI*
  * Ikonok: 192x192 és 512x512
  * `display: standalone` (nincs böngészősáv, tiszta natív mobilapp élmény).
  * `theme_color: #10b981`.
* **Kezdőképernyőre rakható:** iOS Safari és Android Chrome alatt azonnal kirakható a telefon asztalára.

---

## 🗄️ 5. Adatbázis Séma Bővítés (`backend/src/db/schema.ts`)

A meglévő adatbázis séma érintetlen marad; csupán a `worksheets` tábla adódik hozzá:

```ts
export const worksheets = pgTable('worksheets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id).notNull(),
  worksheetNumber: text('worksheet_number').notNull(), // pl. "ML-2026-0001"
  
  // Megrendelő adatai
  clientName: text('client_name').notNull(),
  clientTaxNumber: text('client_tax_number'),
  clientZip: text('client_zip'),
  clientCity: text('client_city'),
  clientAddress: text('client_address'),
  clientEmail: text('client_email'),
  clientPhone: text('client_phone'),
  
  // Munka adatai
  deviceType: text('device_type'),       // pl. "Daikin Klíma 3.5 kW"
  description: text('description').notNull(),
  items: jsonb('items').$type<Array<{
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
  }>>().default([]).notNull(),
  
  // Fotók és aláírás (MinIO linkek a 160 GB SSD-n)
  beforePhotos: jsonb('before_photos').$type<string[]>().default([]),
  afterPhotos: jsonb('after_photos').$type<string[]>().default([]),
  signatureUrl: text('signature_url'),
  signedAt: timestamp('signed_at'),
  
  // Státusz és kapcsolat a számlához
  status: text('status').default('draft').notNull(), // 'draft' | 'signed' | 'invoiced' | 'closed'
  invoiceId: text('invoice_id').references(() => invoices.id),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_worksheets_user').on(table.userId, table.status, table.createdAt)
]);
```

---

## 🔌 6. Új Backend Útvonalak (`backend/src/routes/worksheets.ts`)

| Végpont | Metódus | Szerep |
|---|:---:|---|
| `/api/worksheets` | `GET` | Munkalapok listázása (lapozás, státusz szűrés: draft, signed, invoiced) |
| `/api/worksheets` | `POST` | Új munkalap mentése (sorszám generálás: `ML-YYYY-XXXX`) |
| `/api/worksheets/:id` | `GET` | Munkalap részletei (tételek, fotók, aláírás link) |
| `/api/worksheets/:id` | `PATCH` | Munkalap frissítése / Aláírás beküldése és zárolás |
| `/api/worksheets/:id` | `DELETE` | Piszkozat törlése |
| `/api/worksheets/:id/pdf` | `GET` | Formázott, céges logós Munkalap PDF letöltése |
| `/api/worksheets/:id/to-invoice`| `POST` | **A HÍD:** Munkalap tételeinek átadása a `szamlazzRouter`-nek |

---

## 🖥️ 7. Netcup (160 GB SSD / 8 GB RAM) + Coolify Erőforrás-Kihasználás

A Coolify felületeden futó **6 szolgáltatás** mellé zökkenőmentesen illeszkedik az új modul:
* `metabase`: BI analitika (~750 MB)
* `minio`: Helyi S3 képtároló (~180 MB) ➔ **Itt tárolódnak a munkalap fotók és aláírások is 0 Ft felhőköltséggel!**
* `postgre`: Központi adatbázis (~1.0 GB) ➔ **Ide kerül a `worksheets` tábla.**
* `szamlazo_backend`: Hono Node.js API (~250 MB).
* `szamlazo_frontend`: Astro felület (~120 MB).
* `umami`: Forgalomelemző (~160 MB).

📊 **Kapacitás:**
* Használt RAM az új funkcióval együtt: **~2.8 – 3.2 GB**
* **Szabadon maradó RAM:** **~4.8 – 5.2 GB** (Itt kényelmesen elfér a 2. SaaS: a Webshop FeedSync is!).
* **Szabad SSD:** ~110+ GB (több mint 500 000 fotó és PDF tárolására elegendő).

---

## 💰 8. Árazási és Piacra Lépési (GTM) Stratégia

* **Célcsoport:** Klímaszerelők, villanyszerelők, gázkészülék-karbantartók, autószervizek.
* **Csomagok:**
  * **Alap Mester Csomag (4.900 Ft / hó):** Havi korlátlan digitális munkalap, fotók, aláírás, PDF generálás.
  * **Pro Mester Csomag (7.900 Ft / hó):** Munkalapok + AI blokk-felismerés (költségelszámolás RLB-60) + 1-kattintásos Számlázz.hu számlázás.
* **Hogyan szerezzük meg az első 20 ügyfelet?**
  * Szakmai Facebook csoportok (pl. *Magyar Klímások, Villanyszerelő Szakmai Fórum*).
  * Rövid videó: *"Hogyan diktálom le a létrán 30 másodperc alatt a munkalapot ahelyett, hogy este körmölnék"*.
  * 14 napos ingyenes próbaidőszak.
  * **20 előfizető = 100.000 – 150.000 Ft havi passzív MRR.**

---

## 📅 9. Kivitelezési Lépések

1. **1. Lépés: Adatbázis & Backend előkészítés (2 nap):**
   * `worksheets` tábla hozzáadása a `schema.ts`-hez.
   * `backend/src/routes/worksheets.ts` CRUD végpontok létrehozása.
2. **2. Lépés: Frontend Navigáció & Nézetváltó (1 nap):**
   * Fülválasztó a `Navbar.astro`-ban (Munkalapok vs Bizonylatok).
   * Munkalap lista kártyák a Dashboardon.
3. **3. Lépés: Munkalap Űrlap, Hangdiktálás & Érintős Aláírás (2 nap):**
   * Mobilbarát kitöltő modál.
   * HTML5 Canvas érintőképernyős aláírás komponens.
   * Fotó feltöltő kamera integráció.
4. **4. Lépés: PDF Generálás & Számla Átemelő Híd (1 nap):**
   * Elegáns munkalap PDF előnézet és letöltés.
   * „Átadás a Számlázz.hu-nak” gomb bekötése kötelező jóváhagyó pipával.

---
*Ez a dokumentum 100%-ban lefedi a technikai, jogi, infrastrukturális és üzleti megvalósítást.*
