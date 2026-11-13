# Comfy Studio

Web app mobile-first per ComfyUI e Immich ML remoti. Tre tab: **Prompts**, **Originali**, **Edits**; Coda e Impostazioni nella barra superiore. Face protected e escluso dalla web app; il raggruppamento delle persone nella galleria e indipendente. Il progetto e autonomo e non include il bot Telegram.

Su telefono la navigazione secondaria e nel menu hamburger. Il menu include Impostazioni e il tema Chiaro/Scuro/Sistema, con preferenza persistente. La galleria usa tre colonne da 360 px in su, due sui telefoni piu stretti; ricerca e upload restano a portata di tocco, mentre filtri e selezione si aprono dal pulsante accanto alla ricerca. Il badge segnala filtri attivi anche a pannello chiuso.

## Funzioni

- Prompt con ricerca, categorie, tag, preferiti, versioni immutabili e immagini generate. Cinque slot rapidi opzionali, senza limite di cinque prompt in libreria.
- Importazione bulk dal pulsante accanto alla ricerca prompt: incollare i testi separati da `---` su una riga dedicata, oppure scegliere un separatore letterale diverso. Il modulo suggerisce il separatore e blocca l'importazione se non lo trova su una riga dedicata o se ci sono meno di due prompt non vuoti. Anteprima con titoli modificabili e categoria comune; massimo 100 prompt per importazione atomica. Nel dettaglio prompt, **Modifica immagine** apre la galleria per scegliere un originale o un edit e precompila il composer.
- Originali JPEG/PNG/WebP da file, fotocamera, trascinamento o clipboard. Anteprima e conferma prima del caricamento; nessun avvio GPU automatico. Originali immutati, copia normalizzata per ComfyUI e anteprime senza EXIF.
- Griglie virtualizzate, viewer PhotoSwipe con pinch/zoom, dettagli scorrevoli e download. Lineage con originale radice e input immediato per edit di edit e upscale; create senza originale fittizio.
- Dettagli prompt e immagini navigabili con frecce, tasti destra/sinistra e swipe orizzontale, anche senza aprire lo zoom. I gesti verticali continuano a scorrere la pagina; i campi di testo e i modali non intercettano la navigazione da tastiera.
- Dal prompt, **Modifica immagine** apre la galleria: il pallino seleziona piu immagini, il click sull'immagine apre il composer singolo. **Modifica selezionate** apre il composer comune con istruzione aggiuntiva e accoda un job per immagine. In caso di errore parziale, gli invii confermati vengono deselezionati e il nuovo tentativo nel medesimo composer mantiene i token per evitare duplicati.
- Crea, Modifica standard, Upscale, Rigenera e Variazione. Prompt, seed, LoRA e workflow conservati per job. Rigenera cambia seed, Variazione modifica il risultato con nuova istruzione senza aggiungere il vecchio prompt.
- Coda persistente, pausa dispatch, priorita, annullamento degli attesi, retry esplicito e recupero output senza nuova elaborazione. Nessuna interruzione globale di ComfyUI condiviso.
- Ricerca semantica, embedding facciali e tag tramite **Immich ML remoto**. Clustering persone locale, assegnazioni manuali, rinomina e unione; separazione tramite riassegnazione dei volti. Tag manuali, suggeriti, accettati o rifiutati.
- Preferiti, selezione multipla, cestino reversibile e filtri. Nessun purge definitivo automatico: i riferimenti storici rimangono integri.

## Requisiti e architettura

React/TypeScript/Vite, FastAPI/SQLAlchemy/Alembic, PostgreSQL/pgvector e filesystem persistente. Nessun Redis. Compose avvia database, API, worker generazione, worker analisi e frontend/proxy. **Non avvia ComfyUI, Immich server o Immich ML.** Richiede Docker Compose sul server. I tre workflow sono inclusi nella directory `workflows/`:

- [workflows/flux2-klein-9b-q4-create-api.json](workflows/flux2-klein-9b-q4-create-api.json)
- [workflows/flux2-klein-9b-q4-edit-api.json](workflows/flux2-klein-9b-q4-edit-api.json)
- [workflows/seedvr2-upscale-api.json](workflows/seedvr2-upscale-api.json)

Modelli e nodi devono essere gia disponibili in ComfyUI. Il frontend non contatta direttamente i servizi remoti. La prima analisi puo richiedere download dei modelli sull'host ML.

Limiti iniziali: upload 19 MB/25 megapixel; risultati 150 MB/100 megapixel. Il limite output e separato per consentire upscale piu grandi degli originali. Configurare `MAX_IMAGE_PIXELS` e `MAX_OUTPUT_IMAGE_PIXELS` secondo la RAM disponibile; il limite non garantisce memoria sufficiente nella GPU ComfyUI.

## Avvio sul server

### File Docker

I Dockerfile sono separati per servizio, non nella root:

- [backend/Dockerfile](backend/Dockerfile): immagine Python condivisa da API, worker generazione e worker analisi.
- [frontend/Dockerfile](frontend/Dockerfile): build React con Node e pubblicazione tramite Nginx.
- [compose.yml](compose.yml): costruisce entrambe le immagini e avvia anche PostgreSQL/pgvector.

Usare Compose per avviare l'intera applicazione; non serve un Dockerfile unico nella root. ComfyUI e Immich ML rimangono servizi esterni.

Clonare il repository e configurare l'istanza:

```sh
git clone https://github.com/ryuk1h3i/comfy-studio.git
cd comfy-studio
python3 scripts/configure.py
```

Lo script richiede la password direttamente nel terminale, genera segreti distinti e crea `.env` con permessi 600. Impostare `COMFYUI_URL`, `IMMICH_ML_URL` e modelli supportati dall'host remoto. Usare LAN/VPN. Gli endpoint sono amministrativi e non modificabili dal browser. Docker raggiunge l'host tramite `host.docker.internal`, ma una porta esposta solo sul loopback dell'host potrebbe non essere raggiungibile dai container.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=80 api generation-worker analysis-worker
```

Il proxy ascolta su `127.0.0.1:8080`. Pubblicarlo tramite reverse proxy **HTTPS** sulla LAN/VPN mantenendo Host e `X-Forwarded-Proto: https`. Esempio Caddy sullo stesso host:

```caddyfile
studio.example.internal {
    tls internal
    reverse_proxy 127.0.0.1:8080
}
```

Il certificato deve essere attendibile dal telefono: installare la CA locale o usare un certificato valido. HTTPS e necessario per PWA e lettura esplicita clipboard. Non esporre PostgreSQL, ComfyUI o ML su Internet. `COOKIE_SECURE=true` e il default di produzione; su HTTP il browser non conservera il cookie. Per una prova esclusivamente locale HTTP impostare temporaneamente `COOKIE_SECURE=false`, senza pubblicare l'istanza. `BIND_ADDRESS` sceglie l'interfaccia del proxy; non pubblicare l'API direttamente.

Da Impostazioni verificare gli endpoint e provare **Inferenza ML**: il ping non prova compatibilita dei modelli. Impostare LoRA gia presenti in ComfyUI o rimuoverli tutti.

## Immich ML remoto

All'avvio del worker di analisi, se il vocabolario tag e vuoto vengono create 18 categorie visive generiche e riaccodate tutte le immagini fuori dal cestino. I risultati sono suggerimenti basati sulla soglia di similarita, non etichette garantite per ogni immagine. I vocabolari gia configurati non vengono modificati; descrizioni, soglie e assegnazione automatica si gestiscono nelle Impostazioni. Nel tab Volti e tag, il pulsante Rinomina persona permette di cambiare il nome della persona selezionata.

Adapter `pipeline`: `GET /ping`, `POST /predict` multipart con `entries` e `image` oppure `text`. Le sezioni `clip.visual/textual` e `facial-recognition.detection/recognition` usano `modelName` e `options`. Supporta embedding come array o float32 little-endian base64. Il protocollo e interno a Immich: **verificare e fissare la versione sull'host remoto**, senza presumere compatibilita con tutte le release.

Per query italiane usare un modello multilingue supportato. `ML_MODEL_REVISION` identifica revisione/preprocessing: cambiarlo insieme al modello, riavviare API e worker e richiedere Analizza sulle immagini. Gli embedding vecchi non vengono mescolati ai nuovi. PostgreSQL calcola distanze con pgvector e applica filtri nel DB con paginazione. La ricerca e esatta, senza indice HNSW: per archivi molto grandi aggiungere un indice dimensionato sul modello scelto e misurarne il piano query.

L'analisi e asincrona con backoff e massimo cinque tentativi; ML offline non blocca upload o generazione. Analizza resetta i tentativi. I volti vengono raggruppati con DBSCAN (minimo tre campioni): correzioni manuali bloccate e upscale esclusi dalla formazione di cluster. Sulle immagini sintetiche la somiglianza non garantisce identita. I punteggi CLIP non sono probabilita: i tag iniziano come suggerimenti e diventano automatici solo dopo attivazione per tag e calibrazione. Rifiuti e assegnazioni manuali non vengono sovrascritti.

## Clipboard e mobile

Ctrl+V/Cmd+V su Originali acquisisce immagini binarie esposte dal browser, non link HTML. Nei campi testo non viene intercettato. Incolla usa `navigator.clipboard.read()` su gesto esplicito e puo richiedere permessi. Safari/iOS, tastiere e app sorgente possono limitare le immagini disponibili: file e fotocamera restano alternative. Nessun accesso agli appunti in background.

## Coda e recupero

Il job e registrato prima di chiamare ComfyUI; un token evita doppi click. Un lock PostgreSQL impedisce due worker generativi dello Studio contemporanei, e i job vengono reclamati in transazione. Questo non serializza client ComfyUI esterni: evitare lavori concorrenti se la GPU non ha memoria sufficiente.

History viene controllata ogni due secondi. Il worker ascolta anche `/ws?clientId=...` di ComfyUI per aggiornare la barra con i passi reali del nodo corrente: la percentuale non e una stima del tempo totale e puo ripartire quando cambia nodo. Durante caricamento modelli, salvataggio o assenza di eventi live la barra e indeterminata. Se il WebSocket e indisponibile, il recupero dei risultati continua tramite history. L'icona compatta in testata gira mentre ci sono job in invio/elaborazione e segnala i job da verificare. SSE aggiorna il frontend con fallback polling. Dopo riavvio il worker recupera i job con `prompt_id` noto. Un timeout o invio senza conferma lascia **Da verificare** e blocca nuovi dispatch. Verificare queue/history ComfyUI, recuperare il risultato o confermare che il lavoro non sia attivo prima di ritentare. Un crash fra accettazione remota e salvataggio del `prompt_id` richiede verifica manuale; `client_id`/`extra_data.studio_job_id` aiutano a trovare il job remoto. Nessun retry generativo automatico e nessun `/interrupt` globale.

Il salvataggio output e idempotente per job/indice; recuperarlo non genera una nuova immagine. Retry conserva lo snapshot, Rigenera assegna nuovo seed. La riproducibilita non e garantita se cambiano checkpoint, versioni nodi o ambiente ComfyUI.

La coda mostra le miniature dei risultati disponibili: un tocco apre il dettaglio dell'immagine, come nella galleria Edits. I risultati nel cestino non vengono mostrati. Per i job completati, la durata va dalla presa in carico del worker fino al salvataggio dei risultati: include preparazione, eventuale attesa remota e recupero output, ma esclude l'attesa nella coda locale. Un recupero dopo interruzione include anche l'intervallo trascorso durante l'arresto. I job precedenti alla registrazione dei tempi mostrano **Durata non disponibile**, senza stimare tempi dai timestamp generici.

## Sviluppo locale

Python 3.12+ e Node 22.12+/24; `uv` consigliato. SQLite e solo per sviluppo/test, non sostituisce la verifica PostgreSQL. In terminali separati dalla root del repository:

```sh
env DATA_DIR=../data uv run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000
npm --prefix frontend ci
npm --prefix frontend run dev -- --port 5173
```

Aprire `http://127.0.0.1:5173`. In development la password iniziale e `studio-local-change-me`; impostare `ADMIN_PASSWORD` nell'ambiente per cambiarla. Non usare questa configurazione fuori dal loopback. `ENVIRONMENT=production` obbliga password e secret espliciti. Per attivare i worker, impostare gli stessi `DATA_DIR`, `DATABASE_URL`, endpoint e modelli dell'API in ogni processo:

```sh
env DATA_DIR=../data uv run --directory backend python -m app.worker generation
env DATA_DIR=../data uv run --directory backend python -m app.worker analysis
```

Compose carica `.env`, i comandi `uv` non lo caricano automaticamente. I task VS Code sono per anteprima senza worker GPU. Il service worker di produzione conserva solo shell e file statici: API, immagini e sessioni non sono in cache offline. La generazione richiede rete.

## Test

```sh
uv run --directory backend pytest -q
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend audit
```

Per integrazione sul server usare un **database PostgreSQL dedicato e vuoto** e passare `TEST_DATABASE_URL` ai test Python. Non usare un archivio reale: i test creano record. Il test locale usa una directory temporanea separata. Lock multiprocesso e query pgvector vanno provati anche sul server PostgreSQL.

Con API/frontend locali avviati e worker GPU spenti:

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

`STUDIO_TEST_PASSWORD` configura il runner. I test browser creano asset, prompt e job nella copia di sviluppo: non eseguirli contro produzione. Provare anche su telefono fisico installazione PWA, certificati, pinch e clipboard. I test backend simulano ComfyUI: uno smoke reale create/edit/upscale e ML remoto resta necessario.

## Backup e aggiornamenti

Proteggere `.env`, dump DB e volume `studio-data`: contengono prompt, immagini e dati facciali. Originali e database vanno salvati insieme. Le anteprime non includono EXIF ma il download originale conserva i byte, incluso eventuale GPS.

Il repository esclude `.env` e varianti, chiavi private, database, backup, log e directory dati. Solo `.env.example`, con credenziali vuote, va versionato. La password locale documentata e le credenziali nei test sono valori dimostrativi, non segreti di produzione. Non inserire token o password nei workflow, nei file sorgente o negli URL dei servizi remoti; un file ignorato da Git puo comunque essere copiato fuori dal repository, quindi proteggere separatamente i backup e i trasferimenti.

1. Pausare la coda, attendere il job attivo e verificare i job incerti.
2. Arrestare frontend, API e worker, mantenendo PostgreSQL attivo.
3. Eseguire `pg_dump` e archiviare l'intero volume `studio-data`, preservando proprietario UID 10001 e permessi; salvare `.env` separatamente in forma cifrata.
4. Provare il ripristino in istanza isolata con stessi segreti, worker spenti ed endpoint GPU disabilitato. Verificare immagini, prompt, lineage e conteggi prima di riattivare i worker.

Prima degli aggiornamenti fare backup; poi `docker compose up -d --build`. L'API esegue `alembic upgrade head` prima di essere healthy. La revisione `0002` aggiunge la tabella dei tempi dei job senza modificare i record esistenti; non serve ricreare i volumi. Non fare downgrade sul DB di produzione. La riserva disco (256 MB di default) non sostituisce monitoraggio e backup esterno. Il cestino non libera spazio automaticamente.