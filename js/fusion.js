// =========================================================
// dr0p_station — MÓDULO: fusion.js
// FUSÃO — painéis de alquimia/fornalha e renderização do card fundido
//
// Parte 9 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

    function toggleAlchemyPanel() {
        const panel = document.getElementById('alchemyPanel'); if (!panel) return;
        if (panel.style.display === 'none' || !panel.style.display) {
            if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', currentLang === 'PT' ? 'Precisas de estar logado para aceder ao laboratório de Alquimia.' : 'Login required to access the Alchemy Lab.', 'error'); return; }
            panel.style.display = 'block';
            setAlchemyMode('menu');
        } else {
            panel.style.display = 'none';
        }
    }

    /**
     * Gerencia a navegação entre as telas da Central de Alquimia:
     * 'menu' (escolha de protocolo), 'fusao' (modo padrão) e 'fornalha' (alto risco).
     */
    function setAlchemyMode(mode) {
        _alchMode = mode;
        const menuView = document.getElementById('alchMenuView');
        const fusaoView = document.getElementById('alchFusaoView');
        const fornalhaView = document.getElementById('alchFornalhaView');
        if (menuView) menuView.style.display = mode === 'menu' ? 'block' : 'none';
        if (fusaoView) fusaoView.style.display = mode === 'fusao' ? 'block' : 'none';
        if (fornalhaView) fornalhaView.style.display = mode === 'fornalha' ? 'block' : 'none';

        if (mode === 'fusao') {
            _alchSelected = { alpha: null, beta: null };
            openAlchemyPanel();
        } else if (mode === 'fornalha') {
            _furnSelected = [];
            openFurnacePanel();
        }
    }

    function openAlchemyPanel() {
        // Sincroniza os <select> ocultos (mantidos para compatibilidade com fuseCards())
        ['fuseCard1','fuseCard2'].forEach((sid, si) => {
            const sel = document.getElementById(sid); if (!sel) return;
            sel.innerHTML = `<option value="">-- CARD ${si+1} --</option>`;
            savedAssets.forEach(a => {
                if (a.isListed) return;
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.innerText = `${a.id} [${a.rarityNameEN}] ${a.styleName}`;
                sel.appendChild(opt);
            });
        });

        _renderAlchGallery();
        _updateAlchPreviews();
        previewAlchemy();
    }

    /** Cor neon por raridade */
    function _rarityColor(rt) {
        return rt === 'ancestral' ? '#ff007f' : rt === 'legendary' ? '#00ffff' : rt === 'epic' ? '#ffaa00' : '#aaaaaa';
    }

    /** Renderiza a galeria de miniaturas no painel de alquimia */
    function _renderAlchGallery() {
        const grid = document.getElementById('alchGalleryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const eligible = savedAssets.filter(a => !a.isListed);
        if (eligible.length === 0) {
            grid.innerHTML = '<div style="color:#ff00ff44; font-size:0.55rem; padding:8px; grid-column:1/-1;">Nenhum card disponível para fusão.</div>';
            return;
        }

        eligible.forEach(card => {
            const thumb = document.createElement('div');
            thumb.className = 'alch-thumb';
            thumb.dataset.id = card.id;
            if (card.isLocked) thumb.classList.add('locked-in-contract');

            // Bordas de seleção ativas
            if (_alchSelected.alpha && _alchSelected.alpha.id === card.id) thumb.classList.add('selected-alpha');
            if (_alchSelected.beta  && _alchSelected.beta.id  === card.id) thumb.classList.add('selected-beta');

            const rarColor = _rarityColor(card.rarityType);
            thumb.innerHTML = `
                <img src="${card.imgSrc}" alt="${card.id}">
                <div class="alch-thumb-rarity" style="color:${rarColor};">${(card.rarityNameEN || 'CMN').slice(0,3)}</div>
            `;

            thumb.addEventListener('click', () => _alchThumbClick(card));
            grid.appendChild(thumb);
        });
    }

    /**
     * Lógica de seleção ao clicar num thumb:
     * - Primeiro clique livre → ALPHA (rosa)
     * - Segundo clique (card diferente) → BETA (ciano)
     * - Clicar no mesmo card que já está selecionado → deseleciona esse slot
     * - Se ambos estão cheios e clica num novo → substitui ALPHA e move ALPHA atual para BETA
     */
    function _alchThumbClick(card) {
        if (_alchSelected.alpha && _alchSelected.alpha.id === card.id) {
            // Deseleciona alpha
            _alchSelected.alpha = null;
        } else if (_alchSelected.beta && _alchSelected.beta.id === card.id) {
            // Deseleciona beta
            _alchSelected.beta = null;
        } else if (!_alchSelected.alpha) {
            _alchSelected.alpha = card;
        } else if (!_alchSelected.beta) {
            if (_alchSelected.alpha.id === card.id) return; // mesmo card, ignora
            _alchSelected.beta = card;
        } else {
            // Ambos cheios: substitui alpha, mantém beta
            _alchSelected.alpha = card;
            if (_alchSelected.beta && _alchSelected.beta.id === card.id) _alchSelected.beta = null;
        }

        // Sincroniza <select> ocultos
        const s1 = document.getElementById('fuseCard1');
        const s2 = document.getElementById('fuseCard2');
        if (s1) s1.value = _alchSelected.alpha ? _alchSelected.alpha.id : '';
        if (s2) s2.value = _alchSelected.beta  ? _alchSelected.beta.id  : '';

        _renderAlchGallery();
        _updateAlchPreviews();
        previewAlchemy();
    }

    /** Atualiza os slots de preview (imagem + nome) */
    function _updateAlchPreviews() {
        const p1 = document.getElementById('previewSlot1');
        const p2 = document.getElementById('previewSlot2');
        const n1 = document.getElementById('alchSlotName1');
        const n2 = document.getElementById('alchSlotName2');

        if (p1) {
            if (_alchSelected.alpha) {
                const c = _alchSelected.alpha;
                const rc = _rarityColor(c.rarityType);
                p1.innerHTML = `<img src="${c.imgSrc}" style="border:2px solid ${rc};">`;
                if (n1) n1.innerText = `${c.id} [${c.rarityNameEN}]`;
                if (n1) n1.style.color = rc;
            } else {
                p1.innerHTML = '<div class="alch-empty-slot">⚗<span>ALPHA VAZIO</span></div>';
                if (n1) { n1.innerText = '—'; n1.style.color = '#ff00ff44'; }
            }
        }
        if (p2) {
            if (_alchSelected.beta) {
                const c = _alchSelected.beta;
                const rc = _rarityColor(c.rarityType);
                p2.innerHTML = `<img src="${c.imgSrc}" style="border:2px solid ${rc};">`;
                if (n2) n2.innerText = `${c.id} [${c.rarityNameEN}]`;
                if (n2) n2.style.color = rc;
            } else {
                p2.innerHTML = '<div class="alch-empty-slot">⚗<span>BETA VAZIO</span></div>';
                if (n2) { n2.innerText = '—'; n2.style.color = '#ff00ff44'; }
            }
        }
    }

    function previewAlchemy() {
        const id1 = _alchSelected.alpha ? _alchSelected.alpha.id : '';
        const id2 = _alchSelected.beta  ? _alchSelected.beta.id  : '';
        const probBox = document.getElementById('alchProbBox');

        const c1 = _alchSelected.alpha;
        const c2 = _alchSelected.beta;

        if (!c1 || !c2 || id1 === id2) { if (probBox) probBox.style.display = 'none'; return; }

        const score = (c) => c.rarityType === 'ancestral' ? 4 : c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(c1) + score(c2);
        let ps, pb, pc;
        if (total >= 7)      { ps = 80; pb = 8;  pc = 12; }
        else if (total >= 6) { ps = 70; pb = 10; pc = 20; }
        else if (total >= 4) { ps = 45; pb = 15; pc = 40; }
        else if (total >= 3) { ps = 25; pb = 20; pc = 55; }
        else                 { ps = 10; pb = 25; pc = 65; }

        if (probBox) probBox.style.display = 'block';
        document.getElementById('probSuccess').innerText = `${ps}%`;
        document.getElementById('probBreak').innerText   = `${pb}%`;
        document.getElementById('probCommon').innerText  = `${pc}%`;
    }

    // =========================================================
    // FORNALHA DE SOBRECARGA — MODO DE ALTO RISCO (até 3 cards)
    // 80% DESTRUIÇÃO TOTAL (delete no Supabase) / 20% MUTAÇÃO MÁXIMA
    // (queima os originais e gera 1 card novo de alta raridade)
    // =========================================================

    function openFurnacePanel() {
        _renderFurnGallery();
        _updateFurnPreview();
    }

    /** Renderiza a galeria de miniaturas no painel da Fornalha (seleção múltipla, máx 3) */
    function _renderFurnGallery() {
        const grid = document.getElementById('furnGalleryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        const eligible = savedAssets.filter(a => !a.isListed);
        if (eligible.length === 0) {
            grid.innerHTML = '<div style="color:#ff550044; font-size:0.55rem; padding:8px; grid-column:1/-1;">Nenhum ativo disponível para a Fornalha.</div>';
            return;
        }

        eligible.forEach(card => {
            const thumb = document.createElement('div');
            thumb.className = 'furn-thumb';
            thumb.dataset.id = card.id;
            if (card.isLocked) thumb.classList.add('locked-in-contract');
            if (_furnSelected.some(c => c.id === card.id)) thumb.classList.add('selected');

            const rarColor = _rarityColor(card.rarityType);
            thumb.innerHTML = `
                <img src="${card.imgSrc}" alt="${card.id}">
                <div class="alch-thumb-rarity" style="color:${rarColor};">${(card.rarityNameEN || 'CMN').slice(0,3)}</div>
            `;

            thumb.addEventListener('click', () => _furnThumbClick(card));
            grid.appendChild(thumb);
        });
    }

    /**
     * Lógica de seleção na Fornalha: clique alterna o card dentro/fora de
     * _furnSelected, com limite de 3 cards simultâneos.
     */
    function _furnThumbClick(card) {
        const idx = _furnSelected.findIndex(c => c.id === card.id);
        if (idx >= 0) {
            _furnSelected.splice(idx, 1);
        } else {
            if (_furnSelected.length >= 3) {
                showCyberAlert('LIMITE DO REATOR', currentLang === 'PT' ? 'Máximo de 3 ativos por sobrecarga.' : 'Maximum of 3 assets per overload.', 'warn');
                return;
            }
            _furnSelected.push(card);
        }
        _renderFurnGallery();
        _updateFurnPreview();
    }

    /** Atualiza os 3 slots de preview e o estado do botão de sobrecarga */
    function _updateFurnPreview() {
        for (let i = 0; i < 3; i++) {
            const slot = document.getElementById(`furnPreviewSlot${i + 1}`);
            if (!slot) continue;
            const card = _furnSelected[i];
            if (card) {
                const rc = _rarityColor(card.rarityType);
                slot.innerHTML = `<img src="${card.imgSrc}" style="border:2px solid ${rc};">`;
            } else {
                slot.innerHTML = '<div class="furn-empty-slot">☢<span>VAZIO</span></div>';
            }
        }
        const btn = document.getElementById('furnOverloadBtn');
        if (btn) btn.disabled = _furnSelected.length === 0;
    }

    /**
     * Executa a Sobrecarga: anima o reator, sorteia o resultado (80/20) e
     * reflete a queima ou a mutação máxima diretamente no Supabase.
     */
    async function startOverload() {
        if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', currentLang === 'PT' ? 'Precisas de estar logado para aceder à Fornalha.' : 'Login required to access the Furnace.', 'error'); return; }
        if (_furnSelected.length === 0) return;
        if (_furnSelected.some(c => c.isListed)) { showCyberAlert('🔒 CUSTÓDIA ATIVA', currentLang === 'PT' ? 'Ativos em custódia no mercado não podem ser sobrecarregados.' : 'Assets listed on market cannot be overloaded.', 'error'); return; }

        const overloadBtn = document.getElementById('furnOverloadBtn');
        overloadBtn.disabled = true;

        // Snapshot dos cards selecionados ANTES de qualquer alteração
        const snaps = _furnSelected.map(c => ({...c}));
        const idsConsumidos = snaps.map(c => c.id);

        const furnacePanel = document.getElementById('alchFornalhaView');
        furnacePanel.classList.add('furnace-charging');
        playSynthSound('click');
        speakPhrase("Iniciando sobrecarga do reator. Núcleo instável.", "Initiating reactor overload. Core unstable.");

        setTimeout(() => {
            furnacePanel.classList.remove('furnace-charging');

            // ── Overlay de glitch/reator por 1500ms ───────────────────────
            const glitchOverlay = document.createElement('div');
            glitchOverlay.id = 'furnaceGlitchOverlay';
            Object.assign(glitchOverlay.style, {
                position: 'fixed', inset: '0', zIndex: '9999',
                background: 'rgba(10, 3, 0, 0.94)', display: 'flex',
                flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '18px', pointerEvents: 'all',
            });

            const flashLayer = document.createElement('div');
            flashLayer.className = 'furnace-flash-layer';
            glitchOverlay.appendChild(flashLayer);

            document.body.classList.add('furnace-screen-shake');

            playTerminalSound('alchemy');
            playFusionShockSound();
            const glitchSoundTimer = setInterval(() => playSynthSound('click'), 280);
            const flashTimers = [250, 550, 850, 1100, 1350].map(delay =>
                setTimeout(() => {
                    flashLayer.classList.add('flash-pulse');
                    setTimeout(() => flashLayer.classList.remove('flash-pulse'), 90);
                    playSynthSound('click');
                }, delay)
            );

            const glitchLabel = document.createElement('div');
            glitchLabel.className = 'loading-glitch loading-glitch-cursor furnace-glitch-label';
            glitchLabel.setAttribute('data-text', '[ REACTOR CORE INSTABLE ]');
            glitchLabel.textContent = '[ REACTOR CORE INSTABLE ]';
            Object.assign(glitchLabel.style, { fontSize: '1.3rem', letterSpacing: '4px' });

            const glitchSub = document.createElement('div');
            glitchSub.style.cssText = 'font-family:"Space Mono",monospace; font-size:0.6rem; color:#ff550099; letter-spacing:2px;';
            const subMessages = [
                'CONTENÇÃO DE NÚCLEO FALHANDO...',
                'TEMPERATURA CRÍTICA ATINGIDA...',
                'CALCULANDO PROBABILIDADE DE DERRETIMENTO...',
                'SOBRECARGA EM ANDAMENTO...',
            ];
            glitchSub.textContent = subMessages[Math.floor(Math.random() * subMessages.length)];

            const glitchBar = document.createElement('span');
            glitchBar.className = 'loading-glitch-bar furnace-glitch-bar';
            Object.assign(glitchBar.style, { width: '260px', display: 'block' });

            const scanline = document.createElement('div');
            scanline.className = 'loading-glitch-scanline furnace-glitch-scanline';

            glitchOverlay.appendChild(scanline);
            glitchOverlay.appendChild(glitchLabel);
            glitchOverlay.appendChild(glitchSub);
            glitchOverlay.appendChild(glitchBar);
            document.body.appendChild(glitchOverlay);

            setTimeout(async () => {
                clearInterval(glitchSoundTimer);
                document.body.classList.remove('furnace-screen-shake');
                glitchOverlay.remove();

                // BUGFIX (cards purgados sumindo do cofre): antes, os cards
                // consumidos eram removidos de savedAssets aqui e o selo
                // PURGED/DETONADA era aplicado só nas cópias soltas em
                // `snaps` (que nunca voltavam pro array) — resultado: o
                // ativo desaparecia do cofre pra sempre em vez de continuar
                // visível, marcado como detonado. Agora os originais
                // permanecem no array; só fica marcado isPurged=true.
                const purgeOriginaisDaFornalha = async (reason) => {
                    for (const id of idsConsumidos) {
                        const original = savedAssets.find(a => a.id === id);
                        if (!original) continue;
                        if (original._dbId) await purgeCardInSupabase(original._dbId, reason);
                        markCardPurgedLocally(original, reason);
                    }
                };

                const roll = Math.random();
                let alertTitle, alertMsg, alertType;

                if (roll < 0.80) {
                    // ── FALHA (80%): marca todos os cards selecionados como purged
                    // (continuam existindo como registro histórico/inspecionável,
                    // em vez de serem apagados sem deixar rastro) ──
                    await purgeOriginaisDaFornalha('fornalha_falha');
                    // Concede Fragmentos de Sucata como compensação
                    const furnFragments = snaps.length * FRAGMENTS_PER_FURNACE_FAIL;
                    currentUser.fragments = (currentUser.fragments || 0) + furnFragments;
                    await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });

                    alertTitle = '[ERRO] FALHA DE CONTENÇÃO';
                    alertMsg = currentLang === 'PT'
                        ? `[ERRO] COMPONENTES DERRETIDOS NA FORNALHA. ATIVOS DESTRUÍDOS.<br><small style="color:#ff550099">${idsConsumidos.join(', ')}</small><br><span style="color:#aaa;">+${furnFragments} Fragmentos de Sucata concedidos como compensação. (Total: ${currentUser.fragments})</span>`
                        : `[ERROR] COMPONENTS MELTED IN THE FURNACE. ASSETS DESTROYED.<br><small style="color:#ff550099">${idsConsumidos.join(', ')}</small><br><span style="color:#aaa;">+${furnFragments} Scrap Fragments granted as compensation. (Total: ${currentUser.fragments})</span>`;
                    alertType = 'error';
                    triggerAncestralFlash('#ff5500');
                    playSynthSound('shatter');
                    speakPhrase("Fornalha falhou. Ativos derretidos. Fragmentos de sucata concedidos.", "Furnace failed. Assets melted. Scrap fragments granted.");
                    pushLedger(`${currentUser.username} sobrecarregou a Fornalha com ${idsConsumidos.join('+')} — DERRETIMENTO TOTAL (+${furnFragments} FRAG)`);

                } else {
                    // ── SUCESSO (20%): marca originais como purged (consumidos pela
                    // mutação) + gera 1 card novo de alta raridade ──
                    await purgeOriginaisDaFornalha('fornalha_mutacao');

                    const rarityRoll = Math.random();
                    const newRarity = rarityRoll < 0.55 ? 'ancestral' : 'legendary';
                    const rN   = newRarity === 'ancestral' ? 'ANCESTRAL' : 'LENDÁRIO';
                    const rNEN = newRarity === 'ancestral' ? 'ANCESTRAL' : 'LEGENDARY';
                    const wc   = newRarity === 'ancestral' ? '#ff007f' : '#00ffff';

                    const baseSnap = snaps[Math.floor(Math.random() * snaps.length)];
                    const fusedVisual = await renderFusedCardVisual(baseSnap.imgSrc, 'gold');
                    if (newRarity === 'ancestral') triggerAncestralFlash('#ff007f');

                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const inheritedFusionCount = Math.max(...snaps.map(s => s.fusion_count || 0)) + 1;

                    const newCard = {
                        id: newId, rarityType: newRarity, rarityName: rN, rarityNameEN: rNEN,
                        styleName: 'OVERLOAD MUTATION', styleNameEN: 'OVERLOAD MUTATION',
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual, isFused: true, tags: ['fused', 'fornalha', 'evento'],
                        fusion_count: inheritedFusionCount,
                        genetic_history: snaps.flatMap(s => s.genetic_history || []).concat([{
                            fusionId: `FRN-${inheritedFusionCount.toString().padStart(4, '0')}`,
                            ts: Date.now(),
                            sacrificedCardId: idsConsumidos.join('+'),
                            survivalRollResult: roll,
                            mutation: { huePalette: 'gold', source: 'fornalha' }
                        }]),
                        eliteEligible: inheritedFusionCount >= 3
                    };
                    attachProvenance(newCard);
                    newCard.provenance.parentIds = idsConsumidos;
                    // Upload imagem pro Storage antes de gravar no banco
                    if (newCard.imgSrc && newCard.imgSrc.startsWith('data:')) {
                        newCard.imgSrc = await uploadCardImageToBucket(newCard.imgSrc, newCard.id);
                    }
                    savedAssets.push(newCard);

                    const inserted = await insertCardToSupabase(newCard, currentUser.id);
                    if (!inserted) console.error('startOverload: falha ao gravar card mutado no Supabase.');

                    alertTitle = '[SOBRECARGA BEM SUCEDIDA]';
                    alertMsg = currentLang === 'PT'
                        ? `[SOBRECARGA BEM SUCEDIDA] NOVO ATIVO GERADO NA REDE.<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span>`
                        : `[OVERLOAD SUCCESSFUL] NEW ASSET GENERATED ON THE NETWORK.<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span>`;
                    alertType = 'success';
                    playTerminalSound('alchemy');
                    registerFusionForBadges();
                    pushFeedCard({...newCard});
                    pushLedger(`${currentUser.username} sobrecarregou a Fornalha com ${idsConsumidos.join('+')} → ${newCard.id} [${newCard.rarityNameEN}]`);
                }

                _furnSelected = [];
                _renderFurnGallery();
                _updateFurnPreview();
                renderVaultGrid();
                showCyberAlert(alertTitle, alertMsg, alertType);

            }, 1500);
        }, 1200);
    }

    // =========================================================
    // MOVIMENTO CONTÍNUO (BOTÃO "GIF" DA FUSÃO)
    // Cards marcados com isAnimated:true recebem um filtro de movimento
    // (data-motion-filter) sorteado entre as variantes abaixo. O sorteio
    // acontece no momento da fusão (ligado ao ID recém-gerado do card) e
    // é re-derivado de forma DETERMINÍSTICA a partir do próprio ID em
    // qualquer render futuro — por isso o mesmo card sempre mostra o
    // mesmo filtro em Inventário, Vitrine e Modal de Inspect, mesmo sem
    // precisar gravar a variante escolhida em coluna própria no banco.
    // =========================================================
    // 12 variantes de filtro de movimento — sincronizadas com os @keyframes em config.js
    const MOTION_FILTER_VARIANTS = [
        'random-glitch', 'vortex-wave', 'chromatic-pulse', 'scanline-drift',
        'neon-flicker', 'heat-shimmer', 'rgb-split', 'static-burst',
        'deep-pulse', 'corruption', 'hologram', 'plasma-burn'
    ];

    function getCardMotionFilter(card) {
        if (!card || !card.isAnimated) return null;
        if (card.motionFilter && MOTION_FILTER_VARIANTS.includes(card.motionFilter)) {
            return card.motionFilter;
        }
        const seed = String(card.id || '');
        let hash = 0;
        for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
        const variant = MOTION_FILTER_VARIANTS[hash % MOTION_FILTER_VARIANTS.length];
        card.motionFilter = variant; // cache em memória — evita resortear no mesmo card
        return variant;
    }

    /**
     * Aplica (ou remove) a classe ativa de animação + o atributo
     * data-motion-filter num elemento do DOM, com base no card.isAnimated.
     * Usado de forma idêntica no Inventário, na Vitrine e no Modal de Inspect,
     * garantindo que o filtro de movimento acompanhe o card pelo ecossistema.
     */
    function applyCardMotionAttrs(domEl, card) {
        if (!domEl || !card) return;
        const variant = getCardMotionFilter(card);
        if (variant) {
            domEl.classList.add('card-motion-active');
            domEl.dataset.motionFilter = variant;
        } else {
            domEl.classList.remove('card-motion-active');
            delete domEl.dataset.motionFilter;
        }
    }

    // =========================================================
    // EFEITO VISUAL DINÂMICO DE FUSÃO (ALQUIMIA) — Ponto 4
    // Gera um filtro CSS aleatório + distorção/pixelado/ruído únicos
    // a cada fusão, sempre a partir da imagem-base do card resultante.
    // =========================================================
    function buildRandomFusionFilter(forcedPalette) {
        // Direcionador de Mutação ativo (ex: Essência de Neon Amarelo) força a faixa de matiz
        const PALETTE_HUE_RANGES = { gold: [40, 55], cyan: [180, 200], magenta: [300, 330] };
        const range = forcedPalette && PALETTE_HUE_RANGES[forcedPalette];
        const hue = range ? (range[0] + Math.floor(Math.random() * (range[1] - range[0]))) : Math.floor(Math.random() * 360);
        const sat = 180 + Math.floor(Math.random() * 180);     // 180% - 360% (sempre vibrante)
        const con = 100 + Math.floor(Math.random() * 140);     // 100% - 240%
        const bri = 88 + Math.floor(Math.random() * 20);       // 88%  - 108% (anti-preto/branco)
        const doInvert = false; // DESATIVADO — invert causava preto/branco total; removido por design
        const invertPct = doInvert ? Math.floor(Math.random() * 100) : 0;
        const doGray = false; // DESATIVADO — grayscale causava imagens sem cor; removido por design

        let parts = [
            `hue-rotate(${hue}deg)`,
            `saturate(${sat}%)`,
            `contrast(${con}%)`,
            `brightness(${bri}%)`
        ];
        if (doInvert) parts.push(`invert(${invertPct}%)`);
        if (doGray) parts.push(`grayscale(${20 + Math.floor(Math.random() * 50)}%)`);

        return parts.join(' ');
    }

    /**
     * Renderiza a imagem-base do card fundido com filtro CSS aleatório
     * e, por cima, aplica uma das distorções de pixel (pixelado, ruído
     * estático, "derretido"/stretch) escolhida aleatoriamente, de modo
     * que o resultado visual nunca se repita entre fusões.
     * Retorna uma Promise<string> com o dataURL final (PNG).
     */
    function renderFusedCardVisual(baseImgSrc, forcedPalette) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const SIZE = 600;
                const canvas = document.createElement('canvas');
                canvas.width = SIZE; canvas.height = SIZE;
                const ctx = canvas.getContext('2d');

                // 1) Desenha a imagem-base já com o filtro CSS aleatório aplicado
                const filterStr = buildRandomFusionFilter(forcedPalette);
                ctx.filter = filterStr;
                ctx.drawImage(img, 0, 0, SIZE, SIZE);
                ctx.filter = "none";

                // 2) Escolhe aleatoriamente UMA distorção adicional pra aplicar
                const distortion = ["pixelado", "ruido", "derretido", "nenhuma"][Math.floor(Math.random() * 4)];

                if (distortion === "pixelado") {
                    const blockSize = 6 + Math.floor(Math.random() * 14); // 6-20px
                    const tiny = document.createElement('canvas');
                    const tinyW = Math.max(1, Math.floor(SIZE / blockSize));
                    tiny.width = tinyW; tiny.height = tinyW;
                    const tCtx = tiny.getContext('2d');
                    tCtx.drawImage(canvas, 0, 0, tinyW, tinyW);
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, SIZE, SIZE);
                    ctx.drawImage(tiny, 0, 0, tinyW, tinyW, 0, 0, SIZE, SIZE);
                    ctx.imageSmoothingEnabled = true;

                } else if (distortion === "ruido") {
                    // Sobrepõe ruído estático em pequenos blocos translúcidos
                    const noiseCount = 800 + Math.floor(Math.random() * 1200);
                    for (let i = 0; i < noiseCount; i++) {
                        const nx = Math.random() * SIZE;
                        const ny = Math.random() * SIZE;
                        const ns = 1 + Math.random() * 2.5;
                        const shade = Math.floor(Math.random() * 255);
                        ctx.fillStyle = `rgba(${shade},${shade},${shade},${(Math.random() * 0.35).toFixed(2)})`;
                        ctx.fillRect(nx, ny, ns, ns);
                    }
                    // Linhas de scanline aleatórias, estilo TV com defeito
                    const scanlines = 4 + Math.floor(Math.random() * 8);
                    for (let i = 0; i < scanlines; i++) {
                        const ly = Math.random() * SIZE;
                        ctx.fillStyle = `rgba(0,0,0,${(0.1 + Math.random() * 0.25).toFixed(2)})`;
                        ctx.fillRect(0, ly, SIZE, 1 + Math.random() * 3);
                    }

                } else if (distortion === "derretido") {
                    // Efeito "derretido": redesenha em faixas horizontais com
                    // deslocamento horizontal e estiramento vertical aleatório,
                    // crescente em direção à base da imagem.
                    const snapshot = ctx.getImageData(0, 0, SIZE, SIZE);
                    const tmp = document.createElement('canvas');
                    tmp.width = SIZE; tmp.height = SIZE;
                    tmp.getContext('2d').putImageData(snapshot, 0, 0);

                    ctx.clearRect(0, 0, SIZE, SIZE);
                    const strips = 30 + Math.floor(Math.random() * 30);
                    const stripH = SIZE / strips;
                    const maxDrip = 18 + Math.random() * 40;
                    for (let i = 0; i < strips; i++) {
                        const progress = i / strips; // 0 no topo, 1 na base
                        const xOffset = (Math.random() - 0.5) * (8 + progress * 26);
                        const dripStretch = 1 + (progress * progress) * (maxDrip / stripH) * 0.15 * Math.random();
                        const sy = i * stripH;
                        ctx.drawImage(
                            tmp,
                            0, sy, SIZE, stripH,
                            xOffset, sy, SIZE, stripH * dripStretch
                        );
                    }
                }
                // "nenhuma" → mantém só o filtro de cor, sem distorção extra

                // 3) [FIX FUSÃO] Aplica filtro interno oculto do banco FUSION_INTERNAL_FILTER_DB
                // sobre o canvas final — camada adicional de modificação exclusiva da fusão
                // que não aparece em nenhum menu de seleção do usuário.
                try {
                    const internalFilter = (typeof _getRandomFusionInternalFilter === 'function')
                        ? _getRandomFusionInternalFilter()
                        : null;
                    if (internalFilter && internalFilter.filter && internalFilter.filter !== 'none') {
                        const tmpFusion = document.createElement('canvas');
                        tmpFusion.width = SIZE; tmpFusion.height = SIZE;
                        const tFCtx = tmpFusion.getContext('2d');
                        tFCtx.filter = internalFilter.filter;
                        tFCtx.drawImage(canvas, 0, 0, SIZE, SIZE);
                        tFCtx.filter = 'none';
                        ctx.clearRect(0, 0, SIZE, SIZE);
                        ctx.drawImage(tmpFusion, 0, 0, SIZE, SIZE);
                    }
                } catch(e) { /* ignora silenciosamente se o banco não estiver disponível */ }

                // 4) Marca d'água sutil indicando que é resultado de fusão
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.fillRect(16, SIZE - 40, 150, 28);
                ctx.fillStyle = "#ff00ff";
                ctx.font = "bold 13px 'Space Mono'";
                ctx.fillText("FUSION_OUTPUT", 24, SIZE - 21);

                // [DEV CHANGER] Se modo GIF forçado, aplica filtros dinâmicos sobre o canvas final
                if (typeof _applyDevGifFilters === 'function') { _applyDevGifFilters(canvas, SIZE); }
                resolve(canvas.toDataURL('image/webp', 0.75));
            };
            img.onerror = () => resolve(baseImgSrc); // fallback: usa imagem original sem efeito
            img.src = baseImgSrc;
        });
    }

    /**
     * Núcleo de regras da Alquimia Avançada: calcula probabilidades ponderadas
     * por itens modificadores e aplica os efeitos de sobrevivência/mutação
     * sobre o card principal (que permanece vivo, acumulando fusion_count).
     * NÃO mexe em savedAssets/DOM — isso fica a cargo de fuseCards(), que
     * orquestra a animação e persiste o resultado.
     *
     * @param {object} cardPrincipal    card que sobrevive e evolui
     * @param {object} cardSacrificado  card consumido na fusão
     * @param {object[]} modificadores  itens do inventário usados (templateId)
     * @returns {{resultado:string, ...}}
     */
    async function forjarFusao(cardPrincipal, cardSacrificado, modificadores = []) {
        const score = c => c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(cardPrincipal) + score(cardSacrificado);
    
        let ps, pb;
        if (total >= 6)      { ps = 0.70; pb = 0.10; }
        else if (total >= 4) { ps = 0.45; pb = 0.15; }
        else if (total >= 3) { ps = 0.25; pb = 0.20; }
        else                  { ps = 0.10; pb = 0.25; }
    
        let nucleoBackupAtivo = false;
        let forcedPalette = null;
        let fusionCountBonus = 0;
    
        modificadores.forEach(m => {
            const tpl = ITEMS_DB[m.templateId];
            if (!tpl) return;
            if (tpl.effect.type === 'SURVIVAL_BONUS')  ps = Math.min(0.95, ps + tpl.effect.value);
            if (tpl.effect.type === 'INSURANCE_BREAK')  nucleoBackupAtivo = true;
            if (tpl.effect.type === 'FORCE_PALETTE')    forcedPalette = tpl.effect.value;
            if (tpl.effect.type === 'OVERCLOCK') {
                pb = Math.min(0.95, pb + tpl.effect.riskDelta);
                fusionCountBonus += tpl.effect.fusionCountBonus;
            }
        });
        pb = Math.max(0, Math.min(1 - ps, pb)); // normaliza, nunca deixa ps+pb > 1
    
        const roll = Math.random();
        const fusionId = `FUS-${(cardPrincipal.fusion_count || 0).toString().padStart(4, '0')}`;
    
        // Consome itens-moeda e modificadores usados (independente do resultado)
        // ⚠️ agora aguarda cada consumo terminar no Supabase antes de seguir
        for (const m of modificadores) { await consumeInventoryItem(m.itemId); }
    
        if (roll < pb) {
            if (nucleoBackupAtivo) {
                return { resultado: 'seguro_ativado', cardPrincipal, roll, ps, pb,
                    mensagem: 'Núcleo de Backup absorveu a falha — card principal preservado.' };
            }
            // destruição total: nenhum dos dois sobrevive — marcados como
            // purged em vez de apagados, preservando o registro histórico
            if (cardPrincipal._dbId) await purgeCardInSupabase(cardPrincipal._dbId, 'fusao_destruicao_total');
            if (cardSacrificado._dbId) await purgeCardInSupabase(cardSacrificado._dbId, 'fusao_destruicao_total');
            markCardPurgedLocally(cardPrincipal, 'fusao_destruicao_total');
            markCardPurgedLocally(cardSacrificado, 'fusao_destruicao_total');
            return { resultado: 'destruicao_total', cardsPerdidos: [cardPrincipal.id, cardSacrificado.id], roll, ps, pb };
        }
    
        // SUCESSO: card principal sobrevive e evolui
        cardPrincipal.fusion_count = (cardPrincipal.fusion_count || 0) + 1 + fusionCountBonus;
        cardPrincipal.genetic_history = cardPrincipal.genetic_history || [];
        cardPrincipal.genetic_history.push({
            fusionId, ts: Date.now(),
            sacrificedCardId: cardSacrificado.id,
            sacrificedSnapshot: { rarityType: cardSacrificado.rarityType, styleName: cardSacrificado.styleName },
            itemsConsumidos: modificadores.map(m => m.itemId),
            survivalRollResult: roll,
            mutation: forcedPalette ? { huePalette: forcedPalette } : null
        });
        cardPrincipal.eliteEligible = cardPrincipal.fusion_count >= 3;
        regenerateQrSignature(cardPrincipal); // estado mudou → QR muta
    
        // ── persiste a evolução do card principal no Supabase ──
        await updateCardInSupabase(cardPrincipal, {
            fusion_count: cardPrincipal.fusion_count,
            eliteEligible: cardPrincipal.eliteEligible,
            genetic_history: cardPrincipal.genetic_history,
            qr_code_hash: cardPrincipal.qr_code_hash,
            qr_payload_url: cardPrincipal.qr_payload_url
        });
        // ── marca o card sacrificado como purged (foi consumido pela fusão) ──
        if (cardSacrificado._dbId) await purgeCardInSupabase(cardSacrificado._dbId, 'fusao_sacrificio');
        markCardPurgedLocally(cardSacrificado, 'fusao_sacrificio');
    
        return { resultado: 'sucesso', cardPrincipal, fusionId, roll, ps, pb, forcedPalette };
    }
    
    // =========================================================
    // GLOBALS DO SISTEMA GIF/DEV — declarados aqui para garantir que
    // fuseCards() os encontre sem ReferenceError.
    // =========================================================
    if (typeof window._fusionGifModeActive === 'undefined') window._fusionGifModeActive = false;
    if (typeof window._devForceGifMode     === 'undefined') window._devForceGifMode     = false;

    /** Toggle do modo GIF — ativa isAnimated para a próxima fusão */
    function toggleFusionGifMode() {
        window._fusionGifModeActive = !window._fusionGifModeActive;
        const btn = document.getElementById('_fusionGifBtn');
        if (btn) btn.style.borderColor = window._fusionGifModeActive ? '#00ff66' : '#333';
    }

    /** Injeta o botão GIF discreto no painel de alquimia (easter egg) */
    function _injectFusionGifButtonIfAbsent() {
        if (document.getElementById('_fusionGifBtn')) return;
        const anchor = document.querySelector('.alchemy-prob-bar') || document.getElementById('alchFusaoView');
        if (!anchor) return;
        const btn = document.createElement('button');
        btn.id = '_fusionGifBtn';
        btn.type = 'button';
        btn.title = 'Modo GIF — card resultante ficará animado';
        Object.assign(btn.style, {
            position: 'absolute', bottom: '8px', right: '8px',
            background: 'transparent', border: '1px solid #333',
            color: '#555', fontFamily: "'Space Mono', monospace",
            fontSize: '0.45rem', padding: '3px 7px', cursor: 'pointer',
            letterSpacing: '1px', zIndex: '10'
        });
        btn.textContent = 'GIF';
        btn.onclick = toggleFusionGifMode;
        const wrap = document.getElementById('alchFusaoView');
        if (wrap) { wrap.style.position = 'relative'; wrap.appendChild(btn); }
    }

    /** Botão DEV CHANGER — oculto, só visível em modo dev */
    function _injectDevChangerIfAbsent() {
        if (document.getElementById('_devChangerBtn')) return;
        const wrap = document.getElementById('alchFusaoView');
        if (!wrap) return;
        const btn = document.createElement('button');
        btn.id = '_devChangerBtn';
        btn.type = 'button';
        Object.assign(btn.style, {
            position: 'absolute', bottom: '8px', left: '8px',
            background: 'transparent', border: '1px solid #222',
            color: '#333', fontFamily: "'Space Mono', monospace",
            fontSize: '0.4rem', padding: '2px 5px', cursor: 'pointer', zIndex: '10'
        });
        btn.textContent = 'DEV';
        btn.onclick = () => { window._devForceGifMode = !window._devForceGifMode; btn.style.color = window._devForceGifMode ? '#ff0044' : '#333'; };
        wrap.style.position = 'relative';
        wrap.appendChild(btn);
    }

    /** Filtro interno aplicado silenciosamente sobre o canvas de fusão */
    function _getRandomFusionInternalFilter() {
        const internals = [
            { filter: 'hue-rotate(45deg) saturate(130%) brightness(96%)' },
            { filter: 'hue-rotate(120deg) saturate(150%) brightness(94%)' },
            { filter: 'hue-rotate(270deg) saturate(140%) brightness(97%)' },
            { filter: 'none' },
        ];
        return internals[Math.floor(Math.random() * internals.length)];
    }

    /** Aplica filtros GIF ao canvas em modo dev (não exibido ao usuário) */
    function _applyDevGifFilters(canvas, SIZE) {
        const ctx = canvas.getContext('2d');
        ctx.filter = 'hue-rotate(30deg) saturate(180%) brightness(95%)';
        const tmp = document.createElement('canvas');
        tmp.width = SIZE; tmp.height = SIZE;
        tmp.getContext('2d').drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(tmp, 0, 0);
        ctx.filter = 'none';
    }

    async function fuseCards(id1, id2, modificadores = []) {
        if (!id1 || !id2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Seleciona 2 cards diferentes.' : 'Select 2 different cards.', 'error'); return; }
        if (id1 === id2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Os 2 cards devem ser diferentes.' : 'Both cards must be different.', 'error'); return; }
    
        const c1 = savedAssets.find(a => a.id === id1);
        const c2 = savedAssets.find(a => a.id === id2);
        if (!c1 || !c2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Card não encontrado no cofre.' : 'Card not found in vault.', 'error'); return; }
        if (c1.isListed || c2.isListed) { showCyberAlert('🔒 CUSTÓDIA ATIVA', currentLang === 'PT' ? 'Cards em custódia no mercado não podem ser fundidos.' : 'Cards listed on market cannot be fused.', 'error'); return; }
    
        // Snapshot antes de qualquer alteração
        const snap1 = {...c1}; const snap2 = {...c2};
    
        const score = (c) => c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(c1) + score(c2);
    
        let ps, pb;
        if (total >= 6)      { ps = 0.70; pb = 0.10; }
        else if (total >= 4) { ps = 0.45; pb = 0.15; }
        else if (total >= 3) { ps = 0.25; pb = 0.20; }
        else                 { ps = 0.10; pb = 0.25; }
    
        // ── ALQUIMIA AVANÇADA: aplica efeito dos itens modificadores selecionados ──
        let nucleoBackupAtivo = false;
        let forcedPalette = null;
        let fusionCountBonus = 0;
        modificadores.forEach(m => {
            const tpl = ITEMS_DB[m.templateId];
            if (!tpl) return;
            if (tpl.effect.type === 'SURVIVAL_BONUS') ps = Math.min(0.95, ps + tpl.effect.value);
            if (tpl.effect.type === 'INSURANCE_BREAK') nucleoBackupAtivo = true;
            if (tpl.effect.type === 'FORCE_PALETTE') forcedPalette = tpl.effect.value;
            if (tpl.effect.type === 'OVERCLOCK') {
                pb = Math.min(0.95, pb + tpl.effect.riskDelta);
                fusionCountBonus += tpl.effect.fusionCountBonus;
            }
        });
        pb = Math.max(0, Math.min(1 - ps, pb)); // normaliza, nunca deixa ps+pb > 1
    
        // consome itens já na entrada da fusão — agora aguarda cada baixa no Supabase
        for (const m of modificadores) { await consumeInventoryItem(m.itemId); }
    
        // [DEV CHANGER] Se o modo de GIF forçado estiver ativo, garante sucesso absoluto
        const roll = window._devForceGifMode ? (pb + 0.01) : Math.random(); // pb+0.01 garante que cai no ramo de sucesso
    
        // ── FASE 1: animação visual do painel de alquimia ──────────────
        const alchPanel = document.getElementById('alchemyPanel');
        alchPanel.classList.add('alchemy-fusing');
        _injectDevChangerIfAbsent(); // [DEV] injeta botão se ainda não existir
        _injectFusionGifButtonIfAbsent(); // injeta o botão "GIF" se ainda não existir
        const gifModeForThisFusion = window._fusionGifModeActive || window._devForceGifMode;
        if (window._fusionGifModeActive) toggleFusionGifMode(); // consome o toggle — vale só para esta fusão
        playSynthSound('click');
        speakPhrase("Iniciando fusão. Aguarde a estabilização.", "Initiating fusion sequence. Stand by.");
    
        setTimeout(() => {
            alchPanel.classList.remove('alchemy-fusing');
    
            // ── FASE 2: overlay de glitch por 1500ms ───────────────────────
            const glitchOverlay = document.createElement('div');
            glitchOverlay.id = 'fusionGlitchOverlay';
            glitchOverlay.className = 'fusion-glitch-active';
            Object.assign(glitchOverlay.style, {
                position:       'fixed',
                inset:          '0',
                zIndex:         '9999',
                background:     'rgba(5, 5, 7, 0.92)',
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            '18px',
                pointerEvents:  'all',
            });
    
            // Camada de flash de luz, dispara em pulsos aleatórios durante o overlay
            const flashLayer = document.createElement('div');
            flashLayer.className = 'fusion-flash-layer';
            glitchOverlay.appendChild(flashLayer);
    
            // Trepidação de tela (shake) no body inteiro durante a fusão
            document.body.classList.add('fusion-screen-shake');
    
            // Som de "máquina" em loop curto enquanto o overlay está ativo
            playTerminalSound('alchemy');
            playFusionShockSound();
            const glitchSoundTimer = setInterval(() => playSynthSound('click'), 350);
            // Flashes de luz em instantes aleatórios dentro da janela de 1500ms
            const flashTimers = [300, 650, 1000, 1250].map(delay =>
                setTimeout(() => {
                    flashLayer.classList.add('flash-pulse');
                    setTimeout(() => flashLayer.classList.remove('flash-pulse'), 90);
                    playSynthSound('click');
                }, delay)
            );
    
            // Texto principal com efeito glitch
            const glitchLabel = document.createElement('div');
            glitchLabel.className = 'loading-glitch loading-glitch-cursor';
            glitchLabel.setAttribute('data-text', currentLang === 'PT' ? 'EXECUTANDO_FUSÃO...' : 'EXECUTING_FUSION...');
            glitchLabel.textContent = currentLang === 'PT' ? 'EXECUTANDO_FUSÃO...' : 'EXECUTING_FUSION...';
            Object.assign(glitchLabel.style, { fontSize: '1.4rem', letterSpacing: '4px' });
    
            // Linha de status secundária
            const glitchSub = document.createElement('div');
            glitchSub.style.cssText = 'font-family:"Space Mono",monospace; font-size:0.6rem; color:#444466; letter-spacing:2px;';
            const subMessages = [
                'QUEBRANDO VÍNCULOS MOLECULARES...',
                'RECOMBINANDO SEQUÊNCIA DE DNA DIGITAL...',
                'INSTABILIDADE DE REDE DETECTADA...',
                'SINCRONIZANDO MATRIZ DE RARIDADE...',
            ];
            glitchSub.textContent = subMessages[Math.floor(Math.random() * subMessages.length)];
    
            // Barra de progresso de terminal
            const glitchBar = document.createElement('span');
            glitchBar.className = 'loading-glitch-bar';
            Object.assign(glitchBar.style, { width: '260px', display: 'block' });
    
            // Scanline sobreposta
            const scanline = document.createElement('div');
            scanline.className = 'loading-glitch-scanline';
    
            glitchOverlay.appendChild(scanline);
            glitchOverlay.appendChild(glitchLabel);
            glitchOverlay.appendChild(glitchSub);
            glitchOverlay.appendChild(glitchBar);
            document.body.appendChild(glitchOverlay);
    
            // ── FASE 3: após 1500ms, remove glitch e processa resultado ───
            setTimeout(async () => {
                clearInterval(glitchSoundTimer);
                document.body.classList.remove('fusion-screen-shake');
                glitchOverlay.remove();
    
                // BUGFIX (cards purgados sumindo do cofre): os cards originais
                // (c1/c2) permanecem em savedAssets — nunca são removidos do
                // array. Apenas são marcados isPurged=true quando consumidos,
                // preservando o selo PURGED/DETONADA no cofre, no Inspect e
                // no feed, em vez de desaparecerem por completo.
                const insuranceWillSave = nucleoBackupAtivo && roll < pb;
                // Nota: cards em custódia no mercado (isListed) não podem ser fundidos
                // (validado antes, no início de fuseCards), então não há necessidade
                // de tocar em marketAssets/Supabase aqui.
    
                // ── SUPABASE: marca como purged os cards realmente consumidos ──
                // Se o seguro salvou c1, só c2 é purgado; senão, os dois são.
                // Marcados como purged em vez de apagados: continuam existindo
                // como registro histórico/inspecionável (selo PURGED/DETONADA).
                if (insuranceWillSave) {
                    if (c2._dbId) await purgeCardInSupabase(c2._dbId, 'fusao_sacrificio');
                    markCardPurgedLocally(c2, 'fusao_sacrificio');
                } else {
                    if (c1._dbId) await purgeCardInSupabase(c1._dbId, 'fusao_destruicao_total');
                    if (c2._dbId) await purgeCardInSupabase(c2._dbId, 'fusao_destruicao_total');
                    markCardPurgedLocally(c1, 'fusao_destruicao_total');
                    markCardPurgedLocally(c2, 'fusao_destruicao_total');
                }
    
                let result, fusedCard, alertTitle, alertMsg, alertType;
    
                if (roll < pb) {
                    if (insuranceWillSave) {
                        // SEGURO ATIVADO: Núcleo de Backup absorve a falha — c1 sobrevive intacto
                        result = 'seguro_ativado';
                        alertTitle = currentLang === 'PT' ? '🛡️ SEGURO ATIVADO' : '🛡️ INSURANCE TRIGGERED';
                        alertMsg   = currentLang === 'PT'
                            ? `O <b>Núcleo de Backup</b> quebrou no lugar do card principal.<br><b>${id1}</b> foi preservado intacto. <b>${id2}</b> foi perdido.`
                            : `The <b>Backup Core</b> shattered in place of the main card.<br><b>${id1}</b> survived intact. <b>${id2}</b> was lost.`;
                        alertType = 'warn';
                        playSynthSound('success');
                        speakPhrase("Seguro de alquimia ativado. Card principal preservado.", "Alchemy insurance triggered. Main card preserved.");
                    } else {
                        // FALHA: cartas quebram — sem novo card
                        result = 'break';
                        alertTitle = currentLang === 'PT' ? '💀 FUSÃO DESTRUÍDA' : '💀 FUSION DESTROYED';
                        alertMsg   = currentLang === 'PT'
                            ? `Cards <b>${id1}</b> e <b>${id2}</b> foram destruídos na fusão instável. Nenhum ativo gerado.`
                            : `Cards <b>${id1}</b> and <b>${id2}</b> were destroyed in the unstable fusion. No asset generated.`;
                        alertType = 'error';
                        triggerAncestralFlash('#ff0044'); // flash vermelho na quebra
                        playSynthSound('shatter');
                        speakPhrase("Fusão destruída. Perda total.", "Fusion destroyed. Total loss.");
                    }
    
                } else if (roll < pb + (1 - ps - pb)) {
                    // ITEM COMUM
                    result = 'common';
                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const fusedVisual = await renderFusedCardVisual(snap1.imgSrc);
                    fusedCard = {
                        id: newId, rarityType: 'common', rarityName: 'COMUM', rarityNameEN: 'COMMON',
                        styleName: 'RESÍDUO [FUSED]', styleNameEN: 'RESIDUE [FUSED]',
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual, isFused: true, tags: ['fused'],
                        isAnimated: gifModeForThisFusion,
                        fusion_count: 0, genetic_history: [] // resíduo instável — linhagem não sobrevive
                    };
                    // ── PROVENIÊNCIA: novo hash exclusivo do card fundido ──
                    attachProvenance(fusedCard);
                    // Upload imagem pro Storage antes de gravar no banco
                    if (fusedCard.imgSrc && fusedCard.imgSrc.startsWith('data:')) {
                        fusedCard.imgSrc = await uploadCardImageToBucket(fusedCard.imgSrc, fusedCard.id);
                    }
                    savedAssets.push(fusedCard);
                    // ── SUPABASE: grava o novo card resultante da fusão ──
                    const insertedCommon = await insertCardToSupabase(fusedCard, currentUser.id);
                    if (!insertedCommon) console.error('fuseCards: falha ao gravar card comum no Supabase.');
                    alertTitle = currentLang === 'PT' ? '◆ FUSÃO PARCIAL' : '◆ PARTIAL FUSION';
                    alertMsg   = currentLang === 'PT'
                        ? `Fusão instável resultou num card comum.<br><b>${newId}</b> — <span style="color:#aaa">COMUM</span>`
                        : `Unstable fusion resulted in a common card.<br><b>${newId}</b> — <span style="color:#aaa">COMMON</span>`;
                    alertType = 'warn';
                    playSynthSound('success');
                    speakPhrase("Fusão parcial. Item comum gerado.", "Partial fusion. Common item generated.");
    
                } else {
                    // SUCESSO — rarity baseada nos inputs + 1% Ancestral
                    result = 'success';
                    const rarityRoll = Math.random();
                    let newRarity;
                    if (rarityRoll < 0.01) {
                        newRarity = 'ancestral';
                    } else if (total >= 6)      newRarity = rarityRoll < 0.75 ? 'legendary' : 'epic';
                    else if (total >= 4) newRarity = rarityRoll < 0.35 ? 'legendary' : 'epic';
                    else if (total >= 3) newRarity = rarityRoll < 0.08 ? 'legendary' : 'epic';
                    else                 newRarity = rarityRoll < 0.03 ? 'legendary' : 'epic';
    
                    const rarityColors = {
                        ancestral: '#ff007f',
                        legendary: '#00ffff',
                        epic:      '#ffaa00'
                    };
                    const rN   = newRarity === 'ancestral' ? 'ANCESTRAL' : newRarity === 'legendary' ? 'LENDÁRIO' : 'ÉPICO';
                    const rNEN = newRarity === 'ancestral' ? 'ANCESTRAL' : newRarity === 'legendary' ? 'LEGENDARY' : 'EPIC';
                    const wc   = rarityColors[newRarity] || '#aaaaaa';
                    const nameParts = [snap1.styleName.split(' ')[0], snap2.styleName.split(' ')[0]];
                    const fusedStyle = nameParts.join('×') + ' [FUSED]';
                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const baseVisualSrc = Math.random() > 0.5 ? snap1.imgSrc : snap2.imgSrc;
                    const fusedVisual = await renderFusedCardVisual(baseVisualSrc, forcedPalette);
    
                    // Flash ancestral (rosa) se for ancestral
                    if (newRarity === 'ancestral') triggerAncestralFlash('#ff007f');
    
                    // ── SURVIVAL COUNTER: o card resultante herda o maior fusion_count
                    // entre os dois cards de origem + 1 (esta fusão) + bônus de Overclock ──
                    const inheritedFusionCount = Math.max(snap1.fusion_count || 0, snap2.fusion_count || 0) + 1 + fusionCountBonus;
                    const inheritedHistory = [
                        ...(snap1.genetic_history || []), ...(snap2.genetic_history || []),
                        {
                            fusionId: `FUS-${inheritedFusionCount.toString().padStart(4, '0')}`,
                            ts: Date.now(),
                            sacrificedCardId: id1 === snap1.id ? id2 : id1,
                            itemsConsumidos: modificadores.map(m => m.itemId),
                            survivalRollResult: roll,
                            mutation: forcedPalette ? { huePalette: forcedPalette } : null
                        }
                    ];
    
                    fusedCard = {
                        id: newId, rarityType: newRarity, rarityName: rN, rarityNameEN: rNEN,
                        styleName: fusedStyle, styleNameEN: fusedStyle,
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual,
                        isFused: true, tags: ['fused', 'evento'],
                        isAnimated: gifModeForThisFusion,
                        fusion_count: inheritedFusionCount,
                        genetic_history: inheritedHistory,
                        eliteEligible: inheritedFusionCount >= 3
                    };
                    // ── PROVENIÊNCIA: hash exclusivo + herança de linhagem (já regenera o QR) ──
                    attachProvenance(fusedCard);
                    fusedCard.provenance.parentIds = [id1, id2]; // rastreabilidade de linhagem
                    // Upload imagem pro Storage antes de gravar no banco
                    if (fusedCard.imgSrc && fusedCard.imgSrc.startsWith('data:')) {
                        fusedCard.imgSrc = await uploadCardImageToBucket(fusedCard.imgSrc, fusedCard.id);
                    }
                    savedAssets.push(fusedCard);
                    // ── SUPABASE: grava o novo card resultante da fusão ──
                    const insertedSuccess = await insertCardToSupabase(fusedCard, currentUser.id);
                    if (!insertedSuccess) console.error('fuseCards: falha ao gravar card fundido no Supabase.');
                    alertTitle = currentLang === 'PT' ? '⚗️ FUSÃO CONCLUÍDA' : '⚗️ FUSION COMPLETE';
                    alertMsg   = currentLang === 'PT'
                        ? `Novo ativo gerado com sucesso!<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span><br>Estilo: <b>${fusedStyle}</b><br><small style="color:#666">Este card tem tag [EVENTO] e pode ser usado como banner.</small>`
                        : `New asset successfully generated!<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span><br>Style: <b>${fusedStyle}</b><br><small style="color:#666">This card has [EVENT] tag and can be used as banner.</small>`;
                    alertType = 'success';
                    playTerminalSound('alchemy');
                }
    
                // Já não há registry local para persistir — cada mudança (cards
                // apagados/criados, itens de inventário consumidos) já foi
                // gravada direto no Supabase nos pontos acima.
                if (result === 'success' || result === 'common') registerFusionForBadges();
                // Fusões bem-sucedidas (comum ou épico/lendário) entram no feed
                // global REAL e público (eventos_globais), pra aparecerem na Home
                // de TODO mundo (não só desta aba) e sobreviverem ao F5 — ver
                // pushFeedCard()/initGlobalRealtime(). A re-renderização do
                // marquee acontece via Realtime, não na mão aqui.
                if (result === 'success' || result === 'common') {
                    pushFeedCard({...fusedCard});
                }
                if (result === 'success' || result === 'common') pushLedger(`${currentUser.username} fundiu ${id1}+${id2} → ${fusedCard.id} [${fusedCard.rarityNameEN}]`);
                else if (result === 'seguro_ativado') pushLedger(`${currentUser.username} ativou Núcleo de Backup em ${id1}+${id2} — ${id1} preservado`);
                else pushLedger(`${currentUser.username} tentou fundir ${id1}+${id2} — FALHA TOTAL`);
    
                document.getElementById('alchemyPanel').style.display = 'none';
                _alchSelected = { alpha: null, beta: null };
                renderVaultGrid();
                showCyberAlert(alertTitle, alertMsg, alertType);
    
            }, 1500); // ← 1500ms de glitch antes do pop-up
        }, 1200);
    }


    // =========================================================
    // [FIX VITRINE] renderShowcaseInventory — renderiza a vitrine pública
    // de forma isolada, limpando e repopulando o grid a partir do array
    // de assets já carregado (savedAssets para o dono, ou o array passado
    // para terceiros). Garante limpeza do container, ordenação por poder
    // decrescente e leitura estável das propriedades do card.
    // Corrige o STATE DESYNC em que cards com exposed:true não apareciam
    // por o container não ser limpo antes de repopular.
    // =========================================================
