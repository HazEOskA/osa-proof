/**
 * V1 canonical, non-executable framework navigation context for "Zapytaj OSĘ".
 * This is a user guide, NOT tool authority, process state or a source of live proof.
 * Only the allowlisted view ID chooses one of these operator-reviewed descriptions.
 */
export const OSA_GUIDE_PAGES: Record<string,{title:string;what:string;next?:string}> = {
  home:{title:"Strona główna",what:"Punkt startowy OSA Proof. Wybierz kafelek lub menu. Kafelki pokazują także funkcje, które mogą być niedostępne.",next:"build:agents"},
  "jeverson-chat":{title:"Czat floty agentów",what:"Osobne środowisko rozmów z profilami agentów, historią i wywołaniami do NVIDIA. Odpowiedź AI nie jest wykonaniem zadania ani ProofReceipt.",next:"build:agents"},
  "delivery-lab":{title:"Laboratorium wdrożeń",what:"Formularz celu misji, typ artefaktu, tryb wykonania i weryfikacja. Tryb szablonowy nie zastępuje autonomicznego buildera.",next:"proofs"},
  "nvidia:models":{title:"Modele NVIDIA",what:"Konfiguracja modelu i osobny interfejs rozmowy. Klucze są tajne, nie wprowadzaj ich do promptu.",next:"jeverson-chat"},
  "build:agents":{title:"Agenci",what:"W edytorze Agenci zarządzasz wpisami kanonicznego Team Graph: rola, agent_id, executor_ref, model_ref i możliwości. Samo przypisanie model_ref nie gwarantuje wykonawcy.",next:"build:mesh"},
  "build:mesh":{title:"Sieć agentów",what:"Wizualna konfiguracja połączeń grafu zespołu. Obecny kontrakt wykonawczy jest liniowy, a nie dowolnym DAG.",next:"build:studio"},
  "build:workflows":{title:"Przepływy pracy",what:"Kolejność agentów i przekazania zadań w ramach kanonicznego grafu zespołu. Sprawdź walidację grafu.",next:"build:studio"},
  "build:tools":{title:"Narzędzia",what:"Definicje narzędzi i ich konfiguracje. Wpis w katalogu nie potwierdza dostępności wykonawcy.",next:"build:playground"},
  "build:skills":{title:"Umiejętności",what:"Katalog procedur i parametrów umiejętności. Dostępność jest sprawdzana oddzielnie.",next:"build:studio"},
  "build:connections":{title:"MCP / A2A",what:"Konfiguracja połączeń, referencje poświadczeń i integracje protokołów. Sekretów nie wpisuj do czatu.",next:"build:tools"},
  "build:prompts":{title:"Prompty",what:"Edytor instrukcji z wersjami i zmiennymi. Szablon promptu nie uprawnia do uruchamiania narzędzi.",next:"build:studio"},
  "build:studio":{title:"Studio",what:"Zdefiniuj cel, wybierz zespół i wymagania, przygotuj misję. Następnie użyj Placu testowego lub panelu Misje, aby wykonać dostępne operacje.",next:"build:playground"},
  "build:playground":{title:"Plac testowy",what:"Kontrolowane uruchomienie zadania na aktualnym Runtime; rezultat i dowody możesz następnie sprawdzić w Śledzeniu i Dowodach.",next:"trace"},
  missions:{title:"Misje / Wykonania",what:"Przegląd misji i zarejestrowanych wykonań. Uruchomienie zależy od uprawnień, modelu i środowiska; nie zakładaj sukcesu bez potwierdzenia.",next:"trace"},
  trace:{title:"Śledzenie / Zdarzenia",what:"Drzewo i oś zdarzeń danego wykonania (execution_id). Zdarzenia nie zawsze mają znaczniki czasu. Możesz przejść do Dowodów.",next:"proofs"},
  proofs:{title:"Dowody / Weryfikacja",what:"Sprawdza materiał dowodowy, skróty i wynik weryfikacji ProofReceipt. CLAIM nie jest PROOF; digest sprawdza integralność, nie prawdziwość faktów.",next:"replay"},
  replay:{title:"Odtwarzanie",what:"Przechodzenie po zarejestrowanych zdarzeniach wykonania. To odtwarzanie zapisanej kolejności, nie powtórne uruchomienie agentów.",next:"proofs"},
  world:{title:"Świat wiedzy",what:"Wizualny graf encji i relacji, w tym wyniki wykonania, zależnie od dostępnych danych. Nie traktuj samej wizualizacji jako zweryfikowanego proof.",next:"missions"},
  "ops:runtime":{title:"Silnik wykonawczy",what:"Stan API, wykonawców i zarejestrowanego grafu. Tryb fixture oznacza dane testowe.",next:"missions"},
  "ops:logs":{title:"Dzienniki",what:"Zdarzenia runtime zgromadzone w dashboardzie. Nie zawsze obejmują inne instancje serverless.",next:"trace"},
  "ops:metrics":{title:"Metryki",what:"Metryki pochodzące z dostępnych wykonań, nie globalne statystyki wszystkich wdrożeń.",next:"trace"},
  "ops:monitoring":{title:"Monitorowanie",what:"Sprawdź bieżący stan API, błędy i wykonania. Wyniki pojedynczej kontroli nie dowodzą pełnego stanu usługi.",next:"ops:logs"},
  "ops:deployments":{title:"Wdrożenia",what:"Powiązania wdrożenia z wersją grafu zespołu, podgląd i produkcja. Zmiana wersji może wymagać autoryzacji.",next:"ops:runtime"},
  "ops:scheduler":{title:"Harmonogram",what:"Zaplanuj przyszłą misję; wykonanie wymaga przetworzenia kolejki. Serverless nie oznacza stałego workera.",next:"ops:queues"},
  "ops:queues":{title:"Kolejki",what:"Oczekujące zadania wykonawcze. Przygotowane zadanie nie oznacza ukończonej misji.",next:"missions"},
  "ops:audit":{title:"Historia audytu",what:"Lista zarejestrowanych potwierdzeń i zdarzeń dostępnych w dashboardzie.",next:"proofs"},
  "ops:policies":{title:"Zasady",what:"Zasady kontroli misji i dostępu. Model AI nie może samodzielnie zmieniać polityk.",next:"ops:permissions"},
  "ops:permissions":{title:"Uprawnienia",what:"Przegląd reguł autoryzacji API i dostępności tras. UI nie zastępuje kontroli serwera.",next:"ops:policies"},
  "ops:secrets":{title:"Sekrety",what:"Pokazywane mogą być wyłącznie nazwy i stan konfiguracji. Wartości sekretów nie są ujawniane.",next:"ops:settings"},
  "ops:organizations":{title:"Organizacje",what:"Zakres organizacji i projektów widoczny w API; nie potwierdza to weryfikacji tożsamości.",next:"ops:permissions"},
  "ops:settings":{title:"Ustawienia",what:"Konfiguracja środowiska serwera jest tu głównie tylko do odczytu, nie nadpisuj sekretów przez czat.",next:"home"},
  "ops:architecture":{title:"Architektura",what:"Komponenty i dokumentacja aktualnej architektury, API i Team Graph.",next:"world"},
  "ops:topology":{title:"Topologia",what:"Połączenia agentów i zarejestrowanych wykonawców w grafie zespołu.",next:"build:mesh"},
  "ops:timeline":{title:"Oś czasu",what:"Kolejność zapisanych zdarzeń wykonania.",next:"replay"},
  "ops:dependencies":{title:"Zależności",what:"Zależności między modułami inteligencji i grafem.",next:"world"},
  "ops:knowledge":{title:"Wiedza",what:"Zasoby wiedzy dostępne w tej instancji; magazyn NeurOSA może być oddzielny.",next:"world"},
  "ops:experiments":{title:"Eksperymenty",what:"Porównywanie eksperymentów i ewaluacji na danych obecnych w procesie.",next:"intel:evaluators"},
  "ops:notifications":{title:"Powiadomienia",what:"Wykryte komunikaty i potencjalne problemy; brak potwierdzenia trwałego zapisu.",next:"ops:monitoring"},
  "intel:models":{title:"Modele",what:"Informacje o modułach modelowych i stanie dostępności; deklaracja nie stanowi dowodu użycia.",next:"nvidia:models"},
  "intel:model-mesh":{title:"Sieć modeli",what:"Status i zależności tras modelowych.",next:"intel:llm-gateway"},
  "intel:llm-gateway":{title:"Bramka LLM",what:"Warstwa routingu do modeli i ich ograniczeń.",next:"nvidia:models"},
  "intel:memory":{title:"Pamięć",what:"Moduł zapowiedziany, nieposiadający aktywnego widoku. NeurOSA to odrębny system pamięci; nie twierdź, że jest podłączony.",next:"home"},
  "intel:context-hub":{title:"Centrum kontekstu",what:"Widok jeszcze nieaktywny. Nie deklaruj faktycznej integracji kontekstu, jeśli API jej nie raportuje.",next:"home"},
  "pending:Chmura":{title:"Chmura",what:"Funkcja w przygotowaniu; nawigacja nie oferuje jeszcze zrealizowanego panelu chmury.",next:"ops:deployments"},
  "pending:Infrastruktura":{title:"Infrastruktura",what:"Funkcja w przygotowaniu; dashboard nie udostępnia pełnej obsługi infrastruktury.",next:"ops:architecture"},
  "pending:Piaskownice":{title:"Piaskownice",what:"Panel jeszcze w przygotowaniu; nie obiecuj, że izolowane wykonania są tu dostępne.",next:"ops:runtime"},
  "intel:datasets":{title:"Zbiory danych",what:"Zbiory przykładów dostępne w aktualnym API, które może przechowywać stan tylko w pamięci procesu.",next:"ops:experiments"},
  "intel:evaluators":{title:"Ewaluatory",what:"Reguły oceny wyników. Sprawdź, czy zostały zarejestrowane w danej instancji.",next:"ops:experiments"},
  "web3:overview":{title:"Przegląd Web3",what:"Odczytowy przegląd sieci blockchain. Operacje podpisywania i wysyłania transakcji są niedostępne w tym trybie.",next:"web3:chains"},
  "web3:chains":{title:"Sieci blockchain",what:"Zaobserwowane sieci i ich parametry. Dane RPC to obserwacje, nie dowód kryptograficzny.",next:"web3:transactions"},
  "web3:wallets":{title:"Portfele",what:"Obserwacje portfeli, bez podpisywania i udostępniania kluczy.",next:"web3:risk"},
  "web3:entities":{title:"Encje Web3",what:"Encje blockchain wyodrębnione z obserwacji.",next:"web3:events"},
  "web3:events":{title:"Zdarzenia Web3",what:"Zapisane zdarzenia obserwacji sieci.",next:"web3:transactions"},
  "web3:transactions":{title:"Transakcje",what:"Odczytowy status transakcji; brak uprawnień do ich podpisywania.",next:"web3:proof"},
  "web3:agents":{title:"Agenci Web3",what:"Role i zdolności agentów Web3 zależą od autoryzowanego wykonawcy.",next:"web3:risk"},
  "web3:protocols":{title:"Protokoły Web3",what:"Obsługa protokołów jest ograniczona do zarejestrowanych adapterów.",next:"web3:risk"},
  "web3:risk":{title:"Ryzyko Web3",what:"Domyślnie odmowa transakcji i operacji wymagających podpisu. Nie traktuj opisów ryzyka jako audytu kontraktu.",next:"web3:proof"},
  "web3:proof":{title:"Dowody Web3",what:"Zapis integralności obserwacji, a nie niezależne potwierdzenie stanu blockchain.",next:"proofs"}
};
export function osaGuideContext(view:unknown):string {
  if(typeof view!=="string"||view.length>100)throw new Error("INVALID_GUIDE_VIEW");
  const entry=OSA_GUIDE_PAGES[view];
  if(!entry)throw new Error("INVALID_GUIDE_VIEW");
  return [
    "Jesteś OSĄ: kontekstowym asystentem i samouczkiem frameworka OSA Proof. Odpowiadaj po polsku, konkretnie, życzliwie i rzeczowo. Nie zaczynaj ogólną odpowiedzią, gdy użytkownik pyta o OSA.",
    "OSA Proof to framework budowania i weryfikacji systemów agentowych, NIE tylko pojedynczy APR. Ścieżka: Team Graph -> Misja -> OsaRuntime -> Zdarzenia -> Evidence -> ProofReceipt -> weryfikacja / Replay. Moduły: BUDOWANIE, WYKONANIE, MONITORING, DOWODY, INTELIGENCJA, WEB3, ŚWIAT, KONTROLA i SYSTEM.",
    "W BUDOWANIE są Agenci, Sieć agentów, Przepływy pracy, Narzędzia, Umiejętności, MCP/A2A, Prompty, Studio i Plac testowy. W WYKONANIE: Misje, Silnik, Harmonogram, Kolejki, Wdrożenia. W DOWODY: Dowody, Weryfikacja i Odtwarzanie. Czat floty agentów jest oddzielnym modułem.",
    "Warstwy produktowe: Academy (edukacja), Builder/Core (aktualny główny zakres), Regulated (wymaga uprawnień). Nie obiecuj, że zaplanowane funkcje już działają. NeurOSA jest oddzielnym kontekstem pamięci; nie jest automatycznie podłączona do tego czatu.",
    "Wskazuj dokładną ścieżkę w polskim menu i najprostszy następny krok. Jeśli funkcja jest nieaktywna, powiedz to wprost. Jeśli czegoś nie wiesz, nie wymyślaj.",
    "Nie masz prawa wykonywać zmian, uruchamiać agentów ani modyfikować sekretów przez odpowiedź tekstową. Nie proś o klucze API, hasła, dane wrażliwe, tokeny. CLAIM != PROOF; odpowiedź AI nie jest wykonaniem ani potwierdzeniem.",
    "Obecnie oglądany moduł: "+entry.title+". Kontekst tego modułu: "+entry.what,
    entry.next?"Możliwy następny moduł: "+OSA_GUIDE_PAGES[entry.next]?.title+".":""
  ].join("\n");
}
