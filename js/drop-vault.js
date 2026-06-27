// =========================================================
// dr0p_station — MÓDULO: drop-vault.js
// MÁQUINA DE DROP (variantes/filtros), grid do cofre, marquee de stories
//
// Parte 7 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
//
// [PATCH 5_MECANICAS] Adicionado: preflight + overlay de Terminal Overflow
// pro teto global de 500 cartas ativas. Ver SQL_PATCH_5_MECANICAS.sql pra
// trigger/RPC do banco. IMPORTANTE: claimAssetLogic (em
// cards-inventory-db.js, ainda não patchado nesta rodada) precisa, no seu
// catch de erro do insertCardToSupabase, chamar
// `if (window.handleSupabaseCardError(error)) return;` ANTES de seguir
// com o throw genérico — assim o erro 'NETWORK_LIMIT_REACHED' vindo da
// trigger do banco também aciona o overlay aqui definido.
// =========================================================


    function _getRandomDropVariant(rarityKey) {
        const pool = DROP_FILTER_DB[rarityKey] || DROP_FILTER_DB.common;
        const idx = Math.floor(Math.random() * pool.length);
        return pool[idx];
    }

    const DROP_STYLE_NAME_LIST = DROP_FILTER_DB.common.map(v => v.name)
        .concat(DROP_FILTER_DB.epic.map(v => v.name))
        .concat(DROP_FILTER_DB.legendary.map(v => v.name));

    // =========================================================
    // [FIX FUSÃO] BANCO INTERNO DE FILTROS DE FUSÃO (30 MODIFICADORES EXCLUSIVOS)
    // Estes filtros NÃO aparecem em nenhum menu de seleção — são aplicados
    // de forma oculta pelo gerador ao processar a fusão de duas cartas.
    // Cada fusão sorteia 1 filtro aleatório deste banco, sobrepondo ao
    // buildRandomFusionFilter existente para maior variação visual.
    // =========================================================
    const FUSION_INTERNAL_FILTER_DB = [
        { name: 'NEURAL_DECAY',       filter: 'hue-rotate(15deg) saturate(320%) contrast(190%) brightness(85%)' },
        { name: 'CHROMATIC_BREACH',   filter: 'invert(18%) saturate(480%) hue-rotate(142deg) contrast(210%)' },
        { name: 'SIGNAL_COLLAPSE',    filter: 'brightness(55%) contrast(300%) saturate(150%) hue-rotate(220deg)' },
        { name: 'QUANTUM_SMEAR',      filter: 'hue-rotate(88deg) saturate(550%) contrast(175%) brightness(78%)' },
        { name: 'VOID_FRACTURE',      filter: 'invert(35%) hue-rotate(260deg) saturate(700%) contrast(230%)' },
        { name: 'MAGMA_CORE',         filter: 'hue-rotate(22deg) saturate(600%) contrast(195%) brightness(72%)' },
        { name: 'CRYO_PULSE',         filter: 'hue-rotate(195deg) saturate(420%) contrast(160%) brightness(92%)' },
        { name: 'ENTROPY_WAVE',       filter: 'grayscale(40%) contrast(280%) brightness(80%) saturate(300%)' },
        { name: 'PLASMA_LEAK',        filter: 'hue-rotate(50deg) saturate(700%) contrast(185%) invert(8%)' },
        { name: 'NEON_CORRUPTION',    filter: 'hue-rotate(110deg) saturate(800%) contrast(200%) brightness(68%)' },
        { name: 'ACID_PROTOCOL',      filter: 'hue-rotate(78deg) saturate(500%) contrast(220%) brightness(82%)' },
        { name: 'STATIC_BLEED',       filter: 'contrast(350%) saturate(120%) brightness(70%) hue-rotate(180deg)' },
        { name: 'DECAY_MATRIX',       filter: 'sepia(80%) hue-rotate(340deg) saturate(450%) contrast(195%)' },
        { name: 'OVERCLOCKED_RED',    filter: 'hue-rotate(358deg) saturate(650%) contrast(210%) brightness(75%)' },
        { name: 'TEMPORAL_GLITCH',    filter: 'invert(22%) hue-rotate(300deg) saturate(580%) contrast(240%)' },
        { name: 'CARBON_MELTDOWN',    filter: 'grayscale(70%) contrast(320%) brightness(60%) saturate(200%)' },
        { name: 'SHARD_PULSE',        filter: 'hue-rotate(170deg) saturate(380%) contrast(165%) invert(12%)' },
        { name: 'GHOST_PROTOCOL',     filter: 'saturate(50%) brightness(150%) contrast(250%) hue-rotate(210deg)' },
        { name: 'OMEGA_BREACH',       filter: 'hue-rotate(330deg) saturate(750%) contrast(220%) brightness(65%)' },
        { name: 'SILICON_BURN',       filter: 'sepia(100%) hue-rotate(10deg) saturate(500%) contrast(180%)' },
        { name: 'VOLTAGE_SPIKE',      filter: 'brightness(120%) contrast(230%) saturate(400%) hue-rotate(160deg)' },
        { name: 'DIGITAL_RUST',       filter: 'sepia(60%) hue-rotate(355deg) saturate(350%) contrast(155%)' },
        { name: 'FLUX_OVERLOAD',      filter: 'hue-rotate(60deg) saturate(900%) contrast(195%) brightness(70%)' },
        { name: 'MEMORY_LEAK',        filter: 'invert(28%) saturate(600%) hue-rotate(130deg) contrast(215%)' },
        { name: 'DARK_SYNTHESIS',     filter: 'brightness(45%) contrast(310%) saturate(700%) hue-rotate(295deg)' },
        { name: 'GLITCH_LAYER',       filter: 'saturate(1000%) hue-rotate(200deg) contrast(250%) brightness(60%)' },
        { name: 'NEON_PULSE',         filter: 'hue-rotate(120deg) saturate(850%) contrast(180%) brightness(88%)' },
        { name: 'CIRCUIT_MELT',       filter: 'hue-rotate(40deg) saturate(600%) contrast(200%) invert(15%)' },
        { name: 'PHANTOM_BURN',       filter: 'hue-rotate(280deg) saturate(700%) brightness(58%) contrast(260%)' },
        { name: 'CORE_RESONANCE',     filter: 'hue-rotate(155deg) saturate(450%) contrast(190%) brightness(80%)' }
    ];

    /**
     * Retorna um filtro de fusão interno aleatório do banco de 30 modificadores exclusivos.
     * Chamado de forma oculta durante o processamento visual da fusão.
     */
    function _getRandomFusionInternalFilter() {
        const idx = Math.floor(Math.random() * FUSION_INTERNAL_FILTER_DB.length);
        return FUSION_INTERNAL_FILTER_DB[idx];
    }




    let dropFilters = {
        rarity: 'all',   // all | common | epic | legendary | ancestral
        style: 'all',    // all | <nome do estilo>
        mode: 'all'      // all | free | premium
    };

    function toggleDropFiltersPanel() {
        const panel = document.getElementById('dropFiltersPanel');
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'flex' : 'none';
    }

    function _updateDropFilterActiveCount() {
        const count = (dropFilters.rarity !== 'all' ? 1 : 0) + (dropFilters.style !== 'all' ? 1 : 0) + (dropFilters.mode !== 'all' ? 1 : 0);
        const badge = document.getElementById('dropFilterActiveCount');
        if (!badge) return;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
        badge.innerText = String(count);
    }

    function setDropRarityFilter(rarity) {
        dropFilters.rarity = rarity;
        document.querySelectorAll('#dropRarityFilterTags .drop-filter-tag').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.rarity === rarity);
        });
        _updateDropFilterActiveCount();
        _applyDropModeVisibility();
    }

    function setDropStyleFilter(style) {
        dropFilters.style = style;
        document.querySelectorAll('#dropStyleFilterTags .drop-filter-tag').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.style === style);
        });
        _updateDropFilterActiveCount();
    }

    function setDropPoolFilter(mode) {
        dropFilters.mode = mode;
        document.querySelectorAll('.drop-filter-tags .drop-filter-tag[data-mode]').forEach(tag => {
            tag.classList.toggle('active', tag.dataset.mode === mode);
        });
        _updateDropFilterActiveCount();
        _applyDropModeVisibility();
    }

    // Esconde visualmente o ticket Free/Premium que não combina com o
    // filtro de MODO selecionado — evita clique acidental no pool errado.
    function _applyDropModeVisibility() {
        const btnFree = document.getElementById('btnFree');
        const btnPremium = document.getElementById('btnPremium');
        if (btnFree) btnFree.style.display = (dropFilters.mode === 'premium') ? 'none' : 'flex';
        if (btnPremium) btnPremium.style.display = (dropFilters.mode === 'free') ? 'none' : 'flex';
    }

    function renderDropStyleFilters() {
        const container = document.getElementById('dropStyleFilterTags');
        if (!container) return;
        const tags = ['<button type="button" class="drop-filter-tag active" data-style="all" onclick="setDropStyleFilter(\'all\')">TODOS</button>']
            .concat(DROP_STYLE_NAME_LIST.map(s =>
                `<button type="button" class="drop-filter-tag" data-style="${s}" onclick="setDropStyleFilter('${s}')">${s}</button>`
            ));
        container.innerHTML = tags.join('');
    }

    // Aplica o filtro de RARIDADE ao roll: se o resultado natural não bate
    // com o filtro selecionado, força o resultado dentro do subconjunto
    // permitido em vez de simplesmente descartar o drop. Retorna a
    // raridade final a ser usada por executeHardwareRoll.
    function _resolveFilteredRarity(naturalRarityKey, rarityRoll) {
        if (dropFilters.rarity === 'all') return naturalRarityKey;
        return dropFilters.rarity; // filtro de raridade força o resultado nessa faixa
    }

    function _resolveFilteredStyleIndex(naturalIndex) {
        if (dropFilters.style === 'all') return naturalIndex;
        const idx = DROP_STYLE_NAME_LIST.indexOf(dropFilters.style);
        return idx === -1 ? naturalIndex : idx;
    }

    // =========================================================
    // [ESCOPO 5_MECANICAS] TETO GLOBAL DE 500 CARTAS — BLINDAGEM CLIENT-SIDE
    // O teto de verdade é garantido no banco (trigger
    // verify_card_limit_and_lock() + LOCK TABLE EXCLUSIVE em
    // SQL_PATCH_5_MECANICAS.sql), que é a ÚNICA fonte de verdade contra
    // race conditions reais (dois cliques síncronos de usuários
    // diferentes). Esta checagem aqui no client é só uma camada de UX:
    // evita iniciar a animação de roll (1.2s+1.5s de SFX/TTS) quando já
    // sabemos de antemão que o INSERT vai ser rejeitado, e overlay de
    // "Terminal Overflow" sempre é a mesma função renderizada nos dois
    // casos (preflight aqui OU erro vindo do banco).
    // =========================================================
    async function _getActiveCardCountFromNetwork() {
        const { count, error } = await sb
            .from('cards')
            .select('id', { count: 'exact', head: true })
            .eq('is_purged', false);
        if (error) {
            console.error('_getActiveCardCountFromNetwork:', error.message);
            return null; // indisponível — não bloqueia o roll por falha de leitura
        }
        return count;
    }

    /**
     * Overlay temático de "Terminal Overflow" — cobre a tela inteira,
     * impede novos drops e empurra o usuário pra Fornalha (único jeito de
     * abrir espaço na rede: queimar ativos existentes). Usado tanto pelo
     * preflight de executeHardwareRoll quanto por qualquer outro módulo
     * que capture o erro customizado 'NETWORK_LIMIT_REACHED' do Postgres
     * (ex: claimAssetLogic em cards-inventory-db.js, ao tentar gravar o
     * card resgatado) — basta chamar window.renderNetworkLimitOverlay().
     */
    function renderNetworkLimitOverlay() {
        if (document.getElementById('networkLimitOverlay')) return; // já visível
        playSynthSound('shatter');
        speakPhrase(
            "Rede saturada. Teto de quinhentas cartas atingido. Use a Fornalha para liberar espaço.",
            "Network saturated. Five hundred card cap reached. Use the Furnace to free up space."
        );

        const overlay = document.createElement('div');
        overlay.id = 'networkLimitOverlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '10000',
            background: 'rgba(5, 0, 0, 0.96)', display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '16px', padding: '24px', textAlign: 'center',
            fontFamily: '"Space Mono", monospace'
        });

        overlay.innerHTML = `
            <div class="loading-glitch loading-glitch-cursor" data-text="[ TERMINAL_OVERFLOW ]" style="font-size:1.4rem; letter-spacing:4px; color:#ff0033;">[ TERMINAL_OVERFLOW ]</div>
            <div style="font-size:0.65rem; color:#ff003399; letter-spacing:2px; max-width:420px;">
                ${currentLang === 'PT'
                    ? 'TETO_GLOBAL_DA_REDE ATINGIDO: 500/500 CARTAS ATIVAS.<br>NENHUM NOVO DROP PODE SER MINTADO ATÉ A REDE LIBERAR ESPAÇO.'
                    : 'NETWORK_GLOBAL_CAP REACHED: 500/500 ACTIVE CARDS.<br>NO NEW DROP CAN BE MINTED UNTIL THE NETWORK FREES UP SPACE.'}
            </div>
            <div style="font-size:0.6rem; color:#aaaaaa; max-width:420px;">
                ${currentLang === 'PT'
                    ? 'Use a FORNALHA para queimar ativos existentes e abrir espaço na rede.'
                    : 'Use the FURNACE to burn existing assets and free up network space.'}
            </div>
            <button id="networkLimitGoFurnaceBtn" class="btn-action" style="border-color:#ff5500; color:#ff5500; margin-top:8px; padding:10px 24px;">
                ${currentLang === 'PT' ? '🔥 IR PARA A FORNALHA' : '🔥 GO TO FURNACE'}
            </button>
            <button id="networkLimitCloseBtn" class="btn-action" style="border-color:#555; color:#888; padding:8px 20px;">
                ${currentLang === 'PT' ? 'FECHAR' : 'CLOSE'}
            </button>
        `;

        document.body.appendChild(overlay);

        document.getElementById('networkLimitGoFurnaceBtn').addEventListener('click', () => {
            overlay.remove();
            toggleAlchemyPanel();
            setAlchemyMode('fornalha');
        });
        document.getElementById('networkLimitCloseBtn').addEventListener('click', () => overlay.remove());

        // Trava os botões de drop enquanto o overlay estiver de pé —
        // evita novos cliques de roll empilhando animações por baixo.
        const btnFree = document.getElementById('btnFree');
        const btnPremium = document.getElementById('btnPremium');
        if (btnFree) btnFree.classList.add('disabled');
        if (btnPremium) btnPremium.classList.add('disabled');
    }
    // Exposto globalmente — outros módulos (claimAssetLogic, fusion.js,
    // etc.) podem chamar window.renderNetworkLimitOverlay() ao capturar
    // 'NETWORK_LIMIT_REACHED' vindo de qualquer INSERT em `cards`.
    window.renderNetworkLimitOverlay = renderNetworkLimitOverlay;

    /**
     * Handler genérico pra erro customizado do Postgres. Qualquer chamada
     * Supabase (insert em `cards`) que dispare a trigger
     * verify_card_limit_and_lock() retorna error.message contendo
     * 'NETWORK_LIMIT_REACHED' — esta função centraliza a detecção pra não
     * espalhar string-matching por todos os módulos que fazem insert.
     * Retorna true se o erro era de teto de rede (e já tratou o overlay).
     */
    function handleSupabaseCardError(error) {
        if (!error) return false;
        const msg = (error.message || '') + ' ' + (error.details || '') + ' ' + (error.hint || '');
        if (msg.includes('NETWORK_LIMIT_REACHED')) {
            renderNetworkLimitOverlay();
            return true;
        }
        return false;
    }
    window.handleSupabaseCardError = handleSupabaseCardError;

    async function executeHardwareRoll(isPremium) {
        if (isRolling) return;
        // Garante que o pool de imagens foi carregado (lazy load — só na primeira chamada)
        await ensurePoolLoaded();

        // ── [ESCOPO 5_MECANICAS] PREFLIGHT DO TETO GLOBAL ──
        // Verifica o count ANTES de iniciar a animação/cobrar bumps.
        // A garantia real contra concorrência continua sendo a trigger no
        // banco (ver nota acima) — isto aqui só evita UX ruim (cobrar 50
        // bumps premium e animar 2.7s pra no final descobrir que a rede
        // está saturada).
        const activeCount = await _getActiveCardCountFromNetwork();
        if (activeCount !== null && activeCount >= 500) {
            renderNetworkLimitOverlay();
            return;
        }
        // ── [FILTRO CONDICIONAL] CALIBRAÇÃO DE TERMINAL ──────────────────
        // Se o jogador selecionou um estilo específico (dropFilters.style !== 'all'),
        // o drop forçará esse style_name — custo: 25 fragmentos de sucata.
        const _styleFilterActive = dropFilters.style && dropFilters.style !== 'all';
        if (_styleFilterActive) {
            const _scrapCost = 25;
            const _currentScrap = (currentUser.scrap_fragments ?? currentUser.scrapFragments ?? 0);
            if (_currentScrap < _scrapCost) {
                showCyberAlert('RECURSOS INSUFICIENTES', 'Recursos Insuficientes para Calibração de Terminal', 'error');
                return;
            }
            const _newScrap = _currentScrap - _scrapCost;
            currentUser.scrap_fragments = _newScrap;
            currentUser.scrapFragments  = _newScrap;
            const _scrapEl = document.getElementById('scrapFragmentsDisplay') || document.getElementById('scrapDisplay');
            if (_scrapEl) _scrapEl.innerText = _newScrap;
            if (currentUser.loggedIn && currentUser.id) {
                sb.from('profiles')
                    .update({ scrap_fragments: _newScrap })
                    .eq('id', currentUser.id)
                    .then(({ error: _scrapErr }) => {
                        if (_scrapErr) {
                            console.error('[DropFilter] Falha ao debitar fragmentos:', _scrapErr.message);
                            currentUser.scrap_fragments = _currentScrap;
                            currentUser.scrapFragments  = _currentScrap;
                            if (_scrapEl) _scrapEl.innerText = _currentScrap;
                            showCyberAlert('ERRO_DE_REDE', 'Falha ao debitar fragmentos. Tenta novamente.', 'error');
                        }
                    });
            }
        }
        // ─────────────────────────────────────────────────────────────────
        // PREMIUM_DROP_PASS: bloqueia imediatamente se deslogado
        if (isPremium && !currentUser.loggedIn) {
            showCyberAlert('ACESSO_NEGADO:', currentLang === 'PT'
                ? 'O PREMIUM_DROP_PASS requer autenticação de rede. Faça login para continuar.'
                : 'PREMIUM_DROP_PASS requires network authentication. Login to proceed.', 'error');
            return;
        }
        if (isPremium && currentUser.bumps < 50) { openDepositModal(); return; }
        if (isPremium) currentUser.bumps -= 50;

        isRolling = true; 
        activeAssetData = null;
        downloadBtn.style.display = "none"; 
        clearInterval(decayInterval);
        
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "MINTANDO_DADOS..." : "MINTING_DATA...";
        targetContainer.className = "target-box rolling"; 
        stabilityWrapper.style.display = "block";

        document.getElementById('btnFree').classList.add('disabled');
        document.getElementById('btnPremium').classList.add('disabled');

        const generatedId = "#" + Math.floor(100000 + Math.random() * 900000);
        metaId.innerText = generatedId;

        let tickTimes = 0;
        let tickInterval = setInterval(() => { 
            if(tickTimes < 10) { 
                playSynthSound('roll'); 
                tickTimes++; 
            } 
        }, 100);

        setTimeout(async () => {
            clearInterval(tickInterval);
            targetContainer.classList.remove("rolling");
            document.getElementById('btnFree').classList.remove('disabled');
            document.getElementById('btnPremium').classList.remove('disabled');

            // Aguarda o pool carregar (e esperar TODAS as imagens decodificarem)
            // antes de concluir que está vazio. ensurePoolLoaded() agora só
            // resolve depois que cada Image() do bucket já chamou onload/onerror,
            // então preloadedCanvases.length reflete a realidade do bucket.
            await ensurePoolLoaded();

            if (preloadedCanvases.length === 0) {
                isRolling = false;
                targetContainer.classList.remove("rolling");
                stabilityWrapper.style.display = "none";
                showCyberAlert('BUCKET VAZIO', 'Nenhuma imagem disponível no bucket high-res-assets. Suba ao menos uma imagem no Storage do Supabase para liberar os drops.', 'error');
                return;
            }
            const sourceIndex = Math.floor(Math.random() * preloadedCanvases.length);
            const sourceBuffer = preloadedCanvases[sourceIndex];
            const sourceBucketPath = preloadedCanvasPaths[sourceIndex];
            const bakedBuffer = document.createElement('canvas'); bakedBuffer.width = 600; bakedBuffer.height = 600;
            const bCtx = bakedBuffer.getContext('2d');

            let watermarkColor = "#ffffff"; 
            let rarityKey = "common"; 
            let rarityName = "COMUM"; 
            let rarityNameEN = "COMMON";
            let claimCost = 0;
            let filterStyle = "none"; 
            let styleName = "CYBER PUNK";
            let styleNameEN = "CYBER PUNK";

            let randRarity = Math.random();
            if (!isPremium && randRarity < 0.15) { shatterAsset(); isRolling = false; return; }

            const visualStylesPT = DROP_STYLE_NAME_LIST;
            const visualStylesEN = DROP_STYLE_NAME_LIST;
            // visualFilters is now resolved per-rarity from DROP_FILTER_DB
            // styleIndex is kept for backward compat but overridden below
            let styleIndex = _resolveFilteredStyleIndex(Math.floor(Math.random() * 6));

            // TAXAS EXACTAS: 1% ANCESTRAL, 1% LEGENDARY, 14% EPIC, 84% COMMON
            let rarityRoll = Math.random();
            const epicThreshold = networkOverloadActive
                ? Math.min(0.02 + 0.14 * NETWORK_OVERLOAD_EPIC_MULTIPLIER, 0.6)
                : 0.16;
            if (rarityRoll < 0.01) {
                rarityKey = "ancestral";
            } else if (rarityRoll < 0.02) {
                rarityKey = "legendary";
            } else if (rarityRoll < epicThreshold) {
                rarityKey = "epic";
            } else {
                rarityKey = "common";
            }

            // [ESCOPO 6] Filtro de RARIDADE_ALVO ativo — força o resultado
            // pra dentro da raridade escolhida pelo jogador, em vez do roll
            // natural acima (que continua rodando, só não decide o resultado
            // final se houver filtro).
            rarityKey = _resolveFilteredRarity(rarityKey, rarityRoll);

            rarityName   = rarityKey === "ancestral" ? "ANCESTRAL" : rarityKey === "legendary" ? "LENDÁRIO" : rarityKey === "epic" ? "ÉPICO" : "COMUM";
            rarityNameEN = rarityKey === "ancestral" ? "ANCESTRAL" : rarityKey === "legendary" ? "LEGENDARY" : rarityKey === "epic" ? "EPIC" : "COMMON";
            watermarkColor = rarityKey === "ancestral" ? "#ff007f" : rarityKey === "legendary" ? "#00ffff" : rarityKey === "epic" ? "#ffaa00" : "#ffffff";

            // Flash de tela Ancestral: rosa se sucesso
            if (rarityKey === "ancestral") {
                triggerAncestralFlash('#ff007f');
            }

            // Atualiza a cotação global do mercado em tempo real a cada drop
            updateMarketQuotes(rarityKey);

            if (rarityKey === "ancestral") {
                const variant = _getRandomDropVariant('ancestral');
                filterStyle = variant.filter;
                styleName   = variant.name;
                styleNameEN = variant.name;
                if(!isPremium) claimCost = 50;
            } else if (rarityKey !== "common") {
                const variant = _getRandomDropVariant(rarityKey);
                filterStyle = variant.filter;
                styleName = variant.name;
                styleNameEN = variant.name;
                if(!isPremium) claimCost = 50;
            } else {
                const variant = _getRandomDropVariant('common');
                filterStyle = variant.filter;
                styleName = variant.name;
                styleNameEN = variant.name;
            }
            // [FILTRO CONDICIONAL] Override de styleName quando calibração ativa
            if (dropFilters.style && dropFilters.style !== 'all') {
                const _forcedVariant = (DROP_FILTER_DB[rarityKey] || DROP_FILTER_DB.common)
                    .find(v => v.name === dropFilters.style);
                // Se o estilo existir na raridade sorteada, aplica;
                // caso contrário pega o mais próximo (primeiro do pool da raridade)
                if (_forcedVariant) {
                    filterStyle = _forcedVariant.filter;
                    styleName   = _forcedVariant.name;
                    styleNameEN = _forcedVariant.name;
                } else {
                    // Estilo não existe nessa raridade — usa o nome mas mantém filtro sorteado
                    styleName   = dropFilters.style;
                    styleNameEN = dropFilters.style;
                }
            }

            targetContainer.className = "target-box";
            targetContainer.classList.add(`card-${rarityKey}`);

            metaRarity.innerText = currentLang === 'PT' ? rarityName : rarityNameEN; 
            metaRarity.style.color = watermarkColor;
            metaStyle.innerText = currentLang === 'PT' ? styleName : styleNameEN; 
            metaOwner.innerText = currentUser.loggedIn ? currentUser.username : "RECRUTA";

            bCtx.filter = filterStyle; bCtx.drawImage(sourceBuffer, 0, 0, 600, 600); bCtx.filter = "none";
            bCtx.fillStyle = "rgba(0, 0, 0, 0.75)"; bCtx.fillRect(20, bakedBuffer.height - 52, 160, 36);
            bCtx.fillStyle = watermarkColor; bCtx.font = "bold 24px 'Space Mono'"; bCtx.fillText(generatedId, 30, bakedBuffer.height - 26);

            lastMintedBuffer = bakedBuffer;
            activeAssetData = { 
                id: generatedId, rarityType: rarityKey, rarityName: rarityName, rarityNameEN: rarityNameEN,
                styleName: styleName, styleNameEN: styleNameEN, creator: currentUser.loggedIn ? currentUser.username : "OG DROP", 
                registered: currentUser.loggedIn, exposed: false, forSale: false, price: 0, imgSrc: bakedBuffer.toDataURL('image/webp', 0.75), costToClaim: claimCost,
                // ── BUCKET high-res-assets: guarda o arquivo ORIGINAL sorteado
                // pra este card. É esse caminho (não o id do card) que
                // "Obter Item" usa pra gerar a Signed URL do HD verdadeiro.
                resolutions: { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: sourceBucketPath } } 
            };

            // BUGFIX (feed global com lixo/efêmero): este card ainda NÃO foi
            // resgatado (pode shatterar em 10s se não for reivindicado — ver
            // shatterAsset()). Publicar isso no feed PÚBLICO/real
            // (eventos_globais) faria a rede inteira ver mutações que nunca
            // chegaram a existir de fato, e exigiria desfazer via DELETE em
            // tempo real se a pessoa não resgatasse a tempo. Agora só entram
            // no feed global cards REAIS e definitivos: resgatados
            // (claimAssetLogic → pushFeedCard) ou fundidos com sucesso
            // (pushFeedCard no resultado da fusão). A pré-visualização local
            // do drop continua funcionando normalmente — só não é mais
            // transmitida pra rede antes de ser consolidada.

            downloadBtn.style.display = "block";
            downloadBtn.innerText = claimCost > 0 ? 
                (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) : 
                (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            
            document.getElementById('status-text').innerText = currentLang === 'PT' ? "MUTAÇÃO_ESTÁVEL" : "MUTATION_STABLE";
            
            playSynthSound('success'); 
            speakPhrase("Mutação bem sucedida! Resgate o ativo.", "Mutation successful! Claim the asset.");

            // [ESCOPO 6] BUGFIX: o cronômetro de shatter (startStabilityDecay)
            // estava correndo SEMPRE, inclusive em rolls Premium — então um
            // PREMIUM_DROP_PASS, que deveria ser "100% SECURE // GARANTIA DE
            // COMPILAÇÃO" / entrega garantida e imediata, ainda corria risco
            // de ser destruído se o jogador demorasse mais de 10s pra clicar
            // em resgatar. Agora Premium pula o cronômetro por completo:
            // mostra o badge de resgate garantido e nunca chama shatterAsset().
            const premiumBadge = document.getElementById('premiumInstantBadge');
            if (isPremium) {
                stabilityWrapper.style.display = "none";
                if (premiumBadge) premiumBadge.style.display = "block";
            } else {
                if (premiumBadge) premiumBadge.style.display = "none";
                startStabilityDecay();
            }
            isRolling = false;
        }, 1200);
    }

    function startStabilityDecay() {
        let timeLeft = 10.0; clearInterval(decayInterval);
        decayInterval = setInterval(() => {
            timeLeft -= 0.1;
            if (timeLeft <= 0) { 
                clearInterval(decayInterval); 
                shatterAsset(); 
                return;
            }
            stabilityBar.style.width = `${(timeLeft / 10) * 100}%`;
            stabilityLabel.innerText = currentLang === 'PT' ? 
                `EXPIRA EM: ${timeLeft.toFixed(1)}s [CONSOLIDE ANTES DO COLLAPSE]` : 
                `EXPIRES IN: ${timeLeft.toFixed(1)}s [CONSOLIDATE BEFORE COLLAPSE]`;
        }, 100);
    }

    function shatterAsset() {
        playSynthSound('shatter');
        speakPhrase("Mutação destruída.", "Mutation destroyed.");
        // Não precisa mais limpar `globalFeed` aqui — o drop nunca chegou a
        // ser publicado nele (ver nota no fim de claimAssetLogic's preview,
        // acima), já que só cards efetivamente resgatados/fundidos entram
        // no feed público agora.

        downloadBtn.style.display = "none";
        targetContainer.className = "target-box shattering";
        const premiumBadgeEl = document.getElementById('premiumInstantBadge');
        if (premiumBadgeEl) premiumBadgeEl.style.display = "none";
        
        stabilityLabel.innerText = currentLang === 'PT' ? "MUTAÇÃO CORROMPIDA // COLLAPSE" : "MUTATION CORRUPTED // COLLAPSE"; 
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "SISTEMA_AUTODESTRUIDO" : "SYSTEM_SELF_DESTRUCTED";
        
        lastMintedBuffer = null; 
        activeAssetData = null;
        setTimeout(() => { targetContainer.classList.remove("shattering"); }, 800);
    }

    // claimAssetLogic agora vem da Parte 2 (Supabase), no final do arquivo.

    function buildStoriesMarquee() {
        const container = document.getElementById('storiesContainer');
        if(!container) return;
        container.innerHTML = '';

        // BUGFIX (perfis fantasmas): enquanto o Supabase ainda não respondeu
        // a primeira leitura de `eventos_globais`, mostramos um aviso de
        // terminal em vez de qualquer card inventado/estático.
        if (globalFeedLoading) {
            container.innerHTML = '<div class="feed-loading-notice">[ CARREGANDO DADOS CENTRAIS DO NÓ // SINCRONIZANDO COM A REDE... ]</div>';
            return;
        }

        if (globalFeed.length === 0) {
            container.innerHTML = '<div class="feed-loading-notice">[ REDE SEM DROPS AINDA // NENHUM EVENTO REGISTRADO ]</div>';
            return;
        }
        
        const displayItems = globalFeed.length > 4 ? [...globalFeed, ...globalFeed] : globalFeed;

        displayItems.forEach((a) => {
            const node = document.createElement('div');
            // [ESCOPO 4] Cards purgados (fundidos/destruídos) ganham a classe
            // story-node--purged, que ativa via CSS o avatar dessaturado +
            // borda vermelha pulsante + selo "✕"/DETONADA sobre a miniatura
            // (ver .story-node--purged no CSS). O card continua passando
            // normalmente na esteira — só fica visualmente marcado.
            node.className = a.isPurged ? 'story-node story-node--purged' : 'story-node';
            node.addEventListener('click', () => openInspectModal(a));
            node.innerHTML = `
                <div class="story-avatar-wrapper rare-${a.rarityType}"><img src="${a.imgSrc}" loading="lazy"></div>
                <div class="story-meta">${a.creator}<br><b>${a.id}</b>${a.isPurged ? `<br><span style="color:#ff0033;">${currentLang === 'PT' ? 'DETONADA' : 'PURGED'}</span>` : ''}</div>
            `;
            container.appendChild(node);
        });

        // Reaplica o drag-to-scroll sempre que o feed é repintado (re-render
        // troca o innerHTML, mas o container #storiesContainer em si nunca é
        // recriado — o guard `dataset.dragInit` em initStoriesDragScroll
        // evita re-ligar os listeners do zero a cada chamada).
        initStoriesDragScroll();
    }

    // =========================================================
    // DRAG-TO-SCROLL no feed MUTAÇÕES_REDE (clique-e-arrasta)
    // =========================================================
    // Permite ao usuário pausar o marquee automático e "puxar" os cards
    // manualmente pra frente/trás (mouse + touch), igual a um carrossel
    // nativo. Resolve junto o bug do onClick abrindo o card ERRADO: como
    // o marquee desloca a posição dos cards continuamente, sem essa
    // distinção um simples toque-e-arraste (comum em touch, ao tentar
    // rolar o feed) acabava soltando o dedo sobre um card DIFERENTE
    // daquele que estava embaixo do dedo no início do gesto — e o
    // navegador disparava `click` nesse card errado, abrindo o modal
    // de inspeção do item errado. A correção mede a distância arrastada
    // e, se ultrapassar um pequeno limiar, intercepta e cancela o
    // `click` (fase de captura, antes de chegar no listener do
    // story-node) — só permite o `click` passar quando foi de fato um
    // toque/clique parado, garantindo que o card aberto é sempre
    // exatamente o que o usuário pretendia.
    function initStoriesDragScroll() {
        const container = document.getElementById('storiesContainer');
        if (!container || container.dataset.dragInit) return;
        container.dataset.dragInit = '1';

        const DRAG_THRESHOLD_PX = 4;
        let isDown = false;
        let dragged = false;
        let startX = 0;
        let startOffset = 0;
        let resumeTimer = null;

        function getCurrentTranslateX(el) {
            const t = window.getComputedStyle(el).transform;
            if (!t || t === 'none') return 0;
            const m = t.match(/matrix.*\((.+)\)/);
            if (!m) return 0;
            const parts = m[1].split(',').map(parseFloat);
            return parts.length === 16 ? parts[12] : parts[4]; // matrix3d vs matrix
        }

        function pointerDown(clientX) {
            clearTimeout(resumeTimer);
            isDown = true;
            dragged = false;
            startX = clientX;
            startOffset = getCurrentTranslateX(container);
            // Pausa o marquee automático (mesma classe usada pelo hover —
            // ver pauseMarquee) e "congela" os cards na posição atual antes
            // de assumir o controle manual via transform inline.
            container.classList.remove('animated');
            container.style.transition = 'none';
            container.style.transform = `translate3d(${startOffset}px, 0, 0)`;
            container.style.cursor = 'grabbing';
        }

        function pointerMove(clientX) {
            if (!isDown) return;
            const delta = clientX - startX;
            if (Math.abs(delta) > DRAG_THRESHOLD_PX) dragged = true;
            container.style.transform = `translate3d(${startOffset + delta}px, 0, 0)`;
        }

        function pointerUp() {
            if (!isDown) return;
            isDown = false;
            container.style.cursor = '';
            // Não houve arraste de verdade (foi um clique parado): libera o
            // `click` normalmente — o listener do container abaixo só
            // intercepta quando `dragged` for true.
            // Retoma o marquee automático sozinho após uma pausa de
            // inatividade, pra ele não ficar travado pra sempre em telas
            // touch (que não disparam mouseleave/resumeMarquee).
            resumeTimer = setTimeout(() => { resumeMarquee(); }, 2500);
        }

        container.addEventListener('mousedown', (e) => { pointerDown(e.clientX); e.preventDefault(); });
        window.addEventListener('mousemove', (e) => pointerMove(e.clientX));
        window.addEventListener('mouseup', pointerUp);

        container.addEventListener('touchstart', (e) => pointerDown(e.touches[0].clientX), { passive: true });
        container.addEventListener('touchmove', (e) => pointerMove(e.touches[0].clientX), { passive: true });
        container.addEventListener('touchend', pointerUp);

        // Fase de CAPTURA: roda antes do listener de click de cada
        // story-node, então consegue suprimir o clique-fantasma pós-drag
        // sem precisar tocar/alterar o listener individual de cada card.
        container.addEventListener('click', (e) => {
            if (dragged) {
                e.stopPropagation();
                e.preventDefault();
                dragged = false;
            }
        }, true);
    }

    function renderVaultGrid() {
        const grid = document.getElementById('albumGrid'); if(!grid) return;
        const freshGrid = grid.cloneNode(false);
        grid.parentNode.replaceChild(freshGrid, grid);
        const g = document.getElementById('albumGrid');

        document.getElementById('vault-count-badge').innerText = `${savedAssets.length} ATIVOS`;

        const filtered = vaultFilter === 'all' ? savedAssets : savedAssets.filter(a => a.rarityType === vaultFilter);
        const pageItems = filtered.slice(vaultPage * PAGE_SIZE, (vaultPage + 1) * PAGE_SIZE);

        if(filtered.length === 0) { g.innerHTML = '<div class="empty-vault-notice">NENHUM ATIVO NESTA CATEGORIA.</div>'; renderPagination('vaultPagination',0,0,()=>{}); return; }

        pageItems.forEach((a) => {
            const index = savedAssets.indexOf(a);
            const card = document.createElement('div');
            // [ESCOPO 4] Cards purgados ganham a classe is-purged (chamas +
            // selo PURGED/DETONADA via CSS) e --purge-label conforme idioma.
            card.className = `album-card rare-${a.rarityType}${a.isPurged ? ' is-purged' : ''}`;
            if (a.isPurged) card.style.setProperty('--purge-label', currentLang === 'PT' ? '"DETONADA"' : '"PURGED"');
            applyCardMotionAttrs(card, a);
            card.dataset.vaultIndex = index;
            const custodyBadge = a.isListed ? `<div style="position:absolute;top:-5px;left:-5px;background:#ff0044;color:#fff;font-size:0.5rem;padding:2px 6px;font-weight:bold;z-index:5;box-shadow:0 0 8px #ff0044;">🔒 EM CUSTÓDIA</div>` : '';

            // Badge Web3: indicador discreto se card tem proveniência
            const prov = a.provenance;
            const web3Badge = prov && !a.isTokenized
                ? `<div class="card-provenance-strip" title="Hash: ${prov.hash} | ${new Date(prov.timestamp).toLocaleString('pt-BR')}">
                       <span class="provenance-hash">${prov.hash}</span>
                       <span class="provenance-dot">⬡</span>
                   </div>`
                : prov && a.isTokenized
                ? `<div class="card-provenance-strip tokenized-strip" title="NFT Tokenizado">
                       <span class="provenance-hash">${prov.hash}</span>
                       <span class="provenance-dot" style="color:#00ff66;">✓ NFT</span>
                   </div>`
                : '';
            card.innerHTML = `
                ${custodyBadge}
                <div class="album-preview-wrapper"><img src="${a.imgSrc}" draggable="false" loading="lazy"></div>
                ${a.forSale ? `<div class="market-badge">${a.price} B$</div>` : ''}
                <div class="album-meta">
                    <div class="album-id">${a.id}</div>
                    <div class="album-rarity" style="color:${a.rarityType==='ancestral'?'#ff007f':a.rarityType==='legendary'?'#00ffff':a.rarityType==='epic'?'#ffaa00':'#aaaaaa'}">${currentLang === 'PT' ? a.rarityName : a.rarityNameEN}</div>
                </div>
                ${web3Badge}
                <div class="card-actions">
                    ${a.isPurged ? `<div style="font-size:0.5rem;color:#ff0033;text-align:center;padding:6px 0;">// ATIVO DETONADO — SOMENTE INSPEÇÃO //</div>` : `
                    <button class="btn-action btn-expose" data-action="expose" data-idx="${index}">${a.exposed ? '⭐ SAIR DA VITRINE' : '📁 EXPOR NA VITRINE'}</button>
                    ${a.forSale
                        ? `<button class="btn-action btn-sell" data-action="unlist" data-idx="${index}" style="border-color:#ff0044;color:#ff0044;">✕ REMOVER VENDA</button>`
                        : `<button class="btn-action btn-sell" data-action="sell" data-idx="${index}" style="border-color:${a.exposed?'#555':'#ffaa00'};color:${a.exposed?'#555':'#ffaa00'};${a.exposed?'cursor:not-allowed;opacity:0.5;':''}" ${a.exposed?'disabled title="Retire da vitrine antes de vender"':''}>💵 VENDER ATIVO</button>`
                    }
                    <button class="btn-action btn-gift" data-action="gift" data-idx="${index}" style="border-color:${(a.exposed||a.forSale)?'#555':'#ff00ff'};color:${(a.exposed||a.forSale)?'#555':'#ff00ff'};${(a.exposed||a.forSale)?'cursor:not-allowed;opacity:0.5;':''}" ${(a.exposed||a.forSale)?'disabled title="Card indisponível para presente (exposto ou listado)"':''}>🎁 PRESENTEAR</button>
                    `}
                    <button class="btn-action btn-dl"     data-action="download" data-idx="${index}">Obter Item 📥</button>
                </div>
            `;
            card.querySelector('.album-preview-wrapper').addEventListener('click', () => {
                openInspectModal(savedAssets[parseInt(card.dataset.vaultIndex, 10)]);
            });
            card.querySelector('.card-actions').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const idx = parseInt(btn.dataset.idx, 10);
                const action = btn.dataset.action;
                if (action === 'expose')    toggleExposeAsset(idx);
                else if (action === 'sell')   marketListPrompt(idx);
                else if (action === 'unlist') unlistVaultCard(idx);
                else if (action === 'gift')   giftAssetPrompt(idx);
                else if (action === 'download') downloadVaultAsset(idx);
            });
            g.appendChild(card);
        });

        renderPagination('vaultPagination', filtered.length, vaultPage, (p) => { vaultPage = p; renderVaultGrid(); });
    }

    // toggleExposeAsset agora vem da Parte 2 (Supabase), no final do arquivo.

    async function marketListPrompt(index) {
        if (savedAssets[index].isPurged) {
            showCyberAlert('CARD_DETONADO', 'Cards detonados (purged) não podem ser listados.', 'error');
            return;
        }
        if (savedAssets[index].isListed) {
            playSynthSound('shatter');
            showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card já está em custódia no mercado. Remove o anúncio primeiro.', 'error');
            return;
        }
        const asset = savedAssets[index];
        const suggested = asset.price > 0 ? asset.price : (asset.rarityType === 'ancestral' ? 5000 : asset.rarityType === 'legendary' ? 1500 : asset.rarityType === 'epic' ? 500 : 100);

        // Remove painel anterior se existir
        const oldPanel = document.getElementById('inlinePricePanel');
        if (oldPanel) oldPanel.remove();

        const card = document.querySelector(`[data-vault-index="${index}"]`);
        if (!card) return;

        const panel = document.createElement('div');
        panel.id = 'inlinePricePanel';
        panel.className = 'inline-price-panel';
        panel.innerHTML = `
            <div class="ipp-title">set_price ${asset.id} [${asset.rarityType.toUpperCase()}]</div>
            <div class="ipp-prompt-row">
                <span class="ipp-prefix">&gt;</span>
                <input id="ippInput" class="ipp-input" type="number" min="1" max="999999" value="${suggested}" placeholder="valor...">
                <span class="ipp-unit">B$</span>
            </div>
            <div class="ipp-actions">
                <button class="ipp-confirm-btn" onclick="confirmMarketList(${index})">LISTAR</button>
                <button class="ipp-cancel-btn" onclick="document.getElementById('inlinePricePanel').remove()">CANCELAR</button>
            </div>
        `;

        card.appendChild(panel);
        setTimeout(() => panel.classList.add('ipp-visible'), 10);
        document.getElementById('ippInput').focus();
    }

    async function confirmMarketList(index) {
        const input = document.getElementById('ippInput');
        if (!input) return;
        const parsed = parseInt(input.value);
        if (isNaN(parsed) || parsed <= 0) { showCyberAlert('ERRO DE INPUT', 'Valor de venda inválido. Insere um número positivo.', 'error'); return; }

        const panel = document.getElementById('inlinePricePanel');
        if (panel) panel.remove();

        const ok = await listCardOnMarket(savedAssets[index], parsed);
        if (!ok) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao listar o card no mercado. Tenta novamente.', 'error');
            return;
        }

        pushLedger(`${currentUser.username} listou o card ${savedAssets[index].id} [${savedAssets[index].rarityNameEN}] por ${parsed} B$`);
        renderVaultGrid();
    }

    // [ESCOPO 5] Remove venda diretamente do cofre (sem prompt, 1 clique)
    async function unlistVaultCard(index) {
        const asset = savedAssets[index];
        if (!asset) return;
        const ok = await unlistCardFromMarket(asset);
        if (!ok) { showCyberAlert('ERRO_DE_REDE', 'Falha ao remover o anúncio. Tenta novamente.', 'error'); return; }
        asset.forSale = false; asset.isListed = false; asset.price = 0;
        playSynthSound('success');
        showCyberAlert('✓ ANÚNCIO REMOVIDO', `Card <b>${asset.id}</b> retirado do mercado e devolvido ao cofre.`, 'success');
        renderVaultGrid();
    }


    async function giftAssetPrompt(index) {
        const giftedCard = savedAssets[index];
        if (!giftedCard) return;

        // [ESCOPO 2] Cards expostos na Vitrine ou já listados para troca
        // são intocáveis — nem presente, nem venda, até serem retirados.
        if (giftedCard.exposed) {
            showCyberAlert('CARD_BLOQUEADO', 'Este card está exposto na Vitrine do Perfil. Remova-o da vitrine antes de presentear.', 'warn');
            return;
        }
        if (giftedCard.forSale || giftedCard.isListed) {
            showCyberAlert('CARD_BLOQUEADO', 'Este card está listado no mercado. Remova o anúncio antes de presentear.', 'warn');
            return;
        }
        if (giftedCard.isPurged) {
            showCyberAlert('CARD_DETONADO', 'Cards detonados (purged) não podem ser transferidos.', 'error');
            return;
        }

        const rawInput = prompt("Digite o @username exato do destinatário da rede (Ex: @cyber_k1ng):");
        if (!rawInput) return;

        // Validação rígida: @ obrigatório, 3-20 chars após o @, só
        // letras/números/underscore (mesmo padrão de validateUsername).
        const targetUser = rawInput.trim();
        const STRICT_USERNAME_RE = /^@[a-zA-Z0-9_]{3,20}$/;
        if (!STRICT_USERNAME_RE.test(targetUser)) {
            showCyberAlert('FORMATO INVÁLIDO', 'Use @ seguido de 3 a 20 letras, números ou _ (ex: @cyber_k1ng).', 'error');
            return;
        }
        if (targetUser.toLowerCase() === currentUser.username.toLowerCase()) {
            showCyberAlert('OPERAÇÃO INVÁLIDA', 'Não é possível presentear a si mesmo.', 'error');
            return;
        }

        const targetProfile = await fetchProfileByUsername(targetUser);
        if (!targetProfile) {
            showCyberAlert('ERRO_REDE', 'Esse nó de usuário não existe ou está desconectado.', 'error'); return;
        }
        if (!giftedCard._dbId) {
            showCyberAlert('ERRO', 'Card sem registro remoto válido. Recarregue o cofre e tente novamente.', 'error'); return;
        }

        // ── RPC ATÔMICA enviar_presente: valida posse + bloqueios, troca o
        // dono (id_usuario) e grava o registro em `presentes` numa única
        // transação no servidor. Substitui o fluxo antigo (insert de cópia
        // + delete do original), que não era atômico e podia duplicar o
        // card caso o delete falhasse depois do insert ter sido bem-sucedido.
        const { data: presenteId, error } = await sb.rpc('enviar_presente', {
            p_remetente_id: currentUser.id,
            p_remetente_username: currentUser.username,
            p_destinatario_id: targetProfile.id,
            p_destinatario_username: targetProfile.username,
            p_card_id: giftedCard._dbId,
            p_card_display_id: giftedCard.id,
            p_mensagem: null
        });

        if (error) {
            console.error('enviar_presente:', error.message);
            showCyberAlert('ERRO_DE_REDE', 'Falha ao transferir o card. Tenta novamente.', 'error');
            return;
        }

        savedAssets.splice(index, 1);

        // Efeito sonoro de presente
        playSynthSound('success');
        setTimeout(() => playSynthSound('success'), 200);

        // TTS — aviso de presente enviado
        speakPhrase("Presente enviado com sucesso. Lootbox entregue.", "New Lootbox Detected. Gift delivered successfully.");

        // Alerta cyber customizado
        showCyberAlert(
            '🎁 LOOTBOX ENTREGUE',
            `Card <b>${giftedCard.id}</b> [${giftedCard.rarityNameEN}] foi transferido para <b>${targetUser}</b>.<br><small style="color:#666;">O destinatário receberá o alerta ao abrir o cofre.</small>`,
            'success'
        );

        pushLedger(`${currentUser.username} presenteou ${targetUser} com o card ${giftedCard.id} [${giftedCard.rarityNameEN}]`);
        renderVaultGrid();
    }

    // =========================================================
    // [ESCOPO 1] CAIXA DE PRESENTE FLUTUANTE — receiver-side
    // Consulta a tabela `presentes` por linhas pendentes destinadas ao
    // usuário logado. Se houver alguma, mostra o FAB com badge luminoso
    // e ativa o efeito de glitch de tela. Chamado no login e refrescado
    // por Realtime (ver initGiftRealtime).
    // =========================================================
    let pendingGiftsCache = [];

    async function refreshPendingGifts() {
        if (!currentUser.loggedIn || !currentUser.id) {
            _setGiftFabState([]);
            return;
        }
        const { data, error } = await sb.from('presentes')
            .select('id, remetente_id, remetente_username, card_id, card_display_id, card_snapshot, mensagem, created_at')
            .eq('destinatario_id', currentUser.id)
            .eq('status', 'pendente')
            .order('created_at', { ascending: false });
        if (error) { console.error('refreshPendingGifts:', error.message); return; }
        pendingGiftsCache = data || [];
        _setGiftFabState(pendingGiftsCache);
    }

