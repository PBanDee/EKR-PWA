# EKR PWA projektutasítások

## 1. Projekt célja

Az EKR egy offline-first Progressive Web App kivitelezők terepi dokumentációjához.

Az alkalmazás elsődleges használati környezete Android tablet, de a megoldás működjön iPadOS/iOS és asztali böngésző alatt is. Egy kivitelező több tableten, párhuzamosan dolgozhat. Egy tablet akár egész nap internetkapcsolat nélkül is használható.

A rendszer fő folyamata:

1. A felhasználó online állapotban inicializálja az alkalmazást és letölti a kivitelező konfigurációját.
2. A felhasználó internet nélkül is új kivitelezéseket hozhat létre.
3. A felhasználó kitölti a szükséges dokumentuműrlapokat, fényképeket készít és kézi aláírást rögzít.
4. Minden adat először helyben mentődik.
5. A kivitelezés véglegesítés után `pending_upload` állapotba kerül.
6. Internetkapcsolat esetén az alkalmazás feltölti a várakozó adatokat a központi API-ba.
7. A központi rendszer dokumentumokat generál, PDF-et készít és később Microsoft 365 / SharePoint tárhelyre archivál.

## 2. Alapelvek

### 2.1 Offline-first

- A terepi adatbevitel egyetlen funkciója sem függhet folyamatos internetkapcsolattól.
- Az alkalmazás mindig a helyi adatbázisból olvasson.
- Minden módosítás először a helyi adatbázisba kerüljön.
- A hálózati szinkronizáció külön folyamat legyen.
- A kapcsolat megszakadása nem okozhat adatvesztést vagy blokkolt felületet.
- Az alkalmazás bezárása vagy az eszköz újraindítása után a helyi munka legyen folytatható.

### 2.2 A mentés nem feltöltés

A felhasználói felületen mindig különüljön el:

- `draft`: folyamatban, helyben tárolva
- `completed_local`: helyben kitöltve és véglegesítve
- `pending_upload`: feltöltésre vár
- `uploading`: feltöltés folyamatban
- `uploaded`: szerver által visszaigazolt feltöltés
- `upload_error`: sikertelen szinkronizáció

Soha ne jelenjen meg „Feltöltve” állapot kizárólag helyi mentés alapján.

### 2.3 Egyedi azonosítók

- Minden kivitelezés kliensoldalon generált UUID-t kapjon.
- A dokumentumok, fényképek, aláírások és szinkronizációs tételek szintén UUID-t kapjanak.
- Ne használjunk tabletenként növekvő, ütközésre hajlamos üzleti sorszámot elsődleges azonosítóként.
- A szerveroldali API kezelje idempotensen az ismételt feltöltéseket.

### 2.4 Dinamikus sablonrendszer

- A 8–10 dokumentum tartalma ne legyen közvetlenül a felületbe hardcode-olva.
- A dokumentumok és mezők JSON-konfigurációból épüljenek fel.
- Egy sablon rendelkezzen verzióval.
- Egy kivitelezés mentse el, hogy melyik konfiguráció- és sablonverzió alapján készült.
- Egy már elkezdett kivitelezés mezőszerkezete ne változzon meg automatikusan egy későbbi konfigurációfrissítés miatt.

## 3. Javasolt technológiai felépítés

### 3.1 Prototípus frontend

- HTML5
- CSS3
- modern JavaScript vagy TypeScript
- PWA Web App Manifest
- Service Worker az alkalmazáshéj gyorsítótárazásához
- IndexedDB a helyi üzleti adatokhoz
- GitHub Pages HTTPS hosztolás a prototípushoz

A frontend későbbi keretrendszere lehet React + TypeScript, de a működő funkciókat ne írjuk újra csak technológiai divat miatt.

### 3.2 Későbbi backend

A frontend ne függjön a backend konkrét megvalósításától. A kommunikáció egy absztrahált HTTPS REST API rétegen keresztül történjen.

Tervezett folyamat:

```text
PWA
  -> HTTPS REST API
  -> központi adatbázis és fájltárolás
  -> dokumentumgenerálás
  -> PDF
  -> Microsoft 365 / SharePoint archiválás
```

Jelenleg nincs Azure-előfizetés, ezért ne tegyünk Azure-specifikus függőséget a frontendbe.

## 4. Adatmodell

### 4.1 ContractorConfig

Minimális mezők:

```ts
interface ContractorConfig {
  contractorId: string;
  contractorName: string;
  taxNumber?: string;
  address?: string;
  contactName?: string;
  configVersion: string;
  validFrom?: string;
  documentTemplates: DocumentTemplate[];
}
```

### 4.2 Installation

```ts
type SyncStatus =
  | 'draft'
  | 'completed_local'
  | 'pending_upload'
  | 'uploading'
  | 'uploaded'
  | 'upload_error';

interface Installation {
  id: string;
  contractorId: string;
  configVersion: string;
  customerName: string;
  siteAddress: string;
  installationDate: string;
  syncStatus: SyncStatus;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  uploadedAt?: string;
  serverReceiptId?: string;
  lastSyncError?: string;
  documents: InstallationDocument[];
  photos: PhotoRecord[];
  signatures: SignatureRecord[];
}
```

### 4.3 Dokumentumsablon

```ts
type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'time'
  | 'boolean'
  | 'choice'
  | 'multichoice'
  | 'signature'
  | 'photo'
  | 'file';

interface DocumentTemplate {
  code: string;
  title: string;
  version: string;
  required: boolean;
  fields: FieldDefinition[];
}

interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
  defaultValue?: unknown;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}
```

### 4.4 Kitöltött dokumentum

```ts
interface InstallationDocument {
  id: string;
  installationId: string;
  templateCode: string;
  templateVersion: string;
  completed: boolean;
  completedAt?: string;
  values: Record<string, unknown>;
}
```

### 4.5 Fénykép és aláírás

```ts
interface PhotoRecord {
  id: string;
  installationId: string;
  documentId?: string;
  category?: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  createdAt: string;
}

interface SignatureRecord {
  id: string;
  installationId: string;
  documentId?: string;
  signerName: string;
  signerRole?: string;
  imageBlob: Blob;
  signedAt: string;
}
```

## 5. IndexedDB szabályok

- Az IndexedDB elérés külön adat-hozzáférési rétegben legyen.
- UI komponens ne írjon közvetlenül nyers IndexedDB tranzakciókat.
- Használjunk verziózott adatbázis-sémát és migrációs stratégiát.
- A kivitelezés és kapcsolódó adatai tranzakciós egységként legyenek kezelhetők.
- Nagy képeket ne tároljunk base64 szövegként, ha Blobként is tárolhatók.
- Fotó mentésekor szükség esetén legyen méret- és felbontáscsökkentés, de az eredmény maradjon dokumentációs célra jól olvasható.
- A helyi adatok törlése csak explicit felhasználói művelettel vagy szerver által visszaigazolt feltöltés után, dokumentált megőrzési szabály alapján történjen.

## 6. Service Worker és PWA

- A Service Worker gyorsítótárazza az alkalmazáshéjat és az offline működéshez szükséges statikus erőforrásokat.
- Verzióváltáskor a régi cache-ek szabályosan törlődjenek.
- A Service Worker frissítése ne törölje az IndexedDB üzleti adatokat.
- Az első online megnyitás után az alkalmazás legyen újraindítható offline állapotban.
- A felhasználó kapjon egyértelmű jelzést, ha új alkalmazásverzió érhető el.
- A GitHub Pages projekt-alútvonalat kezeljük helyesen. Ne feltételezzük, hogy az alkalmazás mindig a domain gyökerében fut.
- Minden statikus útvonal legyen relatív vagy konfigurálható base path alapján képzett.

## 7. Szinkronizáció

### 7.1 Upload queue

Minden feltöltendő kivitelezés külön queue-bejegyzést kapjon.

A queue-bejegyzés tartalmazza:

- kliensoldali UUID
- kivitelezés UUID
- művelet típusa
- próbálkozások száma
- utolsó próbálkozás ideje
- következő próbálkozás ideje
- utolsó hiba
- állapot

### 7.2 Szinkronizációs szabályok

- Csak `pending_upload` vagy `upload_error` állapotú tételeket próbáljunk feltölteni.
- A feltöltés legyen idempotens.
- Sikertelen feltöltés ne módosítsa vagy törölje a helyi adatot.
- Hálózati hiba esetén használjunk fokozatos újrapróbálkozást.
- Legyen kézi „Szinkronizálás most” lehetőség.
- Az automatikus szinkronizáció ne akadályozza az adatbevitelt.
- A kliens csak szerveroldali sikeres visszaigazolás után állíthatja `uploaded` állapotba a munkát.
- A szerver válaszában legyen egy központi átvételi azonosító.

### 7.3 Tervezett API-felület

```text
GET  /api/config
POST /api/installations
GET  /api/installations/{id}/status
POST /api/installations/{id}/photos
POST /api/installations/{id}/signatures
```

A kliensoldali API-modul biztosítson mock implementációt is, hogy a frontend backend nélkül tesztelhető legyen.

## 8. Felhasználói felület

### 8.1 Tablet-first

- A felület elsősorban fekvő és álló tablet méretre optimalizált legyen.
- A kezelőszervek legyenek érintésbarát méretűek.
- Ne legyenek egymáshoz túl közel elhelyezett kis ikonok.
- A legfontosabb műveletek szöveges címkét is kapjanak.

### 8.2 Kötelező képernyők

1. Inicializálás / konfiguráció
2. Főoldal és helyi kivitelezések
3. Új kivitelezés alapadatai
4. Kivitelezés áttekintése
5. Dokumentumlista
6. Dinamikus dokumentuműrlap
7. Fényképek
8. Aláírás
9. Véglegesítés előtti ellenőrzés
10. Szinkronizációs állapot

### 8.3 Állapot-visszajelzés

Mindig legyen látható:

- online vagy offline kapcsolat
- helyi mentés állapota
- feltöltési várólista elemszáma
- utolsó sikeres szinkronizáció
- aktuális kivitelezés készültsége
- hiányzó kötelező mezők vagy dokumentumok

A „helyben mentve” és „feltöltve” állapot vizuálisan és szövegesen is különüljön el.

### 8.4 Automatikus mentés

- Mezőmódosítás után az adat automatikusan kerüljön helyi mentésre.
- A mentés legyen késleltetett/debounce-olt, hogy ne induljon tranzakció minden leütésre.
- Navigálás előtt a függőben levő helyi mentést fejezzük be.
- A felhasználó lássa: `Mentés...`, majd `Helyben mentve`.

## 9. Aláírás

- Az aláírás HTML Canvas vagy megfelelő komponens segítségével készüljön.
- Támogassa az érintést, tollat és egeret.
- Legyen Törlés és Elfogadás művelet.
- Üres aláírás ne legyen elfogadható.
- Mentsük az aláíró nevét, szerepét és az aláírás időpontját.
- Az aláírás képét Blobként tároljuk.
- A rajzolt aláírást ne nevezzük tanúsítványalapú digitális aláírásnak.

## 10. Fényképek

- Androidon és iOS-en is használható fájl-/kamerabemenetet alkalmazzunk.
- Egy kivitelezéshez több kép legyen csatolható.
- A képek helyben maradjanak elérhetők offline.
- Legyen előnézet és törlési lehetőség.
- A felhasználó adhasson kategóriát vagy megjegyzést.
- Nagy fájlok esetén kezeljük a tárhelykorlátot és jelezzünk érthető hibát.

## 11. Véglegesítés

Véglegesítés előtt ellenőrizni kell:

- kötelező alapadatok
- kötelező dokumentumok
- kötelező dokumentummezők
- előírt fényképek
- szükséges aláírások

A véglegesítés után:

- a kivitelezés `completed_local`, majd `pending_upload` állapotba kerül
- az adatok továbbra is megmaradnak helyben
- a kivitelezés szerkesztése alapértelmezés szerint zárolt
- feloldás csak explicit, naplózható művelettel történjen

## 12. Biztonság és adatvédelem

- Titkos kulcs, API-kulcs, jelszó vagy SharePoint hozzáférési adat soha ne kerüljön a frontend forrásába.
- `.env` és lokális titokfájl ne kerüljön Gitbe.
- A GitHub Pages statikus és nyilvánosan elérhető lehet. Éles személyes adatot ne tároljunk vagy teszteljünk a publikus prototípusban.
- A prototípus kizárólag szintetikus tesztadatokat használjon.
- Éles rendszerben hitelesítés és jogosultságkezelés szükséges.
- Minden hálózati kommunikáció HTTPS-en történjen.
- A megjelenített felhasználói szöveget escape-elni kell, kerülni kell a nem ellenőrzött `innerHTML` használatát.
- Feltöltött fájlok típusát és méretét kliens- és szerveroldalon is validálni kell.

## 13. Git és GitHub Pages

### 13.1 Repository

- A `main` ág mindig futtatható állapotban legyen.
- Nagy, összefüggő változtatás külön feature ágon készüljön.
- A commitüzenetek legyenek rövidek és egyértelműek.
- Generált buildfájl csak akkor kerüljön Gitbe, ha a GitHub Pages telepítési stratégia megköveteli.

### 13.2 GitHub Pages

- A prototípus GitHub Pages-en fusson HTTPS alatt.
- A repository almappás URL-jét minden útvonalnál vegyük figyelembe.
- A PWA manifest `start_url` és `scope` értékei legyenek helyesek.
- A Service Worker scope-ja fedje le az alkalmazás teljes GitHub Pages útvonalát.
- Módosítás után ellenőrizzük a GitHub Pages deployment eredményét.
- Cache-probléma esetére legyen dokumentált frissítési eljárás.

## 14. Kódminőség

- Elsősorban egyszerű, olvasható és tesztelhető megoldást válasszunk.
- Ne vezessünk be új függőséget, ha a platform API megfelelően megoldja a feladatot.
- Ne használjunk `any` típust indokolatlanul.
- Az üzleti logika ne legyen UI-event handlerekbe zsúfolva.
- A moduloknak egyértelmű felelőssége legyen.
- A hibákat felhasználóbarát üzenettel és fejlesztői naplóval is kezeljük.
- A felület magyar nyelvű legyen, de a kódazonosítók angolul készüljenek.
- Dátumokat belsőleg ISO 8601 formában tároljunk.
- Az időpontoknál később kezelni kell az időzónát is.

## 15. Tesztelési minimum

Minden jelentős változtatás után ellenőrizni kell:

1. első online megnyitás
2. újraindítás online állapotban
3. újraindítás offline állapotban
4. új kivitelezés létrehozása offline
5. alkalmazás bezárása és az adat visszatöltése
6. dokumentummezők mentése
7. kötelező mezők ellenőrzése
8. fénykép készítése vagy kiválasztása
9. aláírás rajzolása érintéssel
10. több kivitelezés párhuzamos tárolása
11. véglegesítés offline
12. sikertelen feltöltés kezelése
13. újrapróbálkozás hálózat visszatérésekor
14. frissített PWA verzió telepítése adatvesztés nélkül

A tesztelést legalább egy tényleges Android tableten is el kell végezni. iPad használat előtt külön iPadOS/Safari teszt szükséges.

## 16. Copilot munkamódszer

Amikor a GitHub Copilot vagy más kódoló asszisztens ezen a projekten dolgozik:

1. Először vizsgálja át a repository releváns fájljait.
2. Ne feltételezze, hogy minden korábbi terv megvalósult.
3. Azonosítsa a jelenlegi működő állapotot és a hiányzó részeket.
4. Ne írjon felül működő funkciót szükségtelenül.
5. Kis, ellenőrizhető változtatásokban dolgozzon.
6. Minden módosítás után futtassa a rendelkezésre álló ellenőrzéseket.
7. Jelezze, ha a változtatás adatbázis-migrációt vagy cache-verzióváltást igényel.
8. Ne állítsa, hogy a szinkronizáció működik, ha csak mock feltöltés van.
9. Ne állítsa, hogy az app telepíthető, amíg a manifestet, Service Workert és HTTPS környezetet nem ellenőrizte.
10. Ne használjon éles vagy személyes adatokat tesztadatként.

## 17. Jelenlegi prioritási sorrend

1. GitHub Pages alatt megnyitható PWA
2. megbízható offline alkalmazáshéj
3. IndexedDB helyi adatmodell
4. új kivitelezés és több helyi munka
5. JSON-alapú dinamikus dokumentuműrlapok
6. automatikus helyi mentés
7. aláírás
8. fényképek
9. véglegesítés és validáció
10. upload queue mock API-val
11. valódi backend API
12. szerveroldali dokumentumgenerálás
13. Microsoft 365 / SharePoint archiválás

## 18. Kifejezetten nem része a jelenlegi prototípusnak

- tanúsítványalapú digitális aláírás
- valódi SharePoint feltöltés
- valódi központi API
- Word/PDF dokumentumgenerálás
- éles hitelesítés
- éles személyes adatok kezelése
- automatikus konfliktusfeloldás két eszköz ugyanazon munkán végzett módosításai között

Ezeket ne szimuláljuk kész funkcióként. A felületen és dokumentációban egyértelműen jelöljük mock vagy későbbi funkcióként.
