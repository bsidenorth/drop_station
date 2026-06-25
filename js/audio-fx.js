// =========================================================
// dr0p_station — MÓDULO: audio-fx.js
// ÁUDIO — TTS, efeitos sonoros, música de fundo (BGM)
//
// Parte 4 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

    function speakPhrase(phrasePT, phraseEN) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const text = currentLang === 'PT' ? phrasePT : phraseEN;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = currentLang === 'PT' ? 'pt-BR' : 'en-US';
        u.rate = 1.1; u.pitch = 0.8; u.volume = 0.9;
        window.speechSynthesis.speak(u);
    }

    function speakRandom() {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const pool = CYBER_VOICES[currentLang];
        const text = pool[Math.floor(Math.random() * pool.length)];
        const u = new SpeechSynthesisUtterance(text);
        u.lang = currentLang === 'PT' ? 'pt-BR' : 'en-US';
        u.rate = 1.0; u.pitch = 0.75; u.volume = 0.9;
        window.speechSynthesis.speak(u);
    }

    // =========================================================
    // SISTEMA CENTRAL DE ÁUDIO E VOZ SINTETIZADA (Ponto 3)
    // =========================================================
    // =========================================================
    // SFX — CHOQUE / CURTO-CIRCUITO ELÉTRICO (dispara junto do glitch
    // visual da Alquimia/Fusão — ver FASE 2 de fuseCards)
    // =========================================================
    function playFusionShockSound() {
        try {
            initAudio();
            const now = audioCtx.currentTime;

            // Buzz principal: dente-de-serra grave com frequência instável
            // (efeito de "curto" elétrico, tremendo)
            const buzz = audioCtx.createOscillator();
            const buzzGain = audioCtx.createGain();
            buzz.type = 'sawtooth';
            buzz.frequency.setValueAtTime(90, now);
            buzzGain.gain.setValueAtTime(0.001, now);
            buzzGain.gain.linearRampToValueAtTime(0.18, now + 0.02);
            for (let i = 0; i < 14; i++) {
                const t = now + i * 0.045;
                buzz.frequency.setValueAtTime(60 + Math.random() * 420, t);
            }
            buzzGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
            buzz.connect(buzzGain); buzzGain.connect(audioCtx.destination);
            buzz.start(now); buzz.stop(now + 0.65);

            // Crackle de alta frequência por cima, tipo faísca/arco voltaico
            for (let i = 0; i < 8; i++) {
                const t = now + Math.random() * 0.6;
                const spark = audioCtx.createOscillator();
                const sparkGain = audioCtx.createGain();
                spark.type = 'square';
                spark.frequency.setValueAtTime(1800 + Math.random() * 3200, t);
                sparkGain.gain.setValueAtTime(0.05, t);
                sparkGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                spark.connect(sparkGain); sparkGain.connect(audioCtx.destination);
                spark.start(t); spark.stop(t + 0.04);
            }
        } catch (e) {}
    }

    function playTerminalSound(type) {
        // type: 'login' | 'error' | 'claim' | 'alchemy'
        try { initAudio(); } catch(e) {}

        const beep = (freq, oscType, dur, gain) => {
            try {
                initAudio();
                const osc = audioCtx.createOscillator();
                const g   = audioCtx.createGain();
                osc.type = oscType || 'square';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                g.gain.setValueAtTime(gain || 0.12, audioCtx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
                osc.connect(g); g.connect(audioCtx.destination);
                osc.start(); osc.stop(audioCtx.currentTime + dur);
            } catch(e) {}
        };

        if (type === 'login') {
            beep(440, 'sine', 0.1, 0.12);
            setTimeout(() => beep(880, 'sine', 0.18, 0.1), 120);
            setTimeout(() => speakPhrase("Terminal ativado. Bem-vindo, operador.", "Terminal activated. Welcome, operator."), 300);

        } else if (type === 'error') {
            beep(300, 'sawtooth', 0.3, 0.2);
            setTimeout(() => beep(180, 'sawtooth', 0.3, 0.18), 180);
            setTimeout(() => speakPhrase("Acesso negado. Bumps insuficientes.", "Access denied. Insufficient Bumps."), 300);

        } else if (type === 'claim') {
            beep(523, 'triangle', 0.25, 0.15);
            setTimeout(() => beep(659, 'triangle', 0.25, 0.12), 100);
            setTimeout(() => beep(784, 'triangle', 0.35, 0.1), 200);
            setTimeout(() => speakPhrase("Ativo integrado ao cofre.", "Asset secured in vault."), 400);

        } else if (type === 'alchemy') {
            beep(200, 'sawtooth', 0.15, 0.15);
            setTimeout(() => beep(400, 'square', 0.15, 0.12), 150);
            setTimeout(() => beep(800, 'sine', 0.15, 0.1), 300);
            setTimeout(() => beep(1200, 'sine', 0.3, 0.12), 450);
            setTimeout(() => speakPhrase("Protocolo de fusão concluído. Nova entidade gerada.", "Fusion protocol complete. New entity generated."), 700);

        } else if (type === 'overload') {
            // Sirene ciberpunk: dois tons alternando 3x + voz específica de sobrecarga
            beep(1800, 'sawtooth', 0.18, 0.25);
            setTimeout(() => beep(900,  'sawtooth', 0.18, 0.22), 220);
            setTimeout(() => beep(1800, 'sawtooth', 0.18, 0.22), 440);
            setTimeout(() => beep(900,  'sawtooth', 0.18, 0.20), 660);
            setTimeout(() => beep(1800, 'sawtooth', 0.18, 0.20), 880);
            setTimeout(() => beep(600,  'square',   0.35, 0.18), 1100);
            setTimeout(() => speakPhrase(
                "Alerta crítico. Sobrecarga na rede detectada. Chance de drop épico aumentada por cinco minutos.",
                "Critical alert. Network overload detected. Epic drop rate increased for five minutes."
            ), 1500);
        }
    }

    function toggleLanguage() {
        currentLang = currentLang === 'PT' ? 'EN' : 'PT';
        try { localStorage.setItem('dr0p_lang', currentLang); } catch(e) {}
        document.getElementById('langLabel').innerText = currentLang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dictionary[currentLang][key]) el.innerText = dictionary[currentLang][key];
        });
        if (!activeAssetData && !isRolling) {
            document.getElementById('status-text').innerText = currentLang === 'PT' ? 'AGUARDANDO_MUTACAO...' : 'AWAITING_MUTATION...';
        } else if (activeAssetData) {
            metaRarity.innerText = currentLang === 'PT' ? activeAssetData.rarityName : activeAssetData.rarityNameEN;
            metaStyle.innerText  = currentLang === 'PT' ? activeAssetData.styleName  : activeAssetData.styleNameEN;
            if (downloadBtn.style.display === "block") {
                downloadBtn.innerText = activeAssetData.costToClaim > 0 ?
                    (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) :
                    (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            }
        }
        speakRandom();
        renderQuotesTicker();
    }

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playSynthSound(type) {
        try {
            initAudio();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode); gainNode.connect(audioCtx.destination);

            if (type === 'click') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
                osc.start(); osc.stop(audioCtx.currentTime + 0.05);
            } else if (type === 'success') {
                let now = audioCtx.currentTime;
                osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15);
                gainNode.gain.setValueAtTime(0.15, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(); osc.stop(now + 0.3);

                setTimeout(() => {
                    let osc2 = audioCtx.createOscillator(); let gain2 = audioCtx.createGain();
                    osc2.type = 'sine'; osc2.frequency.setValueAtTime(1318.51, audioCtx.currentTime);
                    osc2.connect(gain2); gain2.connect(audioCtx.destination);
                    gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
                    osc2.start(); osc2.stop(audioCtx.currentTime + 0.2);
                }, 80);
            } else if (type === 'tick') {
                osc.type = 'square'; osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02);
                osc.start(); osc.stop(audioCtx.currentTime + 0.02);
            } else if (type === 'shatter') {
                let now = audioCtx.currentTime;
                osc.type = 'sawtooth'; osc.frequency.setValueAtTime(280, now);
                osc.frequency.linearRampToValueAtTime(40, now + 0.4);
                gainNode.gain.setValueAtTime(0.25, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
                osc.start(); osc.stop(now + 0.45);
            } else if (type === 'roll') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(440, audioCtx.currentTime);
                osc.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.12);
                gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
                osc.start(); osc.stop(audioCtx.currentTime + 0.12);
            }
        } catch(e) {}
    }

    function toggleBackgroundAudio() {
        initAudio();
        const btn = document.getElementById('audioToggleBtn');
        if (isBgmPlaying) {
            clearInterval(bgmInterval); isBgmPlaying = false;
            btn.classList.remove('on');
        } else {
            isBgmPlaying = true;
            btn.classList.add('on');
            let beatIndex = 0;
            const bass = [55.00, 55.00, 48.99, 48.99, 65.41, 65.41, 58.27, 58.27];
            bgmInterval = setInterval(() => {
                try {
                    let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
                    let filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(300, audioCtx.currentTime);
                    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(bass[beatIndex % bass.length], audioCtx.currentTime);
                    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
                    gain.gain.setValueAtTime(0.15, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.22);
                    osc.start(); osc.stop(audioCtx.currentTime + 0.25); beatIndex++;
                } catch(e) {}
            }, 250);
        }
    }

    // =========================================================
    // CACHE PERSISTENTE (IndexedDB) DO POOL DE DROPS
    // EGRESS FIX: o bucket high-res-assets é privado, então só pode ser
    // servido via Signed URL — e cada Signed URL é ÚNICA a cada
    // carregamento. Isso IMPEDE o cache HTTP normal do navegador (pra
    // ele, é sempre "um arquivo novo"), e fazia o bucket inteiro ser
    // rebaixado em TODA visita/F5 de TODO visitante — inflando o Egress
    // do projeto sem necessidade real (Storage real do bucket é minúsculo
    // comparado ao Egress consumido).
    // Aqui guardamos os BYTES de cada imagem (não a URL, que muda) num
    // IndexedDB local. Na próxima vez que o MESMO navegador precisar da
    // MESMA imagem, ela é lida do disco local — zero rede, zero egress.
    // =========================================================
    const DROP_CACHE_DB_NAME = 'dr0p_station_cache';
    const DROP_CACHE_STORE   = 'drop_images';
    const DROP_CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24h — depois disso, revalida com o bucket

    let _dropCacheDbPromise = null;
    function _openDropCacheDb() {
        if (_dropCacheDbPromise) return _dropCacheDbPromise;
        _dropCacheDbPromise = new Promise((resolve) => {
            if (!('indexedDB' in window)) { resolve(null); return; }
            try {
                const req = indexedDB.open(DROP_CACHE_DB_NAME, 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore(DROP_CACHE_STORE, { keyPath: 'path' });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null); // falha de IndexedDB nunca deve travar o jogo
            } catch (e) { resolve(null); }
        });
        return _dropCacheDbPromise;
    }

    async function _getCachedDropImage(path) {
        try {
            const db = await _openDropCacheDb();
            if (!db) return null;
            return await new Promise(resolve => {
                const tx = db.transaction(DROP_CACHE_STORE, 'readonly');
                const req = tx.objectStore(DROP_CACHE_STORE).get(path);
                req.onsuccess = () => {
                    const entry = req.result;
                    resolve(entry && (Date.now() - entry.ts) < DROP_CACHE_TTL_MS ? entry.blob : null);
                };
                req.onerror = () => resolve(null);
            });
        } catch (e) { return null; }
    }

    function _setCachedDropImage(path, blob) {
        // fire-and-forget — se falhar (ex: quota do navegador cheia), o
        // jogo continua funcionando normal, só sem cachear esse arquivo.
        _openDropCacheDb().then(db => {
            if (!db) return;
            try {
                const tx = db.transaction(DROP_CACHE_STORE, 'readwrite');
                tx.objectStore(DROP_CACHE_STORE).put({ path, blob, ts: Date.now() });
            } catch (e) {}
        });
    }

    // ── CARREGA O POOL DE DROPS DIRETO DO BUCKET high-res-assets ──────
    // Lista todos os arquivos do bucket privado, gera Signed URLs em
    // lote (1h de validade — só pro carregamento inicial dos drops, não
    // confundir com a Signed URL de 60s usada no download HD individual
    // em executeDoubleAssetDownload) e pré-desenha cada um num canvas
    // off-screen, guardando o nome do arquivo em preloadedCanvasPaths
    // na MESMA posição do canvas correspondente em preloadedCanvases.
    async function loadDropImagePoolFromBucket() {
        try {
            const { data: files, error } = await sb.storage.from('high-res-assets').list('', { limit: 1000 });
            if (error) { console.error('[Pool de drops] Falha ao listar bucket:', error.message); return; }
            const imageFiles = (files || []).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f.name));
            if (imageFiles.length === 0) {
                console.warn('[Pool de drops] Bucket high-res-assets está vazio — nenhuma imagem disponível pra mintagem.');
                return;
            }

            // Embaralha a ordem antes de pedir as Signed URLs — assim o
            // "primeiro arquivo carregado" não é sempre o mesmo (depende
            // da ordem que o bucket devolve), e a galeria fica variada
            // desde o primeiro drop de cada visitante.
            const shuffled = imageFiles.slice().sort(() => Math.random() - 0.5);
            const paths = shuffled.map(f => f.name);

            const { data: signedList, error: signErr } = await sb.storage
                .from('high-res-assets')
                .createSignedUrls(paths, 3600);
            if (signErr || !signedList) { console.error('[Pool de drops] Falha ao gerar signed URLs:', signErr?.message); return; }

            const queue = signedList.filter(item => item.signedUrl);
            if (queue.length === 0) {
                console.warn('[Pool de drops] Nenhuma signed URL válida retornada pelo bucket.');
                return;
            }

            function _drawBlobToPool(item, blob) {
                return new Promise(resolve => {
                    const img = new Image();
                    img.onload = () => {
                        const off = document.createElement('canvas'); off.width = 600; off.height = 600;
                        off.getContext('2d').drawImage(img, 0, 0, 600, 600);
                        preloadedCanvases.push(off);
                        preloadedCanvasPaths.push(item.path);
                        URL.revokeObjectURL(img.src);
                        resolve(true);
                    };
                    img.onerror = () => { URL.revokeObjectURL(img.src); resolve(false); };
                    img.src = URL.createObjectURL(blob);
                });
            }

            async function loadOne(item) {
                // 1) Já temos esse arquivo salvo localmente? Usa direto, sem rede.
                const cached = await _getCachedDropImage(item.path);
                if (cached) return _drawBlobToPool(item, cached);

                // 2) Sem cache: baixa via Signed URL com fetch() (em vez de
                // <img src=signedUrl>) só pra conseguirmos guardar os BYTES
                // no IndexedDB e não precisarmos rebaixar esse arquivo de novo.
                try {
                    const resp = await fetch(item.signedUrl);
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const blob = await resp.blob();
                    _setCachedDropImage(item.path, blob);
                    return await _drawBlobToPool(item, blob);
                } catch (e) {
                    console.warn('[Pool de drops] Falha ao carregar do bucket:', item.path, e.message || e);
                    return false; // não trava o carregamento por um arquivo corrompido/inacessível
                }
            }

            // PERF FIX (drop demorando "uma vida" pra rolar): antes, esta
            // função só terminava depois que TODAS as imagens do bucket
            // (potencialmente centenas) tivessem sido baixadas e desenhadas
            // — e o primeiro drop de qualquer sessão ficava bloqueado nesse
            // Promise.all gigante. Agora carregamos só A PRIMEIRA imagem
            // (suficiente pra liberar o roll imediatamente) e despachamos
            // o resto do bucket em lotes pequenos, EM SEGUNDO PLANO, sem
            // bloquear nenhum clique em Free Roll/Premium. A galeria vai
            // ficando mais variada conforme o resto carrega, e cada drop
            // sorteia dentre o que já estiver pronto naquele momento.
            await loadOne(queue[0]);


            const rest = queue.slice(1);
            const BATCH_SIZE = 4;
            (async function loadRestInBackground() {
                for (let i = 0; i < rest.length; i += BATCH_SIZE) {
                    const batch = rest.slice(i, i + BATCH_SIZE);
                    await Promise.all(batch.map(loadOne));
                }
            })();

            if (preloadedCanvases.length === 0) {
                console.warn('[Pool de drops] Nenhuma imagem do bucket conseguiu carregar (ver avisos acima).');
            }
        } catch (e) {
            console.error('[Pool de drops] Erro inesperado ao carregar do bucket:', e);
        }
    }
    // ── LAZY LOAD: pool só é carregado na primeira tentativa de drop,
    // não na abertura da página. Isso reduz egress do Supabase drasticamente
    // para visitantes que apenas navegam sem dropar.
    // BUGFIX: antes, dois cliques rápidos em "Free Roll"/"Premium" antes do
    // pool terminar de carregar disparavam DOIS list()+createSignedUrls()
    // em paralelo (poolLoaded só virava true de forma síncrona, mas a
    // promise de carregamento real não era compartilhada) — desperdiçando
    // egress e podendo duplicar imagens em preloadedCanvases. Agora
    // _poolLoadPromise guarda a Promise em andamento e toda chamada
    // concorrente espera a MESMA promise em vez de disparar outra.
    let poolLoaded = false;
    let _poolLoadPromise = null;
    async function ensurePoolLoaded() {
        if (poolLoaded || preloadedCanvases.length > 0) return;
        if (_poolLoadPromise) return _poolLoadPromise;
        _poolLoadPromise = loadDropImagePoolFromBucket().finally(() => {
            poolLoaded = true;
            _poolLoadPromise = null;
        });
        return _poolLoadPromise;
    }

