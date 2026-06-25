// =========================================================
// dr0p_station — MÓDULO: profile-extra.js
// PERFIL — showcase, avatar/banner, busca de usuário, bio, depósito + CONTRATOS
//
// Parte 10 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

    function renderShowcaseInventory(assetsArray, displayEquipped, isOwner) {
        const showcaseGrid = document.getElementById('showcaseGrid');
        if (!showcaseGrid) return;

        // Limpa SEMPRE antes de repopular — evita duplicação/desync
        showcaseGrid.innerHTML = '';

        const RARITY_POWER = { ancestral: 4, legendary: 3, epic: 2, common: 1 };
        // Filtra apenas os expostos (exposed === true), independente de quem é o dono
        const exposed = (assetsArray || []).filter(a => a && a.exposed === true && !a.isPurged);
        // Ordena por poder decrescente (ancestral > legendary > epic > common)
        exposed.sort((a, b) => (RARITY_POWER[b.rarityType] || 0) - (RARITY_POWER[a.rarityType] || 0));

        if (exposed.length === 0) {
            showcaseGrid.innerHTML = '<div class="empty-vault-notice" style="grid-column:1/-1;">Nenhum ativo exposto na vitrine.</div>';
        } else {
            exposed.forEach((a) => {
                const card = document.createElement('div');
                card.className = 'album-card rare-' + (a.rarityType || 'common');
                applyCardMotionAttrs(card, a);
                const rarityColor = a.rarityType === 'ancestral' ? '#ff007f'
                    : a.rarityType === 'legendary' ? '#00ffff'
                    : a.rarityType === 'epic' ? '#ffaa00'
                    : '#aaaaaa';
                const rarityLabel = currentLang === 'PT'
                    ? (a.rarityName || a.rarityNameEN || a.rarityType || 'COMUM')
                    : (a.rarityNameEN || a.rarityName || a.rarityType || 'COMMON');
                card.innerHTML = '<div class="album-preview-wrapper"><img src="' + (a.imgSrc || '') + '" draggable="false" loading="lazy"></div>'
                    + '<div class="album-meta">'
                    + '<div class="album-id">' + (a.id || '—') + '</div>'
                    + '<div class="album-rarity" style="color:' + rarityColor + '">' + rarityLabel + '</div>'
                    + '</div>';
                card.querySelector('.album-preview-wrapper').addEventListener('click', function() { openInspectModal(a); });
                showcaseGrid.appendChild(card);
            });
        }
        // Reaplica o efeito de estante após repopular (o innerHTML acima não destrói as classes do grid)
        if (displayEquipped) applyEquippedShelfEffect(displayEquipped);
    }


    // =========================================================
    // [DEV CHANGER] FORÇAR GIF DE MOVIMENTO — botão discreto de desenvolvedor
    // Quando ativo, anula chances de erro nas fusões e força 100% dos
    // resultados a saírem com filtros dinâmicos glitch_layer e neon_pulse.
    // ACESSO: injetado discretamente no painel de fusão padrão.
    // =========================================================
    let _devForceGifMode = false;

    function toggleDevForceGif() {
        _devForceGifMode = !_devForceGifMode;
        const btn = document.getElementById('devForceGifBtn');
        if (btn) {
            btn.innerText = _devForceGifMode ? '⚡ GIF MODE: ON' : '⚡ FORÇAR GIF DE MOVIMENTO';
            btn.style.borderColor = _devForceGifMode ? '#00ff66' : '#333344';
            btn.style.color = _devForceGifMode ? '#00ff66' : '#555566';
            btn.style.boxShadow = _devForceGifMode ? '0 0 8px #00ff6655' : 'none';
        }
        if (_devForceGifMode) {
            console.warn('[DEV] FORÇAR GIF MODE ATIVADO — fusões retornam 100% com glitch_layer + neon_pulse');
        } else {
            console.info('[DEV] FORÇAR GIF MODE desativado — probabilidades normais restauradas');
        }
    }

    // =========================================================
    // BOTÃO "GIF" DA FUSÃO — controle do usuário (não confundir com o
    // dev changer acima). Quando ativo, marca o card resultante da
    // PRÓXIMA fusão como is_animated:true, fazendo-o herdar um filtro
    // de movimento contínuo (ver getCardMotionFilter) em todo o
    // ecossistema. É consumido (desativado) após cada fusão.
    // =========================================================
    let _fusionGifModeActive = false;

    function toggleFusionGifMode() {
        _fusionGifModeActive = !_fusionGifModeActive;
        const btn = document.getElementById('fusionGifBtn');
        if (btn) {
            btn.classList.toggle('active', _fusionGifModeActive);
            btn.innerText = _fusionGifModeActive
                ? (currentLang === 'PT' ? '🎞️ GIF: ATIVO' : '🎞️ GIF: ON')
                : '🎞️ GIF';
            btn.style.borderColor = _fusionGifModeActive ? '#ff00ff' : '';
            btn.style.color = _fusionGifModeActive ? '#ff00ff' : '';
        }
    }

    /**
     * Injeta o botão "GIF" no painel de fusão, caso ainda não exista.
     * Chamado no mesmo ponto em que o painel de alquimia é exibido.
     */
    function _injectFusionGifButtonIfAbsent() {
        const panel = document.getElementById('alchemyPanel');
        if (!panel) return;
        if (document.getElementById('fusionGifBtn')) return; // já injetado
        const gifBtn = document.createElement('button');
        gifBtn.id = 'fusionGifBtn';
        gifBtn.className = 'btn-action';
        gifBtn.innerText = '🎞️ GIF';
        gifBtn.title = currentLang === 'PT'
            ? 'Marca o card resultante desta fusão como ativo animado (movimento contínuo).'
            : 'Marks the result of this fusion as an animated asset (continuous motion).';
        gifBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleFusionGifMode(); });
        panel.appendChild(gifBtn);
    }

    /**
     * Injeta o botão de dev no painel de fusão após ele ser exibido.
     * Chamado após alchemyPanel.style.display = 'block' ou equivalente.
     */
    function _injectDevChangerIfAbsent() {
        const panel = document.getElementById('alchemyPanel');
        if (!panel) return;
        if (document.getElementById('devForceGifBtn')) return; // já injetado
        const devBtn = document.createElement('button');
        devBtn.id = 'devForceGifBtn';
        devBtn.className = 'btn-action';
        devBtn.style.cssText = [
            'border-color:#333344', 'color:#555566',
            'font-size:0.45rem', 'letter-spacing:1px',
            'padding:4px 10px', 'margin-top:8px',
            'opacity:0.6', 'transition:all 0.2s'
        ].join(';');
        devBtn.innerText = '⚡ FORÇAR GIF DE MOVIMENTO';
        devBtn.title = '[DEV] Força 100% de resultados em movimento com glitch_layer + neon_pulse';
        devBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleDevForceGif(); });
        // Insere no final do panel, de forma discreta
        panel.appendChild(devBtn);
    }

    /**
     * Aplica os filtros dinâmicos forçados (glitch_layer + neon_pulse) quando
     * _devForceGifMode está ativo. Substitui o filtro natural da fusão.
     */
    function _applyDevGifFilters(canvas, SIZE) {
        if (!_devForceGifMode) return canvas;
        const ctx2 = canvas.getContext('2d');
        // Camada glitch_layer
        const tmp1 = document.createElement('canvas');
        tmp1.width = SIZE; tmp1.height = SIZE;
        const c1 = tmp1.getContext('2d');
        c1.filter = 'saturate(1000%) hue-rotate(200deg) contrast(250%) brightness(60%)'; // GLITCH_LAYER
        c1.drawImage(canvas, 0, 0, SIZE, SIZE);
        c1.filter = 'none';
        ctx2.clearRect(0, 0, SIZE, SIZE);
        ctx2.drawImage(tmp1, 0, 0);
        // Camada neon_pulse sobreposta com blend
        const tmp2 = document.createElement('canvas');
        tmp2.width = SIZE; tmp2.height = SIZE;
        const c2 = tmp2.getContext('2d');
        c2.filter = 'hue-rotate(120deg) saturate(850%) contrast(180%) brightness(88%)'; // NEON_PULSE
        c2.globalAlpha = 0.35;
        c2.drawImage(canvas, 0, 0, SIZE, SIZE);
        c2.filter = 'none';
        ctx2.globalAlpha = 0.65;
        ctx2.drawImage(tmp2, 0, 0);
        ctx2.globalAlpha = 1.0;
        // Marca DEV watermark
        ctx2.fillStyle = 'rgba(0,255,102,0.7)';
        ctx2.font = 'bold 10px Space Mono';
        ctx2.fillText('[DEV:GIF_FORCE]', 10, SIZE - 8);
        return canvas;
    }

    async function viewTargetUserCollection(username, code, bio, avatar, banner, isOwner) {
        selectedProfileUser = username;

        // Identidade
        document.getElementById('profUsername').innerText = username;
        document.getElementById('profCode').innerText = code || '#0000';
        document.getElementById('profBioView').innerText = bio || '';

        // Busca o profile completo do ALVO sendo exibido (uma única vez, reaproveitado
        // abaixo pra vitrine/follow/cosméticos) sempre que não for o próprio dono.
        // Isso é o que garante que moldura/fundo neon/adereço/estante mostrados na tela
        // são SEMPRE os do dono daquele perfil — nunca os do currentUser logado, que
        // só entra em jogo quando isOwner === true. Sem isso, visitar o perfil de outra
        // pessoa "vazaria" os cosméticos equipados por quem está logado.
        const targetProfile = isOwner ? null : await fetchProfileByUsername(username);
        const displayFrame = isOwner
            ? (currentUser.avatarFrame || FRAME_DEFAULT_ID)
            : ((targetProfile && targetProfile.avatar_frame) || FRAME_DEFAULT_ID);
        const displayEquipped = isOwner
            ? (currentUser.equippedCosmetics || { background: null, prop: null, shelf: null, emoticon: null })
            : ((targetProfile && targetProfile.equipped_cosmetics && typeof targetProfile.equipped_cosmetics === 'object')
                ? { background: null, prop: null, shelf: null, emoticon: null, ...targetProfile.equipped_cosmetics }
                : { background: null, prop: null, shelf: null, emoticon: null });

        // Avatar do usuário logado/visitado (BUGFIX: avatar sumido da tela de perfil)
        const avatarImg = document.getElementById('profAvatarImg');
        if (avatarImg) avatarImg.src = avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg';
        const avatarFrameWrap = document.getElementById('avatarFrameWrap');
        if (avatarFrameWrap) {
            avatarFrameWrap.classList.remove('frame-style-1', 'frame-style-2', 'frame-style-3', 'frame-style-4', 'frame-subnet-static-pulse');
            avatarFrameWrap.classList.add(displayFrame);
            // Esconde o label "MUDAR AVATAR" e o onclick em perfis de terceiros
            const avatarOverlayLabel = avatarFrameWrap.querySelector('.avatar-overlay-label');
            if (avatarOverlayLabel) avatarOverlayLabel.style.display = isOwner ? '' : 'none';
            avatarFrameWrap.style.cursor = isOwner ? 'pointer' : 'default';
            avatarFrameWrap.onclick = isOwner ? openAvatarSelector : null;
        }
        // Aplica os 3 efeitos visuais reais (glow de fundo, adereço de card,
        // estante) usando ESTRITAMENTE os cosméticos do perfil exibido.
        applyAllEquippedEffects(displayEquipped);

        // Banner — detecta se é gradient CSS ou URL de imagem
        const bannerEl = document.getElementById('profBannerView');
        if (bannerEl) {
            // Para visitantes de terceiros, usa o banner do targetProfile se disponível
            const bannerValue = (!isOwner && targetProfile && targetProfile.banner)
                ? targetProfile.banner
                : banner;
            if (!bannerValue) {
                bannerEl.style.backgroundImage = '';
                bannerEl.style.background = '';
            } else if (bannerValue.startsWith('linear-gradient') || bannerValue.startsWith('radial-gradient')) {
                bannerEl.style.backgroundImage = 'none';
                bannerEl.style.background = bannerValue;
            } else {
                bannerEl.style.background = '';
                bannerEl.style.backgroundImage = `url(${bannerValue})`;
            }
        }

        // Saldo (somente para o próprio usuário)
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = isOwner ? `${currentUser.bumps} B$` : '--- B$';

        // [ESCOPO 3] Troca botão: CARREGAR (próprio) / TRANSFERIR BUMPS (terceiro)
        const depositOrTransferBtn = document.getElementById('profDepositOrTransferBtn');
        if (depositOrTransferBtn) {
            if (isOwner) {
                depositOrTransferBtn.innerText = '+ CARREGAR';
                depositOrTransferBtn.onclick = () => openDepositModal();
                depositOrTransferBtn.style.borderColor = '';
                depositOrTransferBtn.style.color = '';
            } else {
                depositOrTransferBtn.innerText = '↗ TRANSFERIR BUMPS';
                depositOrTransferBtn.onclick = () => {
                    if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', 'Faça login para transferir Bumps.', 'error'); return; }
                    openTransferBumpsModal(username);
                };
                depositOrTransferBtn.style.borderColor = '#00ffff';
                depositOrTransferBtn.style.color = '#00ffff';
            }
        }

        // Zona de edição só aparece para o próprio perfil
        const editZone = document.getElementById('profileEditZone');
        if (editZone) editZone.style.display = isOwner ? 'block' : 'none';

        // ── PONTO 2: trava de usuário logado no botão [ INVENTÁRIO DE RELÍQUIAS ] ──
        // Só renderiza/exibe o botão quando o profile.id do perfil visualizado é
        // igual ao user.id da sessão logada. Visitantes nunca veem este botão,
        // mesmo manipulando o DOM manualmente (openRelicInventoryModal também
        // re-checa isso por segurança).
        const relicBtn = document.getElementById('relicInventoryBtn');
        if (relicBtn) relicBtn.style.display = isOwner ? 'block' : 'none';

        // Inventário de equipamentos (Molduras/Acessórios da Loja do Spike) —
        // também exclusivo do dono do perfil.
        renderEquipmentInventory(isOwner);
        if (isOwner) renderRelicInventoryModal();

        const inputBio = document.getElementById('inputBio');
        if (inputBio) inputBio.value = isOwner ? (bio || '') : '';
        // Sempre volta o editor de bio pro estado fechado (botão visível, textarea oculta)
        // ao trocar de perfil, evitando que a área de edição "vaze" do usuário A pro B.
        cancelBioEdit();

        // Vitrine: assets expostos do usuário-alvo
        // (também usado pra obter o id real do usuário-alvo, necessário pro follow)
        let sourceAssets = savedAssets;
        let targetUserId = isOwner ? currentUser.id : null;
        if (!isOwner) {
            targetUserId = targetProfile ? targetProfile.id : null;
            sourceAssets = targetProfile ? await loadCardsFromSupabase(targetProfile.id) : [];
        }
        const exposedAssets = sourceAssets.filter(a => a.exposed);
        // Ordenação: da carta mais rara/poderosa para a menos rara
        const RARITY_POWER = { ancestral: 4, legendary: 3, epic: 2, common: 1 };
        exposedAssets.sort((a, b) => (RARITY_POWER[b.rarityType] || 0) - (RARITY_POWER[a.rarityType] || 0));
        // [FIX VITRINE] Usa a função centralizada renderShowcaseInventory
        // que garante limpeza do container, ordenação por poder e leitura
        // estável das propriedades — corrige o state desync da vitrine.
        renderShowcaseInventory(sourceAssets, displayEquipped, isOwner);

        const showcaseRankArea = document.getElementById('showcaseRankArea');
        if (showcaseRankArea) computeCollectionLevel(sourceAssets, showcaseRankArea);

        // ── FOLLOW: contadores reais (tabela public.followers) + botão seguir ──
        // (ver Parte 5/4: fetchFollowState / followUser / unfollowUser)
        const followersLbl = document.getElementById('lbl-followers');
        const followingLbl = document.getElementById('lbl-following');
        const socialActionZone = document.getElementById('socialActionZone');
        if (targetUserId) {
            const followState = await fetchFollowState(targetUserId);
            if (followersLbl) followersLbl.innerText = followState.followers;
            if (followingLbl) followingLbl.innerText = followState.following;

            if (socialActionZone) {
                socialActionZone.innerHTML = '';
                if (!isOwner && currentUser.loggedIn) {
                    const followBtn = document.createElement('button');
                    followBtn.className = 'btn-action follow-toggle-btn';
                    followBtn.innerText = followState.followedByMe ? 'SEGUINDO' : 'SEGUIR';
                    followBtn.classList.toggle('following-active', followState.followedByMe);
                    followBtn.addEventListener('click', () => toggleFollowTarget(targetUserId, followBtn));
                    socialActionZone.appendChild(followBtn);
                }
            }
        } else {
            if (followersLbl) followersLbl.innerText = '0';
            if (followingLbl) followingLbl.innerText = '0';
            if (socialActionZone) socialActionZone.innerHTML = '';
        }

        renderProfileBadges(username);
    }

    // ── NÍVEL DE COLEÇÃO ──────────────────────────────────────────
    // BUGFIX (veracidade do nível): esta é a ÚNICA fonte de verdade
    // para o cálculo do nível de coleção. openInspectModal() agora
    // chama esta mesma função (em vez de uma fórmula paralela baseada
    // em globalFeed) para que o nível mostrado no Inspect bata 1:1
    // com o nível mostrado na Vitrine do perfil.
    // [ESCOPO 7] Títulos de nível da conta — 4 tiers conforme solicitado.
    // Curva de XP suavizada: thresholds mais espaçados e pesos por card
    // reduzidos em relação à versão anterior, pra a progressão entre
    // níveis ficar mais gradual (evita o salto abrupto de tier que a
    // pontuação antiga causava com poucos cards lendários/épicos).
    const COLLECTION_TIERS = [
        { min: 0,   label: 'NETRUNNER FANTASMA',           icon: '👻', cls: 'rank-basic'   },
        { min: 18,  label: 'ESPECULADOR DA SUB-REDE',      icon: '📡', cls: 'rank-hype'    },
        { min: 42,  label: 'SIFÃO DE DADOS',                icon: '🌀', cls: 'rank-elite'   },
        { min: 80,  label: 'MODIFICADOR DE SILÍCIO',        icon: '⚡', cls: 'rank-godlike' }
    ];

    function scoreFromAssets(items) {
        let score = 0;
        (items || []).forEach(i => {
            // Pesos reduzidos (antes: legendary 12 / epic 6 / common 2) —
            // suaviza a curva pra cada card individual pesar menos no
            // score total, exigindo uma coleção mais ampla pra subir de
            // nível em vez de um único drop sortudo destravar o tier todo.
            if (i.rarityType === 'ancestral') score += 10;
            else if (i.rarityType === 'legendary') score += 7;
            else if (i.rarityType === 'epic') score += 3;
            else score += 1;
        });
        return score;
    }

    function computeCollectionLevel(items, areaElement) {
        if(!areaElement) return;
        const score = scoreFromAssets(items);

        let tierIndex = 0;
        for (let i = 0; i < COLLECTION_TIERS.length; i++) {
            if (score >= COLLECTION_TIERS[i].min) tierIndex = i;
        }
        const tier = COLLECTION_TIERS[tierIndex];
        const nextTier = COLLECTION_TIERS[tierIndex + 1] || null;
        const isMaxed = !nextTier;
        const pointsToNext = isMaxed ? 0 : (nextTier.min - score);
        const pct = isMaxed ? 100 : Math.max(4, Math.min(100, Math.round(((score - tier.min) / (nextTier.min - tier.min)) * 100)));

        // 10 "pontos" de progresso em estilo terminal (cada bolinha = 10% do trajeto até o próximo nível)
        const totalDots = 10;
        const filledDots = Math.round((pct / 100) * totalDots);
        const dotsHtml = Array.from({ length: totalDots }, (_, idx) =>
            `<span class="${idx < filledDots ? 'dot-filled' : ''}">${idx < filledDots ? '●' : '○'}</span>`
        ).join(' ');

        const nextLabel = isMaxed
            ? '<span class="next-lvl-tag">NÍVEL MÁXIMO ATINGIDO</span>'
            : `<span class="next-lvl-tag">FALTAM <b style="color:#00ffff;">${pointsToNext} PTS</b> P/ PRÓXIMO NÍVEL</span>`;

        areaElement.innerHTML = `
            <div class="showcase-rank-badge ${tier.cls}">${tier.icon} STATUS: ${tier.label} (LVL ${score || 1})</div>
            <div class="collection-progress-wrap">
                <div class="collection-progress-terminal">
                    <span>&gt; SCORE_ATUAL: <b style="color:#00ff66;">${score}</b> PTS</span>
                    ${nextLabel}
                </div>
                <div class="collection-progress-bar-track">
                    <div class="collection-progress-bar-fill${isMaxed ? ' maxed' : ''}" style="width:${pct}%;"></div>
                </div>
                <div class="collection-progress-dots">${dotsHtml}</div>
            </div>
        `;
    }

    let currentFrameFilter = 'todos';

    function openAvatarSelector() {
        if(selectedProfileUser !== currentUser.username) return;
        document.getElementById('avatarSelectorModal').style.display = 'flex';
        renderFrameSelectorRow(currentFrameFilter);
        const grid = document.getElementById('avatarSelectorGrid'); grid.innerHTML = '';

        // Apenas avatares no cofre que NÃO estão em custódia/listados no mercado
        const availableAssets = savedAssets.filter(a => a.isListed === false && a.forSale === false);

        if(availableAssets.length === 0) {
            grid.innerHTML = '<div class="empty-vault-notice" style="grid-column:1/-1;">Cofre sem dados sincronizados.</div>'; return;
        }
        availableAssets.forEach((a) => {
            const div = document.createElement('div'); div.className = 'album-card'; div.style.padding = '5px';
            div.onclick = async () => {
                currentUser.avatar = a.imgSrc;
                document.getElementById('profAvatarImg').src = a.imgSrc;
                await updateProfileInSupabase(currentUser.id, { avatar: a.imgSrc });
                closeAvatarSelector();
            };
            const gifBadge = a.isAnimated ? '<span style="position:absolute;top:3px;right:3px;background:#ff00ff;color:#000;font-size:0.4rem;font-weight:bold;padding:1px 4px;border-radius:2px;z-index:2;">GIF</span>' : '';
            div.innerHTML = `<div class="album-preview-wrapper" style="position:relative;">${gifBadge}<img src="${a.imgSrc}" loading="lazy"></div>`;
            grid.appendChild(div);
        });
    }

    // ── PONTO 3: SELETOR DE MOLDURAS AMPLIADO COM FILTROS DE RARIDADE ──
    const FRAME_RARITY_LABELS = { todos: 'TODOS', raro: 'RARO', lendario: 'LENDÁRIO', ancestral: 'ANCESTRAL' };
    const FRAME_RARITY_ICONS  = { raro: '⬡', lendario: '◈', ancestral: '☠' };

    function setFrameFilter(filter) {
        currentFrameFilter = filter;
        renderFrameSelectorRow(filter);
    }

    // Lista completa das molduras selecionáveis: a padrão (grátis, sempre
    // possuída) + as vendidas na Loja (NEON_PULSE / GLITCH_CORE /
    // APOCALYPSE_OVERRIDE / STATIC_PULSE).
    function allSelectableFrames() {
        return [
            { id: FRAME_DEFAULT_ID, category: 'moldura', name: 'Neon Hexlock', accent: '#00ffff', rarity: FRAME_DEFAULT_RARITY, free: true },
            ...LOJA_FRAME_ITEMS,
            ...LOJA_SUBNET_FRAME_ITEMS
        ];
    }

    function frameSelectorButtonMarkup(frame) {
        const owned = frame.free || (Array.isArray(currentUser.cosmetics) && currentUser.cosmetics.includes(frame.id));
        const isActive = (currentUser.avatarFrame || FRAME_DEFAULT_ID) === frame.id;
        const opacity = isActive ? '1' : (owned ? '0.45' : '0.35');

        if (!owned) {
            // Trava de segurança: usuário não tem o item no array cosmetics.
            return `
                <button class="btn-action frame-locked-btn" style="border-color:#333; flex:1; opacity:${opacity}; cursor:not-allowed; color:#555;" disabled data-frame="${frame.id}" data-rarity="${frame.rarity}">
                    🔒 BLOQUEADO - VISITE O SPIKE
                </button>`;
        }

        return `
            <button class="btn-action" style="border-color:${frame.accent}; flex:1; opacity:${opacity};" data-frame="${frame.id}" data-rarity="${frame.rarity}" onclick="lojaEquipFrame('${frame.id}')">
                ${FRAME_RARITY_ICONS[frame.rarity] || '⬡'} ${frame.name.toUpperCase()}
            </button>`;
    }

    function renderFrameSelectorRow(filter) {
        const filterZone = document.getElementById('frameFilterZone');
        if (filterZone) {
            filterZone.innerHTML = Object.keys(FRAME_RARITY_LABELS).map(key => `
                <button class="filter-btn${filter === key ? ' active' : ''}" onclick="setFrameFilter('${key}')">[ ${FRAME_RARITY_LABELS[key]} ]</button>
            `).join('');
        }

        const row = document.getElementById('frameSelectorRow');
        if (!row) return;
        const frames = allSelectableFrames().filter(f => filter === 'todos' || f.rarity === filter);
        row.innerHTML = frames.length
            ? frames.map(frameSelectorButtonMarkup).join('')
            : '<p style="font-size:0.6rem; color:#666;">Nenhuma moldura nessa raridade ainda.</p>';
    }

    // ── MOLDURAS CYBERPUNK: 5 modelos (frame-style-1 "NEON HEXLOCK" grátis,
    // frame-style-2 "NEON PULSE", frame-style-3 "GLITCH CORE", frame-style-4
    // "APOCALYPSE OVERRIDE", frame-subnet-static-pulse "STATIC PULSE" — os 4
    // últimos só compráveis na Loja do Spike/ZRK). ──
    async function setAvatarFrame(frameId) {
        if(selectedProfileUser !== currentUser.username) return;

        // Trava de segurança (camada extra, além do botão já vir desabilitado
        // no markup): nunca persiste uma moldura que o usuário não possui.
        if (frameId !== FRAME_DEFAULT_ID && (!Array.isArray(currentUser.cosmetics) || !currentUser.cosmetics.includes(frameId))) {
            console.warn('[MOLDURA] Bloqueado: usuário não possui', frameId);
            if (typeof showCyberAlert === 'function') {
                showCyberAlert('BLOQUEADO', 'Você ainda não possui essa moldura. Visite o ZRK na Loja.', 'error');
            }
            return;
        }

        currentUser.avatarFrame = frameId;
        const avatarFrameWrap = document.getElementById('avatarFrameWrap');
        if (avatarFrameWrap) {
            avatarFrameWrap.classList.remove(FRAME_DEFAULT_ID, 'frame-style-2', 'frame-style-3', 'frame-style-4', 'frame-subnet-static-pulse');
            avatarFrameWrap.classList.add(frameId);
        }
        document.querySelectorAll('#frameSelectorRow [data-frame]').forEach(b => {
            b.style.opacity = (b.dataset.frame === frameId) ? '1' : '0.45';
        });
        await updateProfileInSupabase(currentUser.id, { avatarFrame: frameId });
    }
    function closeAvatarSelector() { document.getElementById('avatarSelectorModal').style.display = 'none'; }

    const DEFAULT_BANNERS = [
        { id: 'default-neon',   label: 'NEON GRID',     css: 'linear-gradient(135deg, #000510 0%, #001a33 40%, #003366 60%, #000510 100%)' },
        { id: 'default-cyber',  label: 'CYBER CRIMSON', css: 'linear-gradient(135deg, #0d0005 0%, #330011 40%, #660022 60%, #0d0005 100%)' },
        { id: 'default-matrix', label: 'MATRIX PULSE',  css: 'linear-gradient(135deg, #000d00 0%, #001a00 40%, #003300 60%, #000d00 100%)' }
    ];

    function openBannerSelector() {
        document.getElementById('bannerSelectorModal').style.display = 'flex';
        const grid = document.getElementById('bannerSelectorGrid'); grid.innerHTML = '';

        // Default banners (always available)
        const defaultSection = document.createElement('div');
        defaultSection.innerHTML = '<div style="font-size:0.55rem; color:#888899; letter-spacing:2px; margin-bottom:8px;">BANNERS PADRÃO CYBERPUNK</div>';
        const defaultGrid = document.createElement('div');
        defaultGrid.className = 'default-banner-grid';
        DEFAULT_BANNERS.forEach(b => {
            const card = document.createElement('div');
            card.className = 'default-banner-card';
            card.style.background = b.css;
            card.innerHTML = `<span>${b.label}</span>`;
            card.onclick = async () => {
                currentUser.banner = b.css;
                const bv = document.getElementById('profBannerView');
                bv.style.backgroundImage = 'none';
                bv.style.background = b.css;
                document.getElementById('bannerLockStatus').innerText = b.label;
                document.getElementById('bannerLockStatus').style.color = '#00ffff';
                await updateProfileInSupabase(currentUser.id, { banner: b.css });
                closeBannerSelector();
            };
            defaultGrid.appendChild(card);
        });
        defaultSection.appendChild(defaultGrid);
        grid.appendChild(defaultSection);

        // FILTRO ESTRITO: apenas itens com a tag 'evento'. Cards 'Fundidos' (Fused)
        // são EXCLUÍDOS mesmo que tragam a tag evento, pois não têm o tamanho/proporção
        // corretos para banner. Itens lendários "legados" sem a tag também não entram mais —
        // a regra agora é estritamente por tag, conforme solicitado.
        const eventItems = savedAssets.filter(i => i.tags && i.tags.includes('evento') && !i.isFused);

        const eventSection = document.createElement('div');
        eventSection.innerHTML = '<div style="font-size:0.55rem; color:#ff00ff; letter-spacing:2px; margin:12px 0 8px;">BANNERS DE EVENTO (CARDS TAG: EVENTO)</div>';

        const allEventCards = eventItems;
        if (allEventCards.length === 0) {
            eventSection.innerHTML += '<div style="color:#666; font-size:0.6rem; padding:8px;">Nenhum card de evento elegível no cofre. Apenas cards com tag [EVENTO] (não-fundidos) desbloqueiam banners personalizados.</div>';
        } else {
            allEventCards.forEach(item => {
                const row = document.createElement('div');
                if (item.isListed) {
                    row.style.cssText = "background:#111; border:1px solid #ff0044; padding:10px; display:flex; justify-content:space-between; align-items:center; opacity:0.5; cursor:not-allowed; margin-bottom:6px;";
                    row.innerHTML = `<span style="font-size:0.65rem; color:#ff0044;">🔒 CUSTÓDIA: ${item.id}</span>`;
                } else {
                    row.style.cssText = "background:#111; border:1px solid #ff00ff; padding:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; margin-bottom:6px;";
                    row.innerHTML = `<img src="${item.imgSrc}" style="width:40px;height:40px;object-fit:cover;border:1px solid #ff00ff;margin-right:10px;"><span style="font-size:0.65rem; color:#fff; flex:1;">${item.id} [${item.rarityNameEN}]</span>`;
                    row.onclick = async () => {
                        currentUser.banner = item.imgSrc;
                        document.getElementById('profBannerView').style.backgroundImage = `url(${item.imgSrc})`;
                        document.getElementById('bannerLockStatus').innerText = `BANNER: ${item.id}`;
                        document.getElementById('bannerLockStatus').style.color = '#00ffff';
                        await updateProfileInSupabase(currentUser.id, { banner: item.imgSrc });
                        closeBannerSelector();
                    };
                }
                eventSection.appendChild(row);
            });
        }
        grid.appendChild(eventSection);
    }
    function closeBannerSelector() { document.getElementById('bannerSelectorModal').style.display = 'none'; }

    // =========================================================
    // [ESCOPO 6] BARRA DE BUSCA — localiza jogadores por @username
    // Sugestões ao vivo (ilike) enquanto digita + busca exata no Enter/clique
    // no botão. Reaproveita viewExternalProfile() pra navegação.
    // =========================================================
    let _userSearchDebounce = null;

    function _normalizeSearchTerm(raw) {
        return (raw || '').trim().replace(/^@/, '');
    }

    async function handleGlobalUserSearchInput() {
        clearTimeout(_userSearchDebounce);
        const input = document.getElementById('globalUserSearchInput');
        const box = document.getElementById('globalUserSearchSuggest');
        if (!input || !box) return;
        const term = _normalizeSearchTerm(input.value);

        if (term.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }

        _userSearchDebounce = setTimeout(async () => {
            const { data, error } = await sb.from('profiles')
                .select('username, avatar, code')
                .ilike('username', `%${term}%`)
                .limit(6);
            if (error) { console.error('handleGlobalUserSearchInput:', error.message); return; }
            if (!data || data.length === 0) {
                box.innerHTML = '<div class="gus-suggest-empty">Nenhum operador encontrado.</div>';
                box.style.display = 'block';
                return;
            }
            box.innerHTML = data.map(p => `
                <div class="gus-suggest-item" onclick="selectUserSearchResult('${p.username.replace(/'/g, "\\'")}')">
                    <img src="${p.avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg'}" class="gus-suggest-avatar">
                    <span>@${p.username}</span>
                    <span class="gus-suggest-code">${p.code || ''}</span>
                </div>
            `).join('');
            box.style.display = 'block';
        }, 250);
    }

    function selectUserSearchResult(username) {
        const input = document.getElementById('globalUserSearchInput');
        const box = document.getElementById('globalUserSearchSuggest');
        if (input) input.value = '';
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        viewExternalProfile(username);
    }

    async function searchAndLoadUserProfile() {
        const input = document.getElementById('globalUserSearchInput');
        const box = document.getElementById('globalUserSearchSuggest');
        if (!input) return;
        const term = _normalizeSearchTerm(input.value);
        if (!term) return;
        if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        const profile = await fetchProfileByUsername(term);
        if (!profile) {
            showCyberAlert('NÓ NÃO ENCONTRADO', `Nenhum operador com o handle @${term} está registrado na rede.`, 'error');
            return;
        }
        input.value = '';
        viewExternalProfile(term);
    }

    // Fecha o dropdown de sugestões ao clicar fora dele
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('globalUserSearch');
        const box = document.getElementById('globalUserSearchSuggest');
        if (wrapper && box && !wrapper.contains(e.target)) { box.style.display = 'none'; }
    });

    // [FIX ANTI-CRASH] viewExternalProfile blindado com safeNavigationRouter
    async function viewExternalProfile(username) {
        if (!username || typeof username !== 'string') {
            console.warn('[safeNavigationRouter] viewExternalProfile: username inválido', username);
            return;
        }
        try {
            closeInspectModal();
        } catch(e) {}
        try {
            const p = await fetchProfileByUsername(username);
            // BUGFIX (redirecionamento): troca a tela ANTES de popular os dados,
            // e usa skipProfileReload=true para impedir que navigateTo('profile')
            // recarregue o perfil do usuário logado por cima do perfil-alvo.
            navigateTo('profile', true);
            if(p) {
                await viewTargetUserCollection(p.username, p.code, p.bio, p.avatar, p.banner, p.username === currentUser.username);
            } else {
                await viewTargetUserCollection(username, "#9999", "Membro estável.", "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", "", false);
            }
        } catch(e) {
            console.warn('viewExternalProfile error (fallback mockup):', e);
            try {
                navigateTo('profile', true);
                await viewTargetUserCollection(username, "#9999", "Operador desconectado.", "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", "", false);
            } catch(e2) { console.warn('viewExternalProfile fallback failed:', e2); }
        }
    }

    function toggleBioEdit() {
        const textarea = document.getElementById('inputBio');
        const actions = document.getElementById('bioEditActions');
        const btn = document.getElementById('btnEditBio');
        if (!textarea) return;
        textarea.value = currentUser.bio || '';
        textarea.classList.add('active');
        actions.classList.add('active');
        btn.style.display = 'none';
        textarea.focus();
    }

    function cancelBioEdit() {
        const textarea = document.getElementById('inputBio');
        const actions = document.getElementById('bioEditActions');
        const btn = document.getElementById('btnEditBio');
        if (textarea) textarea.classList.remove('active');
        if (actions) actions.classList.remove('active');
        if (btn) btn.style.display = '';
    }

    async function saveProfileCustoms() {
        const bioVal = document.getElementById('inputBio').value.trim();
        currentUser.bio = bioVal;
        const bioView = document.getElementById('profBioView');
        if (bioView) bioView.innerText = bioVal;
        cancelBioEdit();
        await updateProfileInSupabase(currentUser.id, { bio: bioVal });
    }

    function openDepositModal() { document.getElementById('depositModal').style.display = 'flex'; }
    function closeDepositModal() { document.getElementById('depositModal').style.display = 'none'; }

    async function simularDeposito(amount) {
        currentUser.bumps += amount;
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });
        const walletBadgeD = document.getElementById('wallet-balance-badge');
        if (walletBadgeD) walletBadgeD.innerText = `${currentUser.bumps} B$`;
        playSynthSound('success');
        closeDepositModal();
        showCyberAlert('// INJEÇÃO DE CARGA CONCLUÍDA //', `+<b>${amount} B$</b> adicionados ao teu terminal.<br>Saldo actual: <b>${currentUser.bumps} B$</b>`, 'success');
    }

    async function setUserStatus(status) {
        currentUser.status = status;
        const dot = document.getElementById('userStatusDot');
        const sc = status === 'away' ? 'status-away' : status === 'busy' ? 'status-busy' : 'status-online';
        if (dot) dot.className = `user-status-dot ${sc}`;
        document.querySelectorAll('#statusSelectorZone .status-btn').forEach(b => {
            b.className = 'status-btn' + (b.dataset.s === status ? ` active-${status === 'online' ? 'online' : status === 'away' ? 'away' : 'busy'}` : '');
        });
        await updateProfileInSupabase(currentUser.id, { status });
    }

    buildStoriesMarquee();
    renderQuotesTicker();


    // =========================================================
    // SISTEMA DE CONTRATOS / MISSÕES DE INVASÃO (Idle Staking)
    // =========================================================

    // Cada contrato agora tem riskChance (0–1): probabilidade de o card ser
    // CORROMPIDO (destruído) ao final da missão. Isso cria um dreno real
    // de cartas comuns e evita acúmulo infinito no mercado.
    const CONTRACTS_DB = [
        {
            id: 'CTR-01',
            name: 'Infiltrar Data Center',
            desc: 'Acesse o núcleo de dados corporativo e exfiltre arquivos sensíveis antes que o firewall reative.',
            durationMs: 60 * 1000,
            durationLabel: '1 MIN',
            reqCount: 1,
            reqRarity: 'common',
            reqLabel: '1 Card Comum',
            reward: 5,
            riskChance: 0.15, // 15% de chance de corrupção
            riskLabel: '⚠ 15% RISCO DE CORRUPÇÃO'
        },
        {
            id: 'CTR-02',
            name: 'Drenar Banco de Neom',
            desc: 'Infiltra o sistema bancário de Neom e redireciona créditos para a carteira fantasma da rede.',
            durationMs: 5 * 60 * 1000,
            durationLabel: '5 MIN',
            reqCount: 2,
            reqRarity: 'epic',
            reqLabel: '2 Cards Épicos',
            reward: 30,
            riskChance: 0.25, // 25% de chance de corrupção
            riskLabel: '⚠ 25% RISCO DE CORRUPÇÃO'
        },
        {
            id: 'CTR-03',
            name: 'Hackear Satélite Militar',
            desc: 'Operação de alto risco. Intercepta o sinal de controle do satélite orbital e redireciona o feed.',
            durationMs: 15 * 60 * 1000,
            durationLabel: '15 MIN',
            reqCount: 1,
            reqRarity: 'legendary',
            reqLabel: '1 Card Lendário',
            reward: 100,
            riskChance: 0.35, // 35% de chance de corrupção
            riskLabel: '⚠ 35% RISCO DE CORRUPÇÃO'
        },
        {
            id: 'CTR-04',
            name: 'Purgar Protocolo Ghost',
            desc: 'Missão suicida. Queime 3 cartas comuns como isca para atrair os scanners e abrir caminho para a rede fantasma.',
            durationMs: 3 * 60 * 1000,
            durationLabel: '3 MIN',
            reqCount: 3,
            reqRarity: 'common',
            reqLabel: '3 Cards Comuns',
            reward: 25,
            riskChance: 0.50, // 50% de chance de corrupção — alto risco, maior recompensa relativa
            riskLabel: '☠ 50% RISCO DE DESTRUIÇÃO'
        }
    ];

    const ACTIVE_CONTRACTS_KEY = 'dr0p_active_contracts';
    let _contractTimers = {}; // intervalId por contractId
    let _pendingContractId = null;
    let _selectedContractCards = [];

    function loadActiveContracts() {
        if (!currentUser.loggedIn) return {};
        try {
            const all = JSON.parse(localStorage.getItem(ACTIVE_CONTRACTS_KEY)) || {};
            return all[currentUser.username] || {};
        } catch(e) { return {}; }
    }

    function saveActiveContracts(obj) {
        try {
            const all = JSON.parse(localStorage.getItem(ACTIVE_CONTRACTS_KEY)) || {};
            all[currentUser.username] = obj;
            localStorage.setItem(ACTIVE_CONTRACTS_KEY, JSON.stringify(all));
        } catch(e) {}
    }

    function startContractTimer(contractId, endTs, cardIds) {
        if (_contractTimers[contractId]) clearInterval(_contractTimers[contractId]);

        _contractTimers[contractId] = setInterval(() => {
            const now = Date.now();
            const remaining = endTs - now;

            // Atualiza barra e label se a tela estiver visível
            const fill = document.getElementById(`ctimer-fill-${contractId}`);
            const label = document.getElementById(`ctimer-label-${contractId}`);
            const contract = CONTRACTS_DB.find(c => c.id === contractId);
            if (fill && label && contract) {
                const pct = Math.max(0, (remaining / contract.durationMs) * 100);
                fill.style.width = pct + '%';
                if (remaining > 0) {
                    label.innerText = `⏱ ${formatContractTime(remaining)} RESTANTES`;
                }
            }

            if (remaining <= 0) {
                clearInterval(_contractTimers[contractId]);
                delete _contractTimers[contractId];
                concludeContract(contractId, cardIds);
            }
        }, 1000);
    }

    function formatContractTime(ms) {
        const totalSec = Math.ceil(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return m > 0 ? `${m}m ${s.toString().padStart(2,'0')}s` : `${s}s`;
    }

    async function concludeContract(contractId, cardIds) {
        const contract = CONTRACTS_DB.find(c => c.id === contractId);
        if (!contract) return;

        // === RISCO DE CORRUPÇÃO ===
        const riskChance = contract.riskChance || 0;
        const corruptedIds = [];
        const survivedIds   = [];

        cardIds.forEach(cid => {
            if (riskChance > 0 && Math.random() < riskChance) {
                corruptedIds.push(cid);
            } else {
                survivedIds.push(cid);
            }
        });

        // Marca cards corrompidos como purged (não apaga) + concede Fragmentos de Sucata
        let fragmentsEarned = 0;
        for (const cid of corruptedIds) {
            const idx = savedAssets.findIndex(a => a.id === cid);
            const card = idx > -1 ? savedAssets[idx] : null;
            try {
                // BUGFIX: a query usava .eq('id', cid) comparando o id de
                // EXIBIÇÃO (ex: "#449201") contra a coluna `id` (uuid real
                // da linha) — nunca dava match, então o card corrompido nunca
                // era de fato marcado no banco. Usa _dbId (uuid real) em vez disso.
                if (card && card._dbId) await purgeCardInSupabase(card._dbId, 'contrato_corrupcao');
            } catch(e) { console.error('concludeContract purge corrupted:', e); }
            if (card) markCardPurgedLocally(card, 'contrato_corrupcao');
            fragmentsEarned += FRAGMENTS_PER_CORRUPTED_CARD;
        }

        // Desbloqueia cards que sobreviveram
        survivedIds.forEach(cid => {
            const card = savedAssets.find(a => a.id === cid);
            if (card) card.isLocked = false;
        });

        // Adiciona fragmentos ao saldo do usuário se houve corrupção
        if (fragmentsEarned > 0) {
            currentUser.fragments = (currentUser.fragments || 0) + fragmentsEarned;
            await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });
        }

        // Adiciona recompensa em Bumps
        currentUser.bumps += contract.reward;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        // Remove contrato ativo
        const active = loadActiveContracts();
        delete active[contractId];
        saveActiveContracts(active);

        // Atualiza badge de saldo se visível
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;

        // Monta mensagem de resultado
        let resultMsg = `<b style="color:#ff6600;">${contract.name}</b><br>`;
        resultMsg += `+<b style="color:#ffaa00;">${contract.reward} B$</b> adicionados ao terminal.<br>`;
        if (corruptedIds.length > 0) {
            resultMsg += `<br><span style="color:#ff0044;">☠ ${corruptedIds.length} card(s) CORROMPIDO(s) e destruído(s) na operação.</span>`;
            resultMsg += `<br><span style="color:#aaa;">+${fragmentsEarned} Fragmento(s) de Sucata concedido(s) como compensação.</span>`;
        } else {
            resultMsg += `<br><span style="color:#00ff66;">✓ Todos os cards retornaram intactos.</span>`;
        }

        playSynthSound('success');
        showCyberAlert('CONTRATO_CONCLUÍDO', resultMsg, corruptedIds.length > 0 ? 'warn' : 'success');

        // Re-renderiza tela se estiver aberta
        const screen = document.getElementById('screen-contracts');
        if (screen && screen.classList.contains('active')) renderContractsScreen();
        // Atualiza cofre se aberto
        if (document.getElementById('screen-vault') && document.getElementById('screen-vault').classList.contains('active')) renderVault();
    }

    // Reativa timers de contratos que ainda estão rodando (persistência F5)
    function resumePendingContracts() {
        if (!currentUser.loggedIn) return;
        const active = loadActiveContracts();
        Object.entries(active).forEach(([cid, state]) => {
            if (Date.now() < state.endTs) {
                startContractTimer(cid, state.endTs, state.cardIds);
            } else {
                // Já expirou enquanto estava fora — conclui imediatamente
                concludeContract(cid, state.cardIds);
            }
        });
    }

    function renderContractsScreen() {
        if (!currentUser.loggedIn) {
            document.getElementById('contractsGrid').innerHTML =
                '<div class="empty-vault-notice" style="grid-column:1/-1;">Login necessário para acessar contratos.</div>';
            document.getElementById('activeContractsZone').innerHTML = '';
            return;
        }

        const active = loadActiveContracts();
        const activeZone = document.getElementById('activeContractsZone');
        const grid = document.getElementById('contractsGrid');
        activeZone.innerHTML = '';
        grid.innerHTML = '';

        // Seção de missões ativas
        const activeList = Object.entries(active);
        if (activeList.length > 0) {
            const header = document.createElement('div');
            header.style.cssText = 'color:#ffaa00; font-size:0.6rem; font-weight:bold; letter-spacing:2px; margin-bottom:10px;';
            header.innerText = '> MISSÕES_ATIVAS // EM EXECUÇÃO';
            activeZone.appendChild(header);

            activeList.forEach(([cid, state]) => {
                const contract = CONTRACTS_DB.find(c => c.id === cid);
                if (!contract) return;
                const remaining = Math.max(0, state.endTs - Date.now());
                const pct = Math.max(0, (remaining / contract.durationMs) * 100);
                const lockedImgs = state.cardIds.map(id => {
                    const card = savedAssets.find(a => a.id === id);
                    return card ? `<img class="contract-locked-thumb" src="${card.imgSrc}" title="${card.id}">` : '';
                }).join('');

                const div = document.createElement('div');
                div.className = 'contract-card running';
                div.style.marginBottom = '10px';
                div.innerHTML = `
                    <div class="contract-tag">${contract.id} // EM EXECUÇÃO</div>
                    <div class="contract-name">${contract.name}</div>
                    <div class="contract-meta-row">
                        <span class="contract-meta-pill pill-reward">+${contract.reward} B$</span>
                        <span class="contract-meta-pill pill-req">${contract.reqLabel}</span>
                    </div>
                    <div class="contract-locked-cards">${lockedImgs}</div>
                    <div class="contract-timer-bar-wrap">
                        <div class="contract-timer-bar-fill" id="ctimer-fill-${cid}" style="width:${pct}%;"></div>
                    </div>
                    <div class="contract-timer-label" id="ctimer-label-${cid}">⏱ ${formatContractTime(remaining)} RESTANTES</div>
                `;
                activeZone.appendChild(div);

                // Garante que o timer está rodando
                if (!_contractTimers[cid]) {
                    startContractTimer(cid, state.endTs, state.cardIds);
                }
            });
        }

        // Seção de contratos disponíveis
        CONTRACTS_DB.forEach(contract => {
            const isRunning = !!active[contract.id];
            const div = document.createElement('div');
            div.className = 'contract-card';
            div.innerHTML = `
                <div class="contract-tag">${contract.id}</div>
                <div class="contract-name">${contract.name}</div>
                <p style="font-size:0.6rem; color:#888899; margin-bottom:10px;">${contract.desc}</p>
                <div class="contract-meta-row">
                    <span class="contract-meta-pill pill-duration">⏱ ${contract.durationLabel}</span>
                    <span class="contract-meta-pill pill-req">🃏 ${contract.reqLabel}</span>
                    <span class="contract-meta-pill pill-reward">💰 +${contract.reward} B$</span>
                    ${contract.riskChance ? `<span class="contract-meta-pill pill-risk" style="border-color:#ff0044; color:#ff0044;">${contract.riskLabel}</span>` : ''}
                </div>
                ${isRunning
                    ? `<button class="btn-action" style="width:100%; border-color:#555; color:#555; cursor:not-allowed;" disabled>EM EXECUÇÃO...</button>`
                    : `<button class="btn-action" style="width:100%; border-color:#ff6600; color:#ff6600;" onclick="openContractCardModal('${contract.id}')">▶ ACEITAR CONTRATO</button>`
                }
            `;
            grid.appendChild(div);
        });
    }

    // Abre modal de seleção de cards
    function openContractCardModal(contractId) {
        if (!currentUser.loggedIn) { showCyberAlert('ACESSO_NEGADO', 'Login necessário.', 'error'); return; }
        const contract = CONTRACTS_DB.find(c => c.id === contractId);
        if (!contract) return;

        _pendingContractId = contractId;
        _selectedContractCards = [];

        document.getElementById('contractModalTitle').innerText = contract.name;
        document.getElementById('contractModalDesc').innerText = contract.desc;
        document.getElementById('contractModalReq').innerText = `REQUISITO: ${contract.reqLabel}`;
        document.getElementById('contractSelectedCount').innerText = '0';

        // Cards elegíveis: mesma raridade, não listados, não bloqueados
        const eligible = savedAssets.filter(a =>
            a.rarityType === contract.reqRarity &&
            !a.isListed && !a.forSale && !a.isLocked
        );

        const grid = document.getElementById('contractCardSelectGrid');
        grid.innerHTML = '';

        if (eligible.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1; color:#ff0044; font-size:0.65rem; padding:10px;">Nenhum card elegível. Requisito: ${contract.reqLabel} disponível no cofre.</div>`;
        } else {
            eligible.forEach(card => {
                const div = document.createElement('div');
                div.style.cssText = 'border:1px solid #333; padding:6px; cursor:pointer; transition:border-color 0.15s;';
                div.dataset.cardId = card.id;
                div.innerHTML = `<img src="${card.imgSrc}" style="width:100%;aspect-ratio:1;object-fit:cover;margin-bottom:4px;"><div style="font-size:0.5rem;color:#888;">${card.id}</div>`;
                div.onclick = () => toggleContractCardSelection(div, card.id, contract.reqCount);
                grid.appendChild(div);
            });
        }

        document.getElementById('contractCardModal').style.display = 'flex';
    }

    function toggleContractCardSelection(el, cardId, maxCount) {
        const idx = _selectedContractCards.indexOf(cardId);
        if (idx > -1) {
            _selectedContractCards.splice(idx, 1);
            el.style.borderColor = '#333';
            el.style.boxShadow = '';
        } else {
            if (_selectedContractCards.length >= maxCount) {
                // Deseleciona o mais antigo se já atingiu o máximo
                const oldId = _selectedContractCards.shift();
                const oldEl = document.querySelector(`[data-card-id="${oldId}"]`);
                if (oldEl) { oldEl.style.borderColor = '#333'; oldEl.style.boxShadow = ''; }
            }
            _selectedContractCards.push(cardId);
            el.style.borderColor = '#ff6600';
            el.style.boxShadow = '0 0 8px rgba(255,102,0,0.5)';
        }
        document.getElementById('contractSelectedCount').innerText = _selectedContractCards.length;
    }

    function closeContractCardModal() {
        document.getElementById('contractCardModal').style.display = 'none';
        _pendingContractId = null;
        _selectedContractCards = [];
    }

    function confirmContractStart() {
        const contract = CONTRACTS_DB.find(c => c.id === _pendingContractId);
        if (!contract) return;

        if (_selectedContractCards.length < contract.reqCount) {
            showCyberAlert('ERRO_PROTOCOLO', `Selecione exatamente <b>${contract.reqCount}</b> card(s) para iniciar.`, 'error');
            return;
        }

        // Bloqueia cards
        _selectedContractCards.forEach(cid => {
            const card = savedAssets.find(a => a.id === cid);
            if (card) card.isLocked = true;
        });

        // Persiste contrato ativo
        const endTs = Date.now() + contract.durationMs;
        const active = loadActiveContracts();
        active[contract.id] = { endTs, cardIds: [..._selectedContractCards] };
        saveActiveContracts(active);

        // Estado de "em contrato" já persiste via saveActiveContracts() acima
        // (isLocked é só um flag de UI local, reconstruído a partir de active[] no boot).

        closeContractCardModal();
        startContractTimer(contract.id, endTs, active[contract.id].cardIds);
        renderContractsScreen();

        showCyberAlert(
            'CONTRATO_ACEITO',
            `<b style="color:#ff6600;">${contract.name}</b><br>Cards alocados. Operação em andamento.<br>Recompensa: <b style="color:#ffaa00;">+${contract.reward} B$</b> em <b>${contract.durationLabel}</b>.`,
            'warn'
        );
    }

    // Ativa botão de contratos e retoma timers após login/restore
    const _origRestoreSession = restoreCurrentSession;
    // Hook: após login bem-sucedido, mostrar botão e retomar timers
    // (chamado no handleAuthSubmit e no restore inicial)
    function showContractsBtnAndResume() {
        const btn = document.getElementById('navContractsBtn');
        if (btn) btn.style.display = 'flex';
        resumePendingContracts();
    }

    // Retoma contratos: ver renderBootScreen() / restoreCurrentSession(),
    // chamado lá no momento certo (depois da sessão confirmada), não aqui.
