// =========================================================
// dr0p_station — MÓDULO: cards-inventory-db.js
// SUPABASE — CRUD de cards/cofre + CRUD de inventário/itens
//
// Parte 11 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

// =========================================================
// dr0p_station — PARTE 2/4: CARDS / COFRE (SUPABASE)
// SUBSTITUI no script.js original:
//   - função claimAssetLogic
//   - função toggleExposeAsset
// ADICIONA (novo, não existia antes):
//   - rowToCard / cardToInsertRow  (conversão DB <-> objeto em memória)
//   - loadCardsFromSupabase
//   - insertCardToSupabase / updateCardInSupabase / deleteCardFromSupabase
//
// INTEGRAÇÃO COM A PARTE 1 (auth-supabase-part.js):
//   No arquivo da Parte 1, dentro de `restoreCurrentSession()` e dentro do
//   bloco de LOGIN em `handleAuthSubmit`, troque a linha:
//       savedAssets = [];
//   por:
//       savedAssets = await loadCardsFromSupabase(currentUser.id);
//
// IMPORTANTE: o `id` usado em todo o resto do app (ex: "#449201") continua
// sendo o campo visual. O uuid real da linha no Supabase fica guardado em
// `_dbId` em cada card, usado só internamente pra update/delete.
// =========================================================

// =========================================================
// MAPEAMENTO DB (snake_case) <-> OBJETO EM MEMÓRIA (shape original do app)
// =========================================================
function rowToCard(row) {
    return {
        _dbId: row.id,
        id: row.display_id,
        rarityType: row.rarity_type,
        rarityName: row.rarity_name,
        rarityNameEN: row.rarity_name_en,
        styleName: row.style_name,
        styleNameEN: row.style_name_en,
        creator: row.creator,
        registered: row.registered,
        exposed: row.exposed,
        forSale: row.for_sale,
        isListed: row.is_listed,
        price: Number(row.price) || 0,
        imgSrc: row.img_src,
        tags: row.tags || [],
        isFused: row.is_fused,
        fusion_count: row.fusion_count,
        eliteEligible: row.elite_eligible,
        genetic_history: row.genetic_history || [],
        parent_ids: row.parent_ids || null,
        provenance: row.provenance_hash ? {
            hash: row.provenance_hash,
            timestamp: row.provenance_timestamp,
            origin: row.provenance_origin
        } : null,
        isTokenized: row.is_tokenized,
        qr_code_hash: row.qr_code_hash,
        qr_payload_url: row.qr_payload_url,
        watermarkColor: row.watermark_color,
        filterStyle: row.filter_style,
        resolutions: row.resolutions || { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } },
        // [ESCOPO 4] CARIMBO DE EXCLUSÃO — estado purged/detonada
        isPurged: row.is_purged ?? false,
        purgedAt: row.purged_at || null,
        purgedReason: row.purged_reason || null,
        // [ESCOPO 3] mídia animada gerada pela fusão (gif/webp), se houver
        isAnimated: row.is_animated ?? false,
        animatedMime: row.animated_mime || null
    };
}

// =========================================================
// UPLOAD DE IMAGEM DO CARD PARA O SUPABASE STORAGE
// Em vez de salvar base64 no banco (que infla o Database Size),
// fazemos upload do PNG renderizado para o bucket 'card-assets'
// e gravamos só a URL pública na coluna img_src.
// =========================================================
async function uploadCardImageToBucket(imgSrc, displayId) {
    try {
        // Converte dataURL base64 para Blob
        const res = await fetch(imgSrc);
        const blob = await res.blob();
        const fileName = `${displayId.replace('#', '')}_${Date.now()}.png`;
        const { data, error } = await sb.storage
            .from('card-assets')
            .upload(fileName, blob, { contentType: 'image/png', upsert: false, cacheControl: '31536000' });
        if (error) { console.error('uploadCardImageToBucket:', error.message); return imgSrc; } // fallback: base64
        const { data: pub } = sb.storage.from('card-assets').getPublicUrl(data.path);
        return pub?.publicUrl || imgSrc;
    } catch (e) {
        console.error('uploadCardImageToBucket erro:', e);
        return imgSrc; // fallback: base64
    }
}

function cardToInsertRow(card, userId) {
    return {
        id_usuario: userId,
        display_id: card.id,
        rarity_type: card.rarityType,
        rarity_name: card.rarityName,
        rarity_name_en: card.rarityNameEN,
        style_name: card.styleName,
        style_name_en: card.styleNameEN,
        creator: card.creator,
        registered: card.registered ?? true,
        exposed: card.exposed ?? false,
        for_sale: card.forSale ?? false,
        is_listed: card.isListed ?? false,
        price: card.price ?? 0,
        img_src: card.imgSrc,
        tags: card.tags || [],
        is_fused: card.isFused ?? false,
        fusion_count: card.fusion_count ?? 0,
        elite_eligible: card.eliteEligible ?? false,
        genetic_history: card.genetic_history || [],
        parent_ids: card.parent_ids || null,
        provenance_hash: card.provenance?.hash || null,
        provenance_timestamp: card.provenance?.timestamp || null,
        provenance_origin: card.provenance?.origin || 'DROP_STATION_INTERNAL',
        is_tokenized: card.isTokenized ?? false,
        qr_code_hash: card.qr_code_hash || null,
        qr_payload_url: card.qr_payload_url || null,
        watermark_color: card.watermarkColor || '#ffffff',
        filter_style: card.filterStyle || null,
        resolutions: card.resolutions || { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } },
        is_purged: card.isPurged ?? false,
        purged_at: card.purgedAt || null,
        purged_reason: card.purgedReason || null,
        is_animated: card.isAnimated ?? false,
        animated_mime: card.animatedMime || null
    };
}

// =========================================================
// LEITURA: carrega todo o cofre do usuário ao logar / restaurar sessão
// =========================================================
async function loadCardsFromSupabase(userId) {
    // ANTI-EGRESS: colunas explícitas (as mesmas que rowToCard lê) em vez
    // de '*'. Limite de 500 cards por usuário evita que um cofre gigante
    // (ou um bug de duplicação) puxe um payload sem teto a cada login.
    const CARD_COLUMNS = 'id, display_id, rarity_type, rarity_name, rarity_name_en, style_name, style_name_en, creator, registered, exposed, for_sale, is_listed, price, img_src, tags, is_fused, fusion_count, elite_eligible, genetic_history, parent_ids, provenance_hash, provenance_timestamp, provenance_origin, is_tokenized, qr_code_hash, qr_payload_url, watermark_color, filter_style, resolutions, is_purged, purged_at, purged_reason, is_animated, animated_mime, created_at';
    const { data, error } = await sb.from('cards')
        .select(CARD_COLUMNS)
        .eq('id_usuario', userId)
        .eq('is_purged', false)
        .order('created_at', { ascending: true })
        .limit(500);
    if (error) { console.error('loadCardsFromSupabase:', error.message); return []; }
    return data.map(rowToCard);
}

// =========================================================
// CRIAÇÃO: insere um novo card no cofre
// =========================================================
async function insertCardToSupabase(card, userId) {
    const row = cardToInsertRow(card, userId);
    const { data, error } = await sb.from('cards').insert(row).select().single();
    if (error) { console.error('insertCardToSupabase:', error.message); return null; }
    card._dbId = data.id; // necessário para updates/deletes futuros nesse card
    return card;
}

// =========================================================
// ATUALIZAÇÃO PARCIAL: usado sempre que o estado de um card muda
// (exposed, forSale, price, isListed, fusion_count, etc.)
// `fieldsCamel` usa as MESMAS chaves do objeto em memória (ex: { exposed: true }),
// a função se encarrega de converter pro nome de coluna do banco.
// =========================================================
const CARD_FIELD_TO_COLUMN = {
    exposed: 'exposed', forSale: 'for_sale', isListed: 'is_listed', price: 'price',
    fusion_count: 'fusion_count', eliteEligible: 'elite_eligible',
    genetic_history: 'genetic_history', qr_code_hash: 'qr_code_hash',
    qr_payload_url: 'qr_payload_url', isTokenized: 'is_tokenized',
    watermarkColor: 'watermark_color', tags: 'tags', registered: 'registered'
};

async function updateCardInSupabase(card, fieldsCamel) {
    if (!card._dbId) { console.warn('updateCardInSupabase: card sem _dbId, ignorando update remoto.', card.id); return false; }
    const updatePayload = {};
    Object.keys(fieldsCamel).forEach(key => {
        const col = CARD_FIELD_TO_COLUMN[key];
        if (col) updatePayload[col] = fieldsCamel[key];
    });
    if (Object.keys(updatePayload).length === 0) return false;

    const { error } = await sb.from('cards').update(updatePayload).eq('id', card._dbId);
    if (error) { console.error('updateCardInSupabase:', error.message); return false; }
    return true;
}

// =========================================================
// EXCLUSÃO: usado quando um card é consumido (fusão, troca, etc.)
// =========================================================
async function deleteCardFromSupabase(cardDbId) {
    if (!cardDbId) return false;
    const { error } = await sb.from('cards').delete().eq('id', cardDbId);
    if (error) { console.error('deleteCardFromSupabase:', error.message); return false; }
    return true;
}

// =========================================================
// [ESCOPO 4] CARIMBO DE EXCLUSÃO — PURGE (estado purged/detonada)
// Usado no lugar de deleteCardFromSupabase sempre que um card é
// sacrificado/consumido nas mecânicas de fusão ou descarte. Em vez
// de remover a linha, marca is_purged=true (+ timestamp e motivo) e
// bloqueia exposição/venda/listagem. O card permanece visível como
// registro histórico no cofre e no Inspect, com o efeito de chamas
// + selo PURGED/DETONADA, em vez de simplesmente desaparecer.
// =========================================================
async function purgeCardInSupabase(cardDbId, reason) {
    if (!cardDbId) return false;
    const { error } = await sb.from('cards').update({
        is_purged: true,
        purged_at: new Date().toISOString(),
        purged_reason: reason || 'fusao',
        exposed: false, for_sale: false, is_listed: false
    }).eq('id', cardDbId);
    if (error) { console.error('purgeCardInSupabase:', error.message); return false; }

    // Publica o card destruído no feed mutações_rede com selo PURGED
    // O card precisa estar no cofre local para obtermos os metadados
    const localCard = savedAssets.find(c => c._dbId === cardDbId || c.id === cardDbId);
    if (localCard && currentUser.loggedIn) {
        try {
            await sb.from('eventos_globais').insert({
                id_usuario: currentUser.id,
                username: currentUser.username,
                tipo: 'feed',
                mensagem: `${currentUser.username} destruiu ${localCard.id} [${localCard.rarityNameEN || localCard.rarityType}] via ${reason || 'alquimia'}`,
                card_payload: { ...localCard, isPurged: true, purgedReason: reason || 'fusao' }
            });
        } catch(e) { console.error('purgeCardInSupabase feed push:', e); }
    }

    return true;
}

// Aplica o mesmo carimbo no objeto em memória, espelhando o update remoto
// acima — evita um reload completo do cofre só pra refletir o purge.
function markCardPurgedLocally(card, reason) {
    if (!card) return;
    card.isPurged = true;
    card.purgedAt = new Date().toISOString();
    card.purgedReason = reason || 'fusao';
    card.exposed = false; card.forSale = false; card.isListed = false;
    // Remove do cofre em memória imediatamente — loadCardsFromSupabase já filtra
    // is_purged=true no banco, mas sem isso o card voltaria a aparecer
    // no cofre até o próximo reload de página.
    const idx = savedAssets.indexOf(card);
    if (idx !== -1) savedAssets.splice(idx, 1);
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD DO ATIVO — SEMPRE A ARTE DO JOGO, NUNCA O ARQUIVO ORIGINAL
// BUGFIX: antes este botão buscava o arquivo BRUTO sorteado no bucket
// privado high-res-assets do Supabase (asset.resolutions.hd.src) — ou
// seja, a imagem original, sem nenhum dos filtros/efeitos do jogo.
// As imagens originais NUNCA devem aparecer no drop nem no download.
// Agora o download sempre usa asset.imgSrc — a mesma arte estática já
// processada/baked pelos filtros do jogo, exibida no Cofre/Inspect/
// Vitrine — re-renderizada em alta resolução (PNG).
// Se a fusão gerou uma variante animada (asset.isAnimated === true,
// modo "GIF" da fusão), o download sai como um .gif animado de
// verdade, reaplicando o MESMO filtro de movimento (random-glitch ou
// vortex-wave — ver getCardMotionFilter / MOTION_FILTER_VARIANTS) que
// o card já exibe dentro do jogo, mantendo a arte modificada.
// Chamada apenas pelo botão "Obter Item 📥" do cofre (downloadVaultAsset).
// ═══════════════════════════════════════════════════════════════
async function executeDoubleAssetDownload(asset) {
    if (!asset) return;

    // Só o criador original pode baixar o HD
    if (asset.creator !== currentUser.username) {
        showCyberAlert('ACESSO NEGADO', 'Apenas o autor da mintagem pode descarregar o ativo em alta resolução.', 'error');
        return;
    }

    if (!asset.imgSrc) {
        showCyberAlert('SEM ARTE VINCULADA', 'Este card não tem uma imagem vinculada para download.', 'error');
        return;
    }

    const rawId = (asset.id || '').toString().replace('#', '');
    const baseName = `dr0p_${rawId}_${asset.rarityType || 'card'}_1000px`;
    // Card mutado com filtro de movimento ativo → baixa GIF animado real.
    // Card normal → baixa PNG estático em alta resolução.
    const motionVariant = getCardMotionFilter(asset);

    try {
        if (motionVariant) {
            showCyberAlert('COMPILANDO MUTAÇÃO...', 'Gerando GIF animado em alta resolução. Isso pode levar alguns segundos.', 'info');
            const gifBlob = await _renderCardMotionAsGif(asset.imgSrc, motionVariant);
            if (!gifBlob) throw new Error('Falha ao gerar o GIF animado.');
            _triggerBlobDownload(gifBlob, `${baseName}.gif`);
            showCyberAlert('✓ DOWNLOAD INICIADO', `GIF animado <b>${baseName}.gif</b> enviado para o seu dispositivo.`, 'success');
        } else {
            showCyberAlert('COMPILANDO ATIVO...', 'Gerando imagem estática em alta resolução. Aguarde.', 'info');
            const pngBlob = await _renderStaticHdPng(asset.imgSrc);
            if (!pngBlob) throw new Error('Falha ao gerar a imagem.');
            _triggerBlobDownload(pngBlob, `${baseName}.png`);
            showCyberAlert('✓ DOWNLOAD INICIADO', `Ativo HD <b>${baseName}.png</b> enviado para o seu dispositivo.`, 'success');
        }
    } catch (err) {
        console.error('[Download] Falha:', err);
        showCyberAlert('FALHA NO DOWNLOAD', 'Erro ao baixar o ativo. Tente novamente.', 'error');
    }
}

// Dispara o download de um Blob já gerado localmente, sem abrir nova aba.
function _triggerBlobDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}

// Re-renderiza asset.imgSrc (a arte JÁ modificada pelos filtros do jogo,
// não o arquivo bruto do bucket) numa resolução maior, preservando a
// proporção, e devolve um Blob PNG.
function _renderStaticHdPng(srcDataUrl, targetSize = 1000) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const scale = targetSize / Math.max(img.naturalWidth, img.naturalHeight);
            const w = Math.max(1, Math.round(img.naturalWidth * scale));
            const h = Math.max(1, Math.round(img.naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob falhou')), 'image/png');
        };
        img.onerror = () => reject(new Error('Falha ao carregar imagem de origem.'));
        img.src = srcDataUrl;
    });
}

// ── Reproduz em frames de canvas os MESMOS valores de
// hue-rotate/saturate/brightness/transform das @keyframes CSS
// motionRandomGlitch / motionVortexWave (ver injectMotionFilterStyles,
// topo do arquivo), pra que o .gif baixado mostre exatamente a mesma
// mutação visual que o card já exibe dentro do jogo. ──
const MOTION_GIF_KEYFRAMES = {
    'random-glitch': [
        { hue: 0,   sat: 100, bri: 100, tx: 0,  ty: 0 },
        { hue: 40,  sat: 180, bri: 100, tx: -3, ty: 3 },
        { hue: -30, sat: 140, bri: 100, tx: 3,  ty: -3 },
        { hue: 60,  sat: 200, bri: 100, tx: -3, ty: 0 },
        { hue: -15, sat: 160, bri: 100, tx: 3,  ty: 3 },
    ],
    'vortex-wave': [
        { hue: 0,   sat: 100, bri: 100, rot: 0,   scale: 1 },
        { hue: 90,  sat: 100, bri: 108, rot: 0.8, scale: 1.008 },
        { hue: 180, sat: 100, bri: 115, rot: 1.5, scale: 1.015 },
        { hue: 90,  sat: 100, bri: 108, rot: 0.8, scale: 1.008 },
    ],
};

// Busca o gif.worker.js como Blob (URL.createObjectURL), porque o
// gif.js precisa rodar num Web Worker same-origin — buscar direto da
// CDN cross-origin trava a criação do Worker no navegador.
let _gifWorkerBlobUrlPromise = null;
function _getGifWorkerBlobUrl() {
    if (!_gifWorkerBlobUrlPromise) {
        _gifWorkerBlobUrlPromise = fetch('https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js')
            .then(r => { if (!r.ok) throw new Error('Falha ao buscar gif.worker.js'); return r.blob(); })
            .then(blob => URL.createObjectURL(blob));
    }
    return _gifWorkerBlobUrlPromise;
}

// Gera o .gif animado real (via gif.js) a partir da arte já filtrada do
// card (srcDataUrl = asset.imgSrc), aplicando a mesma variante de
// movimento que o card usa dentro do jogo (random-glitch / vortex-wave).
function _renderCardMotionAsGif(srcDataUrl, variant, targetSize = 1000) {
    return new Promise((resolve, reject) => {
        if (typeof GIF === 'undefined') { reject(new Error('gif.js não carregado.')); return; }
        const frames = MOTION_GIF_KEYFRAMES[variant] || MOTION_GIF_KEYFRAMES['random-glitch'];
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
            try {
                const scale = targetSize / Math.max(img.naturalWidth, img.naturalHeight);
                const w = Math.max(1, Math.round(img.naturalWidth * scale));
                const h = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');

                const workerScript = await _getGifWorkerBlobUrl();
                const gif = new GIF({ workers: 2, quality: 10, width: w, height: h, workerScript });

                frames.forEach(f => {
                    ctx.clearRect(0, 0, w, h);
                    ctx.save();
                    ctx.filter = `hue-rotate(${f.hue}deg) saturate(${f.sat}%) brightness(${f.bri}%)`;
                    ctx.translate(w / 2, h / 2);
                    if (f.rot) ctx.rotate(f.rot * Math.PI / 180);
                    if (f.scale) ctx.scale(f.scale, f.scale);
                    ctx.translate(-w / 2 + (f.tx || 0), -h / 2 + (f.ty || 0));
                    ctx.drawImage(img, 0, 0, w, h);
                    ctx.restore();
                    gif.addFrame(ctx, { copy: true, delay: 180 });
                });

                gif.on('finished', blob => resolve(blob));
                gif.on('abort', () => reject(new Error('Geração do GIF abortada.')));
                gif.render();
            } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('Falha ao carregar imagem de origem.'));
        img.src = srcDataUrl;
    });
}


// =========================================================
// CLAIM: resgata o card que acabou de "rolar" pro cofre do usuário
// =========================================================
async function claimAssetLogic() {
    // MUTEX GLOBAL: bloqueia qualquer clique duplicado antes de qualquer operação
    if (isProcessingClaim) return;
    if (!activeAssetData) return;

    isProcessingClaim = true;
    downloadBtn.disabled = true;
    const originalBtnText = downloadBtn.innerText;
    downloadBtn.innerText = currentLang === 'PT' ? "SALVANDO..." : "SAVING...";

    // FREE ROLL sem login: bloqueia envio ao cofre, liberta mutex imediatamente
    if (!currentUser.loggedIn) {
        showCyberAlert('ACESSO_NEGADO:', currentLang === 'PT'
            ? 'COFRE BLOQUEADO: Faça login para salvar este ativo no seu cofre seguro. O card será perdido se não consolidar.'
            : 'VAULT LOCKED: Login required to save this asset to your secure vault. Card will be lost if not consolidated.', 'error');
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        isProcessingClaim = false;
        navigateTo('auth');
        return;
    }

    // Saldo insuficiente: aborta sem debitar nada
    if (activeAssetData.costToClaim > 0 && currentUser.bumps < activeAssetData.costToClaim) {
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        isProcessingClaim = false;
        playTerminalSound('error');
        openDepositModal();
        return;
    }

    try {
        // === ZONA CRÍTICA ===
        if (activeAssetData.costToClaim > 0) {
            const newBumps = currentUser.bumps - activeAssetData.costToClaim;
            const { error: bumpsErr } = await sb.from('profiles').update({ bumps: newBumps }).eq('id', currentUser.id);
            if (bumpsErr) { console.error('debitar bumps:', bumpsErr.message); throw bumpsErr; }
            currentUser.bumps = newBumps;
            const profBumpsEl = document.getElementById('profBumps');
            if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        }
        clearInterval(decayInterval);

        // Clona dados antes de qualquer limpeza de estado
        const assetSnapshot = { ...activeAssetData, creator: currentUser.username, registered: true };

        // ── PROVENIÊNCIA: injeta hash + timestamp de nascimento ──
        attachProvenance(assetSnapshot);

        // ── UPLOAD DA IMAGEM: substitui base64 por URL do Storage ──
        // Isso reduz drasticamente o tamanho do banco (img_src era uma string
        // base64 enorme; agora é só uma URL curta).
        if (assetSnapshot.imgSrc && assetSnapshot.imgSrc.startsWith('data:')) {
            assetSnapshot.imgSrc = await uploadCardImageToBucket(assetSnapshot.imgSrc, assetSnapshot.id);
        }

        // Salvaguarda extra: impede duplicado se ID já existir no cofre
        const alreadyOwned = savedAssets.some(a => a.id === assetSnapshot.id);
        if (!alreadyOwned) {
            const inserted = await insertCardToSupabase(assetSnapshot, currentUser.id);
            if (!inserted) throw new Error('Falha ao gravar card no Supabase.');
            savedAssets.push(inserted);
        }

        // Limpa estado do drop ANTES do alert
        activeAssetData = null;
        lastMintedBuffer = null;
        downloadBtn.style.display = "none";
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        stabilityWrapper.style.display = "none";
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "ATIVO_SALVO_NO_COFRE" : "ASSET_SAVED_TO_VAULT";

        playTerminalSound('claim');
        speakPhrase("Ativo integrado ao seu cofre.", "Asset integrated into your vault.");

        // Ledger entry + feed global: o card só entra na rede pública AGORA,
        // porque só agora ele é real e definitivo (gravado em `cards` via
        // insertCardToSupabase acima). Drops não-resgatados nunca chegam aqui.
        pushLedger(`${currentUser.username} resgatou o card ${assetSnapshot.id} [${assetSnapshot.rarityNameEN}]`);
        pushFeedCard(assetSnapshot);

        showCyberAlert('PROCESSO_CONCLUÍDO:', currentLang === 'PT' ? 'Consolidado no seu cofre seguro!' : 'Consolidated into your secure vault!', 'success');

    } catch (e) {
        console.error(e);
        showCyberAlert('ERRO_DE_REDE:', currentLang === 'PT' ? 'Falha ao salvar no cofre. Tenta novamente.' : 'Failed to save to vault. Try again.', 'error');
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
    } finally {
        isProcessingClaim = false;
    }
}

// =========================================================
// EXPOR/RETIRAR DA VITRINE — exemplo do padrão a seguir para as
// demais ações do cofre (venda, presente, etc., nas próximas partes)
// =========================================================
async function toggleExposeAsset(index) {
    const asset = savedAssets[index];
    if (!asset) { console.warn('toggleExposeAsset: index inválido', index); return; }
    if (asset.isPurged) {
        showCyberAlert('CARD_DETONADO', 'Cards detonados (purged) não podem ser expostos na vitrine.', 'error');
        return;
    }
    if (asset.isListed) {
        playSynthSound('shatter');
        showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card está listado no mercado e está em custódia. Remove o anúncio primeiro para alterar o seu estado.', 'error');
        return;
    }
    if (!asset._dbId) {
        showCyberAlert('ERRO DE SINCRONIZAÇÃO', 'Este card ainda não foi sincronizado com o servidor. Recarregue a página.', 'error');
        return;
    }

    // [FIX VITRINE] Reaplica a vitrine pública sempre que o próprio dono
    // estiver com o perfil aberto — sem isso, o card alternado só
    // atualizava no Cofre (renderVaultGrid) e a Vitrine ficava com o
    // estado antigo até a página ser recarregada.
    const refreshShowcaseIfOwnerViewing = () => {
        if (selectedProfileUser === currentUser.username) {
            renderShowcaseInventory(savedAssets, currentUser.equippedCosmetics, true);
            const showcaseRankArea = document.getElementById('showcaseRankArea');
            if (showcaseRankArea && typeof computeCollectionLevel === 'function') {
                computeCollectionLevel(savedAssets, showcaseRankArea);
            }
        }
    };

    const novoEstado = !asset.exposed;
    savedAssets[index].exposed = novoEstado;
    renderVaultGrid(); // feedback imediato na UI
    refreshShowcaseIfOwnerViewing(); // mantém a vitrine sincronizada em tempo real

    const ok = await updateCardInSupabase(asset, { exposed: novoEstado });
    if (!ok) {
        savedAssets[index].exposed = !novoEstado; // rollback
        showCyberAlert('ERRO_DE_REDE', 'Não foi possível atualizar a vitrine. Tenta novamente.', 'error');
        renderVaultGrid();
        refreshShowcaseIfOwnerViewing();
        return;
    }

    playSynthSound(novoEstado ? 'success' : 'click');
    showCyberAlert(
        novoEstado ? '⭐ EXPOSTO NA VITRINE' : '📁 RETIRADO DA VITRINE',
        novoEstado ? `Card <b>${asset.id}</b> agora aparece na sua vitrine pública.` : `Card <b>${asset.id}</b> retirado da vitrine.`,
        'success'
    );
}
// =========================================================
// dr0p_station — PARTE 3/4: INVENTÁRIO / ITENS (SUPABASE)
// SUBSTITUI no script.js original:
//   - função getUserInventory
//   - função consumeInventoryItem (agora assíncrona!)
// ADICIONA (novo):
//   - loadInventoryFromSupabase
//   - grantInventoryItem
//   - seedStarterInventory
//
// ⚠️ BREAKING CHANGE: consumeInventoryItem agora é async (precisa de
// `await`). Em forjarFusao() e fuseCards() (Parte 4), as linhas:
//     modificadores.forEach(m => consumeInventoryItem(m.itemId));
// devem virar:
//     for (const m of modificadores) { await consumeInventoryItem(m.itemId); }
// Isso já vai estar pronto na Parte 4 — só citando aqui pra não estranhar.
//
// INTEGRAÇÃO COM A PARTE 1 (auth-supabase-part.js):
//   1) Em createProfile(), depois do insert do profile, chame:
//        await seedStarterInventory(userId);
//   2) Em applyProfileToCurrentUser(profile), a linha `inventory: []`
//      é só o valor inicial — o carregamento real entra logo depois,
//      em restoreCurrentSession() e no LOGIN de handleAuthSubmit:
//        currentUser.inventory = await loadInventoryFromSupabase(currentUser.id);
// =========================================================

// =========================================================
// CATÁLOGO DE ITENS (mantido client-side — é config estática, não dado de usuário)
// Mesma definição do ITEMS_DB original do script.js.
// =========================================================
const ITEMS_DB = {
    catalisador_estabilidade: {
        category: 'PROTETOR', consumedOnUse: true,
        effect: { type: 'SURVIVAL_BONUS', value: 0.15 },
        name: 'Catalisador de Estabilidade', nameEN: 'Stability Catalyst'
    },
    nucleo_backup: {
        category: 'PROTETOR', consumedOnUse: true,
        effect: { type: 'INSURANCE_BREAK' },
        name: 'Núcleo de Backup', nameEN: 'Backup Core'
    },
    essencia_neon_amarelo: {
        category: 'CATALISADOR', consumedOnUse: true,
        effect: { type: 'FORCE_PALETTE', value: 'gold' },
        name: 'Essência de Neon Amarelo', nameEN: 'Yellow Neon Essence'
    },
    injetor_overclock: {
        category: 'CATALISADOR', consumedOnUse: true,
        effect: { type: 'OVERCLOCK', riskDelta: 0.20, fusionCountBonus: 2 },
        name: 'Injetor de Overclock', nameEN: 'Overclock Injector'
    },
    poeira_silicio: {
        category: 'MOEDA_ENTRADA', consumedOnUse: true,
        effect: { type: 'COST' },
        name: 'Poeira de Silício', nameEN: 'Silicon Dust'
    },
    sucata_circuitos: {
        category: 'MOEDA_ENTRADA', consumedOnUse: true,
        effect: { type: 'COST' },
        name: 'Sucata de Circuitos', nameEN: 'Circuit Scrap'
    }
};

// Kit inicial dado a todo usuário recém-registrado (substitui o que os SEED_USERS faziam)
const STARTER_KIT = [
    { templateId: 'poeira_silicio', category: 'MOEDA_ENTRADA', qty: 5 },
    { templateId: 'catalisador_estabilidade', category: 'PROTETOR', qty: 1 }
];

// =========================================================
// MAPEAMENTO DB <-> OBJETO EM MEMÓRIA
// (mantém o mesmo shape original: { itemId, templateId, category, qty })
// =========================================================
function rowToInventoryItem(row) {
    return {
        _dbId: row.id,
        itemId: row.item_id,
        templateId: row.template_id,
        category: row.category,
        qty: row.qty
    };
}

// =========================================================
// LEITURA: carrega o inventário completo do usuário
// =========================================================
async function loadInventoryFromSupabase(userId) {
    // ANTI-EGRESS: colunas explícitas (as mesmas que rowToInventoryItem lê)
    // em vez de '*', com teto de 1000 linhas por usuário.
    const { data, error } = await sb.from('inventario')
        .select('id, item_id, template_id, category, qty, created_at')
        .eq('id_usuario', userId)
        .order('created_at', { ascending: true })
        .limit(1000);
    if (error) { console.error('loadInventoryFromSupabase:', error.message); return []; }
    return data.map(rowToInventoryItem);
}

// =========================================================
// CONCESSÃO: adiciona (ou incrementa) um item no inventário do usuário
// Usado pro kit inicial, recompensas de missão, drops especiais, etc.
// =========================================================
async function grantInventoryItem(userId, templateId, qty = 1) {
    const tpl = ITEMS_DB[templateId];
    if (!tpl) { console.warn('grantInventoryItem: template desconhecido', templateId); return null; }

    // Se já existe uma pilha desse item pro usuário, incrementa em vez de duplicar linha
    // ANTI-EGRESS: só precisamos de id (pra fazer o update) e qty (pra
    // incrementar) — não da linha inteira.
    const { data: existing, error: findErr } = await sb.from('inventario')
        .select('id, qty').eq('id_usuario', userId).eq('template_id', templateId).maybeSingle();
    if (findErr) { console.error('grantInventoryItem (find):', findErr.message); return null; }

    if (existing) {
        const { data, error } = await sb.from('inventario')
            .update({ qty: existing.qty + qty })
            .eq('id', existing.id).select().single();
        if (error) { console.error('grantInventoryItem (update):', error.message); return null; }
        return rowToInventoryItem(data);
    }

    const itemId = `item_${templateId}_${Date.now().toString(36)}`;
    const { data, error } = await sb.from('inventario').insert({
        id_usuario: userId,
        item_id: itemId,
        template_id: templateId,
        category: tpl.category,
        qty,
        effect: tpl.effect,
        consumed_on_use: tpl.consumedOnUse
    }).select().single();
    if (error) { console.error('grantInventoryItem (insert):', error.message); return null; }
    return rowToInventoryItem(data);
}

// =========================================================
// SEED: dá o kit inicial a um usuário recém-registrado
// =========================================================
async function seedStarterInventory(userId) {
    for (const item of STARTER_KIT) {
        await grantInventoryItem(userId, item.templateId, item.qty);
    }
}

// =========================================================
// LEITURA LOCAL: acessor do inventário em memória (mantém compat. com chamadas existentes)
// =========================================================
function getUserInventory() {
    if (!Array.isArray(currentUser.inventory)) currentUser.inventory = [];
    return currentUser.inventory;
}

// =========================================================
// CONSUMO: remove (ou decrementa) um item após uso numa fusão
// ⚠️ Agora é ASYNC — quem chama precisa usar `await`.
// =========================================================
async function consumeInventoryItem(itemId) {
    const inv = getUserInventory();
    const idx = inv.findIndex(i => i.itemId === itemId);
    if (idx === -1) return false;
    const item = inv[idx];

    if (item.qty && item.qty > 1) {
        const ok = await updateInventoryItemQty(item, item.qty - 1);
        if (!ok) return false;
        item.qty -= 1;
    } else {
        const ok = await deleteInventoryItem(item);
        if (!ok) return false;
        inv.splice(idx, 1);
    }
    return true;
}

async function updateInventoryItemQty(item, newQty) {
    if (!item._dbId) { console.warn('updateInventoryItemQty: item sem _dbId', item.itemId); return false; }
    const { error } = await sb.from('inventario').update({ qty: newQty }).eq('id', item._dbId);
    if (error) { console.error('updateInventoryItemQty:', error.message); return false; }
    return true;
}

async function deleteInventoryItem(item) {
    if (!item._dbId) { console.warn('deleteInventoryItem: item sem _dbId', item.itemId); return false; }
    const { error } = await sb.from('inventario').delete().eq('id', item._dbId);
    if (error) { console.error('deleteInventoryItem:', error.message); return false; }
    return true;
}



// =========================================================
// dr0p_station — PARTE 5/4: FOLLOW REAL + MERCADO REAL (SUPABASE)
