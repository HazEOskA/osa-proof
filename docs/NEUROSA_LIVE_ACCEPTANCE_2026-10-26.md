# OSA Proof × NeurOSA — LIVE Acceptance Gate
Data: 2026-10-26. Cel: bezpiecznie uruchomić rzeczywistą pamięć w ChatDelivery i dowieść trwałości po restarcie.

> STATUS: BLOCKED. To nie jest dowód produkcyjnego połączenia. README/CI/READY nie zastępują pomiarów LIVE.

## Kanoniczne zasoby (audyt READ-ONLY)
- OSA Proof: `HazEOskA/osa-proof` — Draft PR #24, head `cec7ea973dba2364f421356660f5bb3477e33a04`, base `codex/product-e2e-audit-20261024`.
- Preview: https://osa-proof-mlh6ehfkq-osabarca-1680s-projects.vercel.app (Vercel READY; nie oznacza integracji LIVE).
- OSA Production: https://osa-proof-three.vercel.app — **bez nowego deployu**.
- Railway: projekt `vivacious-caring`, serwis `@neurosa/brain-web`, deployment SUCCESS, 1/1 replika online.
- Railway przy audycie wstępnym miał **0 wolumenów**; aktualizacja patrz 'Postęp faktyczny 2026-10-27'. `NEUROSA_API_TOKEN` jest ustawiony; nie odczytywać wartości.
- NeurOSA Dockerfile: `NEUROSA_DATABASE_PATH=/data/brain.db`, SQLite/WAL.
- Vercel Production: pięć `OSA_NEUROSA_*` występuje w env, ale `OSA_GITHUB_CLIENT_ID`, `OSA_GITHUB_CLIENT_SECRET`, `OSA_GITHUB_SESSION_SECRET`, `OSA_GITHUB_ALLOWED_USER_IDS`, `OSA_GITHUB_CALLBACK_ORIGIN`, `OSA_GITHUB_ORGANIZATION_ID`, `OSA_GITHUB_PROJECT_ID` są nieobecne w spisie env.
- Kod `loadAuthMode` domyślnie używa `session`, gdy `OSA_AUTH_MODE` nie jest ustawione. Nie deklarować `open` bez aktualnego dowodu.
- Próba publicznego GET /health z obecnego narzędzia jest niedostępna (DNS/network); brak nowego zweryfikowanego probe.
- GitHub Actions 40391320066: 265 PASS, 0 FAIL, 3 SKIP; frontend build PASS, backend build PASS. Testy pamięci zawierają jawne fixture, NIE LIVE NeurOSA.

## Postęp faktyczny 2026-10-27 — PROVEN BACKUP, STORAGE CUTOVER BLOCKED

- Railway volume `neurosa-memory-v1` (`89f036f5-9a04-4edd-bac2-0f2945f25e89`) ma **512 MB**, jest live i zamontowany na istniejącym `@neurosa/brain-web` pod `/persist`. Deployment `9e3b620d-6374-418a-8539-d4161c2ef66a`: SUCCESS, replika ONLINE 1/1.
- Właściciel wykonał online `better-sqlite3.backup('/tmp/neurosa-brain-backup.db')` ze źródłowego `/data/brain.db`; `PRAGMA integrity_check` na Railway i w Termuxie zwróciły `ok`. Transfer Termux `scp` ze zrzutu `/persist/brain-restore.db` potwierdził ten sam SHA-256 obu kopii:
  `e6e627e251e5617fad11b29d284678c001ac073878054a4031a3cc4ebda2127b`.
- Kopia jest **na trwałym dysku**, ale **nie jest aktualnie używanym plikiem bazy**. Nie traktować tego jako persistence PASS. Ponieważ volume jest montowany pod `/persist`, oryginalna baza na `/data` nie została przykryta.
- `/persist` ma `root:root 0755` i `brain-restore.db` ma `root:root 0644` (dowód: SSH screenshot). Dockerfile `USER node`: bez przeniesienia własności nie ma prawa zapisania nowego WAL/SHM. Przed cutover zweryfikować i naprawić właściciela katalogu i pliku w kontenerze; nie zmieniać USER procesu na root jako obejścia.
- Brak potwierdzonego snapshotu danych **po** transferze i restarcie; przed cutover porównać z bieżącą `/data/brain.db` i wykonać nowy bezpieczny backup, jeśli były nowe zapisy. Nie aktualizować flagi `OSA_NEUROSA_STORAGE_VERIFIED` w ciemno.
- Railway musi czytać i pisać `/persist/brain-restore.db` jako `node`, wtedy test `remember → readback → restart → recall` na tym samym pliku. Test `PRAGMA integrity_check=ok` bez zapisu **nie wystarcza**.
- **OAuth Production nadal BLOCKED**, brak `OSA_GITHUB_*`. `/api/v1/brain/status` zwraca 401 bez Bearer — expected deny, nie health failure. Wewnętrzne testy operatora nie są publiczną funkcją produktu.

### Protokół bezpiecznego cutover (operator + zatwierdzenie)
1. Będąc już w terminalu Railway, porównaj `/data/brain.db` z przywróconym backupem: kontrola count tabel i UTC timestamp ostatnich zapisów, tylko READ. Jeśli źródło ma nowsze dane, przygotuj **nowy** spójny backup z WAL.
2. Ustaw `node:node` na katalogu `/persist` i przygotowanym pliku bazy (jedna kontrolowana zmiana permissions), potwierdź prawa `node` do zapisu.
3. Sprawdź kompletność bazy `/persist/brain-restore.db` i wersję schematu; zachowaj backup również na telefonie.
4. Dopiero wtedy ustaw Railway `NEUROSA_DATABASE_PATH=/persist/brain-restore.db` i uruchom wdrożenie **jednej** repliki; sprawdź runtime logi, ledger status i odczyt pamięci. Żadnego drugiego Brain API lub kopii DB.
5. Wykonaj nowy syntetyczny zapis oraz readback, kontrolowany restart usługi i kolejny readback; weryfikuj SHA/provenance. Bez PASS tego etapu produkcyjna bramka pamięci pozostaje wyłączona.
6. Skonfiguruj GitHub OAuth i Vercel tenant scope przy użyciu sekretnych wartości poza repo/rozmową, przetestuj login/sesję 401/403; dopiero potem release oraz testy odbioru operatora.

## BLOCKER 1: Trwałość oraz ryzyko utraty aktualnej bazy
Obecny Railway `/data` nie ma persistent volume. **Nie montować pustego wolumenu wprost do pracującej usługi:** nowy mount przesłoni zawartość ścieżki i wykonuje redeploy; możliwa utrata obecnych danych.
1. Najpierw ustalić, czy `/data/brain.db` zawiera jakiekolwiek nieprzeniesione dane. Obecne uprawnienia MCP nie dają dostępu do plików systemowych kontenera.
2. Zrobić spójny backup SQLite zgodny z WAL i zachować kopię *poza* kontenerem; nie kopiować samego pliku bazy przy aktywnym WAL bez prawidłowej procedury.
3. Zweryfikować backup i jego możliwość odtworzenia, udokumentować SHA-256 i lokalizację kontrolowaną przez operatora — bez umieszczania prywatnych danych w PR/CI.
4. Dopiero po osobnym zatwierdzeniu ewentualnego naliczenia opłat przygotować trwały Railway volume dla `/data` lub zatwierdzony istniejący dysk/host zgodny z SQLite/WAL.
5. Odtworzyć backup do nowego storage, uruchomić Brain API z pojedynczym writerem, potwierdzić ledger, remember, recall, restart i ponowny recall.
6. **Nie ustawiaj `OSA_NEUROSA_STORAGE_VERIFIED=true` przed tym testem.** Oryginalny kontener/dane pozostają nietknięte aż do skutecznej walidacji.
Źródła: `HazEOskA/neurosa-human-brain/docs/NEUROSA_DEPLOYMENT.md`; https://docs.railway.com/volumes/reference (storage billing).

## BLOCKER 2: GitHub OAuth + tenant isolation
1. Właściciel tworzy lub wskazuje zweryfikowaną aplikację GitHub OAuth — bez przekazywania sekretów do chatu. Callback musi być zgodny z konfiguracją `OSA_GITHUB_CALLBACK_ORIGIN`: `https://osa-proof-three.vercel.app/api/auth/github/callback`.
2. W Vercel ustawić zmienne: `OSA_GITHUB_CLIENT_ID`, `OSA_GITHUB_CLIENT_SECRET`, `OSA_GITHUB_SESSION_SECRET` (min 32 znaki), `OSA_GITHUB_ALLOWED_USER_IDS`, `OSA_GITHUB_CALLBACK_ORIGIN`, `OSA_GITHUB_ORGANIZATION_ID`, `OSA_GITHUB_PROJECT_ID`.
3. `OSA_GITHUB_ORGANIZATION_ID` i `OSA_GITHUB_PROJECT_ID` muszą być zgodne z serwerowymi `OSA_NEUROSA_ORGANIZATION_ID` i `OSA_NEUROSA_PROJECT_ID`.
4. Produkcyjne `OSA_AUTH_MODE=session`; żadnego otwarcia pamięci anonimowemu użytkownikowi ani tokenów po stronie browsera.
5. Sprawdzić GitHub PKCE + secure HttpOnly cookies, logout, allowlist, 401/403 dla anonimowych/innego tenant, CSRF/origin oraz brak leakage na innych aliasach.
6. Flaga `OSA_NEUROSA_PRODUCTION_ENABLED=enabled` dopiero po potwierdzonym durable storage i audycie auth. Nie zamieniać bieżącego produkcyjnego deploymentu bez release gate.

## BLOCKER 3: Prawdziwy scenariusz
- Jeden zatwierdzony, bezpłatny model/provider; brak symulacji wykonania, kosztów bez kontroli i automatycznych retry.
- GitHub login: auth PASS. `GET /api/memory/status`: `AVAILABLE`, zgodny `brain_id`, `ledger_valid=true`.
- Zapis testowej wiadomości (z syntetyczną wartością nonce) `remember=true`: sealed event, idempotent receipt, readback SHA-256.
- Nowa rozmowa: recall tego samego faktu z `source_reference`, bez użycia browser localStorage jako źródła.
- ChatDelivery: `recall → rzeczywisty model NVIDIA → Runtime → Evidence → ProofReceipt → NeurOSA VERIFIED_RUNTIME`. Bundle związany z `execution_id` i `memory_context_sha256`.
- Po restarcie serwera NeurOSA powtórzyć readback i cross-session recall. Ledger/ProofReceipt pozostają zgodne.
- Manipulacja tenantem, podmieniony receipt, brak tokenu lub uszkodzony ledger: BLOCKED/401/403; żadnego fikcyjnego PASS.
- Wygenerować redagowany report: timestamp, commit SHA, endpoint alias, execution ID, dowody hash; **żadnych kluczy, prywatnych wiadomości i tokenów**.

## STOP conditions / rollback
STOP przy niedostępnym backupie, nieudowodnionej trwałości, błędnym auth/scope, dodatkowej opłacie poza zgodą, nieudanej weryfikacji ledgeru albo spadku jakości CI.
Nie wymuszać merge, promotion ani rollback produkcji automatycznie. Jakakolwiek zmiana runtime Railway lub env Vercel wymaga udokumentowanego targetu, zakresu, skutków, możliwości odzyskania danych i osobnej zgody na koszt.

## Aktualny wynik
- Code contracts: PASS (265 testów, 0 FAIL, 3 SKIP).
- Vercel preview build: READY.
- Railway runtime: ONLINE (brak weryfikacji odpowiedzi /health z tej sesji).
- Durable NeurOSA: BLOCKED, brak wolumenu i zweryfikowanego backupu.
- GitHub OAuth Production: BLOCKED, brak konfiguracji.
- Full LIVE E2E: NOT EXECUTED.
