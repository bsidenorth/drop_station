// =========================================================
// dr0p_station — MÓDULO: visual-fx-styles.js
// ESTILOS VISUAIS DE ARTE DIRECIONAL — 6 efeitos canvas
//
// Adicionar ao index.html APÓS config.js e ANTES de drop-vault.js:
//   <script src="js/visual-fx-styles.js"></script>
//
// Responsabilidades:
//  1. CANVAS_FX_RENDERERS — renderizadores que aplicam os 6 efeitos
//     reais no canvas de drop (chamado por applyDropStyleFxToCanvas)
//  2. applyDropStyleFxToCanvas — integração com drop-vault.js
//     (sobrescreve applyDropStyleFilter quando canvasFx está presente)
//  3. CSS injetado — estilização no modal de Inspect e nos cards
//     do cofre quando style_name é um dos 6 estilos de arte
//  4. applyInspectStyleFx — chamado ao abrir o modal de Inspect,
//     aplica o efeito visual ao <img> ou <canvas> exibido
// =========================================================

// =========================================================
// ── 1. CSS INJETADO — efeitos visuais no Inspect e Cofre ─
// =========================================================
(function _injectArtFxCSS() {
    if (document.getElementById('artFxStyles')) return;
    const s = document.createElement('style');
    s.id = 'artFxStyles';
    s.textContent = `

/* ── BASE: wrapper relativo para pseudo-elementos ── */
.art-fx-wrap { position: relative; overflow: hidden; display: inline-block; }

/* ══════════════════════════════════════════════════
   1. HALFTONE_MATRIX — pontos/pixelate monocromático
   ══════════════════════════════════════════════════ */
.art-fx--halftone_matrix {
    filter: contrast(180%) brightness(92%) grayscale(100%);
    image-rendering: pixelated;
}
.art-fx--halftone_matrix::after {
    content: '';
    position: absolute; inset: 0;
    background-image: radial-gradient(circle, rgba(0,0,0,0.85) 35%, transparent 36%);
    background-size: 5px 5px;
    mix-blend-mode: multiply;
    pointer-events: none;
}

/* ══════════════════════════════════════════════════
   2. SCANLINES_OVERDRIVE — linhas horizontais neon
   ══════════════════════════════════════════════════ */
.art-fx--scanlines_overdrive {
    filter: contrast(140%) brightness(88%) saturate(200%) hue-rotate(180deg);
}
.art-fx--scanlines_overdrive::after {
    content: '';
    position: absolute; inset: 0;
    background: repeating-linear-gradient(
        to bottom,
        rgba(0,255,200,0.07) 0px,
        rgba(0,255,200,0.07) 1px,
        transparent           1px,
        transparent           3px
    );
    animation: scanlineDrift 4s linear infinite;
    pointer-events: none;
}
@keyframes scanlineDrift {
    0%   { background-position-y: 0; }
    100% { background-position-y: 60px; }
}

/* ══════════════════════════════════════════════════
   3. MONOCHROME_STAMP — silhueta alto contraste
   ══════════════════════════════════════════════════ */
.art-fx--monochrome_stamp {
    filter: grayscale(100%) contrast(320%) brightness(90%);
}
.art-fx--monochrome_stamp::before {
    content: 'STAMP';
    position: absolute; bottom: 8px; right: 10px;
    font-family: 'Space Mono', monospace;
    font-size: 0.45rem; font-weight: bold;
    color: rgba(255,255,255,0.25);
    letter-spacing: 3px;
    pointer-events: none;
}

/* ══════════════════════════════════════════════════
   4. RGB_SPLIT_GLITCH — canais deslocados
   ══════════════════════════════════════════════════ */
.art-fx--rgb_split_glitch {
    filter: saturate(300%) contrast(150%);
    animation: rgbSplitInspect 3s steps(5) infinite;
}
@keyframes rgbSplitInspect {
    0%,100% { filter: saturate(300%) contrast(150%); transform: translate(0,0); }
    15%  { filter: saturate(400%) contrast(170%) hue-rotate(15deg);  transform: translate(-2px, 0); }
    30%  { filter: saturate(250%) contrast(130%) hue-rotate(-10deg); transform: translate(2px, 0); }
    45%  { filter: saturate(500%) contrast(180%) hue-rotate(30deg);  transform: translate(-1px, 1px); }
    60%  { filter: saturate(350%) contrast(145%) hue-rotate(-20deg); transform: translate(1px, -1px); }
    75%  { filter: saturate(420%) contrast(160%) hue-rotate(5deg);   transform: translate(0, 1px); }
    90%  { filter: saturate(300%) contrast(140%) hue-rotate(-5deg);  transform: translate(0, -1px); }
}
.art-fx--rgb_split_glitch::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(
        135deg,
        rgba(255,0,60,0.06)  0%,
        transparent          40%,
        rgba(0,255,200,0.06) 60%,
        transparent          100%
    );
    animation: rgbOverlayShift 2.4s ease-in-out infinite alternate;
    mix-blend-mode: screen;
    pointer-events: none;
}
@keyframes rgbOverlayShift {
    0%   { opacity: 0.4; transform: translateX(-2px); }
    100% { opacity: 0.8; transform: translateX(2px); }
}

/* ══════════════════════════════════════════════════
   5. CYBER_HOLOGRAM — holograma azul/verde neon
   ══════════════════════════════════════════════════ */
.art-fx--cyber_hologram {
    filter: hue-rotate(175deg) saturate(400%) brightness(110%) contrast(120%);
    animation: hologramFlicker 2.8s ease-in-out infinite;
}
@keyframes hologramFlicker {
    0%,100% { opacity: 1;    filter: hue-rotate(175deg) saturate(400%) brightness(110%) contrast(120%); }
    25%     { opacity: 0.85; filter: hue-rotate(190deg) saturate(450%) brightness(130%) contrast(130%); }
    50%     { opacity: 0.95; filter: hue-rotate(165deg) saturate(380%) brightness(105%) contrast(115%); }
    75%     { opacity: 0.80; filter: hue-rotate(200deg) saturate(500%) brightness(120%) contrast(140%); }
}
.art-fx--cyber_hologram::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(0,255,200,0.06) 30%,
        rgba(0,180,255,0.10) 50%,
        rgba(0,255,200,0.06) 70%,
        transparent 100%
    );
    animation: hologramSweep 3s linear infinite;
    pointer-events: none;
}
@keyframes hologramSweep {
    0%   { transform: translateY(-100%); opacity: 0; }
    10%  { opacity: 1; }
    90%  { opacity: 1; }
    100% { transform: translateY(100%); opacity: 0; }
}
.art-fx--cyber_hologram::after {
    content: '';
    position: absolute; inset: 0;
    background: repeating-linear-gradient(
        to bottom,
        rgba(0,255,200,0.04) 0px, rgba(0,255,200,0.04) 1px,
        transparent          1px, transparent          4px
    );
    pointer-events: none;
}

/* ══════════════════════════════════════════════════
   6. RETRO_MOSAIC — mosaico/pixelado clássico
   ══════════════════════════════════════════════════ */
.art-fx--retro_mosaic {
    filter: saturate(250%) contrast(130%) brightness(95%);
    image-rendering: pixelated;
    image-rendering: crisp-edges;
}
.art-fx--retro_mosaic::after {
    content: '';
    position: absolute; inset: 0;
    background-image:
        linear-gradient(rgba(0,0,0,0.12) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,0,0,0.12) 1px, transparent 1px);
    background-size: 8px 8px;
    pointer-events: none;
}

/* ── Badge de estilo no card do cofre ── */
.art-fx-badge {
    display: inline-block;
    font-family: 'Space Mono', monospace;
    font-size: 0.38rem;
    letter-spacing: 2px;
    padding: 2px 6px;
    margin-top: 3px;
    border: 1px solid currentColor;
    opacity: 0.75;
}
.art-fx-badge--halftone_matrix     { color: #cccccc; border-color: #cccccc44; }
.art-fx-badge--scanlines_overdrive { color: #00ffcc; border-color: #00ffcc44; }
.art-fx-badge--monochrome_stamp    { color: #ffffff; border-color: #ffffff44; }
.art-fx-badge--rgb_split_glitch    { color: #ff0066; border-color: #ff006644; }
.art-fx-badge--cyber_hologram      { color: #00ccff; border-color: #00ccff44; }
.art-fx-badge--retro_mosaic        { color: #ffcc00; border-color: #ffcc0044; }
    `;
    document.head.appendChild(s);
})();


// =========================================================
// ── 2. CANVAS_FX_RENDERERS — renderizadores canvas reais ─
// Cada função recebe (ctx, canvas, sourceCanvas) e desenha
// o efeito diretamente no ctx do bakedBuffer de drop-vault.js
// =========================================================
const CANVAS_FX_RENDERERS = {

    // 1. HALFTONE_MATRIX — pontos circulares em grade
    halftone_matrix(ctx, canvas, src) {
        const W = canvas.width, H = canvas.height;
        // Primeiro aplica grayscale + contraste via offscreen
        const off = document.createElement('canvas');
        off.width = W; off.height = H;
        const oCtx = off.getContext('2d');
        oCtx.filter = 'grayscale(100%) contrast(180%) brightness(92%)';
        oCtx.drawImage(src, 0, 0, W, H);
        oCtx.filter = 'none';

        // Lê os pixels do offscreen para pegar luminância
        const imgData = oCtx.getImageData(0, 0, W, H);
        const data = imgData.data;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        const dotSpacing = 9;
        for (let y = 0; y < H; y += dotSpacing) {
            for (let x = 0; x < W; x += dotSpacing) {
                const i = (y * W + x) * 4;
                const lum = (data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114) / 255;
                const r = (lum * dotSpacing * 0.55);
                if (r < 0.5) continue;
                ctx.beginPath();
                ctx.arc(x + dotSpacing/2, y + dotSpacing/2, r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255,255,255,${0.7 + lum * 0.3})`;
                ctx.fill();
            }
        }
    },

    // 2. SCANLINES_OVERDRIVE — scanlines horizontais neon sobre a imagem
    scanlines_overdrive(ctx, canvas, src) {
        const W = canvas.width, H = canvas.height;
        ctx.filter = 'contrast(140%) brightness(88%) saturate(200%) hue-rotate(180deg)';
        ctx.drawImage(src, 0, 0, W, H);
        ctx.filter = 'none';

        // Sobrepõe as scanlines
        for (let y = 0; y < H; y += 3) {
            ctx.fillStyle = 'rgba(0,0,0,0.38)';
            ctx.fillRect(0, y, W, 1);
        }
        // Linha neon de varredura ocasional
        ctx.fillStyle = 'rgba(0,255,200,0.09)';
        for (let y = 0; y < H; y += 3) {
            ctx.fillRect(0, y, W, 1);
        }
    },

    // 3. MONOCHROME_STAMP — silhueta p&b alto contraste com vinheta
    monochrome_stamp(ctx, canvas, src) {
        const W = canvas.width, H = canvas.height;
        ctx.filter = 'grayscale(100%) contrast(320%) brightness(90%)';
        ctx.drawImage(src, 0, 0, W, H);
        ctx.filter = 'none';

        // Vinheta pesada
        const grad = ctx.createRadialGradient(W/2, H/2, H*0.28, W/2, H/2, H*0.72);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Marca d'água STAMP
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.font = `bold ${Math.round(W * 0.18)}px 'Space Mono', monospace`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(W/2, H/2);
        ctx.rotate(-0.35);
        ctx.fillText('STAMP', 0, 0);
        ctx.restore();
    },

    // 4. RGB_SPLIT_GLITCH — canais R/G/B deslocados independentemente
    rgb_split_glitch(ctx, canvas, src) {
        const W = canvas.width, H = canvas.height;
        const off = document.createElement('canvas');
        off.width = W; off.height = H;
        const oCtx = off.getContext('2d');
        oCtx.filter = 'saturate(300%) contrast(150%)';
        oCtx.drawImage(src, 0, 0, W, H);
        oCtx.filter = 'none';

        const orig = oCtx.getImageData(0, 0, W, H);
        const out  = ctx.createImageData(W, H);
        const src_ = orig.data;
        const dst  = out.data;

        const shiftR = 6, shiftG = -3, shiftB = 9;

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;

                // Canal R — deslocado à direita
                const xR = Math.min(W-1, x + shiftR);
                const iR = (y * W + xR) * 4;

                // Canal G — deslocado à esquerda
                const xG = Math.max(0, x + shiftG);
                const iG = (y * W + xG) * 4;

                // Canal B — deslocado para baixo
                const yB = Math.min(H-1, y + Math.floor(shiftB / 3));
                const iB = (yB * W + x) * 4;

                dst[i]   = src_[iR];       // R
                dst[i+1] = src_[iG + 1];   // G
                dst[i+2] = src_[iB + 2];   // B
                dst[i+3] = src_[i + 3];    // A
            }
        }
        ctx.putImageData(out, 0, 0);

        // Overlay de glitch lines aleatórias
        const lines = 6;
        for (let l = 0; l < lines; l++) {
            const gy = Math.floor(Math.random() * H);
            const gh = Math.floor(1 + Math.random() * 3);
            const gx = Math.floor(Math.random() * W * 0.4);
            ctx.save();
            ctx.globalAlpha = 0.35;
            const slice = ctx.getImageData(gx, gy, W - gx, gh);
            ctx.putImageData(slice, gx + (Math.random() > 0.5 ? 4 : -4), gy);
            ctx.restore();
        }
    },

    // 5. CYBER_HOLOGRAM — holograma azul/verde com grid e sweep
    cyber_hologram(ctx, canvas, src) {
        const W = canvas.width, H = canvas.height;
        ctx.filter = 'hue-rotate(175deg) saturate(400%) brightness(110%) contrast(120%)';
        ctx.drawImage(src, 0, 0, W, H);
        ctx.filter = 'none';

        // Grid holográfico
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 1;
        const gridSz = 24;
        for (let x = 0; x < W; x += gridSz) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y < H; y += gridSz) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.restore();

        // Linha de sweep
        ctx.save();
        const sweepGrad = ctx.createLinearGradient(0, H * 0.35, 0, H * 0.65);
        sweepGrad.addColorStop(0,   'rgba(0,255,200,0)');
        sweepGrad.addColorStop(0.5, 'rgba(0,255,200,0.18)');
        sweepGrad.addColorStop(1,   'rgba(0,255,200,0)');
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();

        // Scanlines sutis
        ctx.save();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = '#000';
        for (let y = 0; y < H; y += 4) { ctx.fillRect(0, y, W, 2); }
        ctx.restore();

        // Vinheta ciano
        ctx.save();
        const vGrad = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.75);
        vGrad.addColorStop(0,   'rgba(0,200,255,0)');
        vGrad.addColorStop(1,   'rgba(0,30,60,0.55)');
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    },

    // 6. RETRO_MOSAIC — pixelado com grid de blocos coloridos
    retro_mosaic(ctx, canvas, src) {
        const W = canvas.width, H = canvas.height;
        const blockSz = 10; // tamanho do bloco em pixels

        // Desenha em versão reduzida e estica (cria o efeito pixelado real)
        const tiny = document.createElement('canvas');
        const tw = Math.round(W / blockSz);
        const th = Math.round(H / blockSz);
        tiny.width = tw; tiny.height = th;
        const tCtx = tiny.getContext('2d');
        tCtx.filter = 'saturate(250%) contrast(130%) brightness(95%)';
        tCtx.drawImage(src, 0, 0, tw, th);
        tCtx.filter = 'none';

        // Desabilita suavização para manter os pixels nítidos
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, W, H);
        ctx.imageSmoothingEnabled = true;

        // Grade de blocos
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += blockSz) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y < H; y += blockSz) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.restore();
    }
};
window.CANVAS_FX_RENDERERS = CANVAS_FX_RENDERERS;


// =========================================================
// ── 3. INTEGRAÇÃO COM drop-vault.js ──────────────────────
// Sobrescreve applyDropStyleFilter quando o estilo tem canvasFx.
// drop-vault.js chama applyDropStyleFilter(ctx, canvas, styleObj)
// — aqui adicionamos a lógica de roteamento.
// =========================================================
const _origApplyDropStyleFilter = window.applyDropStyleFilter;

window.applyDropStyleFilter = function(ctx, canvas, styleObj) {
    if (!styleObj) return;

    // Se o estilo tem um renderizador canvas dedicado, usa ele
    if (styleObj.canvasFx && CANVAS_FX_RENDERERS[styleObj.canvasFx]) {
        // Cria uma cópia limpa da fonte para o renderer usar
        const srcCopy = document.createElement('canvas');
        srcCopy.width  = canvas.width;
        srcCopy.height = canvas.height;
        srcCopy.getContext('2d').drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        CANVAS_FX_RENDERERS[styleObj.canvasFx](ctx, canvas, srcCopy);
        return;
    }

    // Fallback: comportamento original para os outros estilos
    if (typeof _origApplyDropStyleFilter === 'function') {
        _origApplyDropStyleFilter(ctx, canvas, styleObj);
    }
};


// =========================================================
// ── 4. applyInspectStyleFx — modal de Inspect e cofre ───
// Chamado ao abrir o modal de Inspect ou ao renderizar um
// card no cofre. Adiciona a classe CSS correta ao elemento.
//
// Uso em inspect:
//   applyInspectStyleFx(imgEl, card.styleName);
// Uso em renderVaultGrid (opcional — para o card do cofre):
//   applyInspectStyleFx(cardImgEl, asset.styleName);
// =========================================================
const ART_FX_IDS = new Set([
    'halftone_matrix','scanlines_overdrive','monochrome_stamp',
    'rgb_split_glitch','cyber_hologram','retro_mosaic'
]);

function applyInspectStyleFx(el, styleNameRaw) {
    if (!el || !styleNameRaw) return;
    const id = styleNameRaw.toLowerCase().replace(/[\s-]+/g,'_');
    if (!ART_FX_IDS.has(id)) return;

    // Garante o wrapper relativo
    const parent = el.parentElement;
    if (parent && !parent.classList.contains('art-fx-wrap')) {
        parent.classList.add('art-fx-wrap');
    }

    // Remove classes anteriores e aplica a nova
    el.classList.forEach(c => { if (c.startsWith('art-fx--')) el.classList.remove(c); });
    el.classList.add(`art-fx--${id}`);

    // Injeta badge no card do cofre (se não existir ainda)
    if (parent) {
        if (!parent.querySelector('.art-fx-badge')) {
            const badge = document.createElement('span');
            badge.className = `art-fx-badge art-fx-badge--${id}`;
            badge.textContent = styleNameRaw.toUpperCase();
            parent.appendChild(badge);
        }
    }
}
window.applyInspectStyleFx = applyInspectStyleFx;


// =========================================================
// ── 5. Patch do modal de Inspect ─────────────────────────
// Intercepta a abertura do modal de inspect para aplicar
// o efeito CSS ao <img> ou <canvas> do card visualizado.
// Compatível com a função openInspectModal existente no projeto.
// =========================================================
(function _patchInspectModal() {
    const _origOpen = window.openInspectModal;
    if (typeof _origOpen !== 'function' || window._inspectArtFxPatched) return;
    window._inspectArtFxPatched = true;

    window.openInspectModal = function(asset, ...args) {
        const result = _origOpen.call(this, asset, ...args);

        // Aguarda o modal estar no DOM antes de aplicar o efeito
        requestAnimationFrame(() => {
            // Tenta encontrar o elemento de imagem dentro do modal de inspect
            const modal  = document.getElementById('inspectModal')
                        || document.getElementById('inspect-modal')
                        || document.querySelector('.inspect-overlay, .modal-inspect');
            if (!modal) return;

            const imgEl  = modal.querySelector('img, canvas');
            if (!imgEl) return;

            const styleName = asset && (asset.styleName || asset.style_name || '');
            applyInspectStyleFx(imgEl, styleName);
        });

        return result;
    };
})();


// =========================================================
// ── 6. DROP_FILTER_DB — adiciona os 6 novos estilos ─────
// Garante que os estilos de arte direcional aparecem no
// seletor <select> de filtros do painel de drop via
// renderDropStyleFilters() de drop-vault.js.
// Executa depois que DROP_FILTER_DB e DROP_STYLE_NAME_LIST
// já foram declarados por drop-vault.js.
// =========================================================
(function _extendDropFilterDb() {
    const ART_FX_STYLES = [
        { name: 'HALFTONE_MATRIX',
          filter: 'contrast(180%) brightness(92%) saturate(0%)',
          canvasFx: 'halftone_matrix' },
        { name: 'SCANLINES_OVERDRIVE',
          filter: 'contrast(140%) brightness(88%) saturate(200%) hue-rotate(180deg)',
          canvasFx: 'scanlines_overdrive' },
        { name: 'MONOCHROME_STAMP',
          filter: 'grayscale(100%) contrast(300%) brightness(90%)',
          canvasFx: 'monochrome_stamp' },
        { name: 'RGB_SPLIT_GLITCH',
          filter: 'saturate(300%) contrast(150%) hue-rotate(10deg)',
          canvasFx: 'rgb_split_glitch' },
        { name: 'CYBER_HOLOGRAM',
          filter: 'hue-rotate(175deg) saturate(400%) brightness(110%) contrast(120%)',
          canvasFx: 'cyber_hologram' },
        { name: 'RETRO_MOSAIC',
          filter: 'saturate(250%) contrast(130%) brightness(95%)',
          canvasFx: 'retro_mosaic' }
    ];

    function _tryExtend() {
        if (typeof DROP_FILTER_DB === 'undefined' ||
            typeof DROP_STYLE_NAME_LIST === 'undefined') {
            // drop-vault.js ainda não carregou — tenta novamente
            setTimeout(_tryExtend, 150);
            return;
        }

        ART_FX_STYLES.forEach(s => {
            // Adiciona a todos os pools de raridade se ainda não existir
            ['common','epic','legendary','ancestral'].forEach(rarity => {
                const pool = DROP_FILTER_DB[rarity];
                if (pool && !pool.find(v => v.name === s.name)) {
                    pool.push(s);
                }
            });
            // Adiciona ao DROP_STYLE_NAME_LIST global (usado no <select>)
            if (!DROP_STYLE_NAME_LIST.includes(s.name)) {
                DROP_STYLE_NAME_LIST.push(s.name);
            }
        });

        // Re-renderiza o painel de filtros se já estiver no DOM
        if (typeof renderDropStyleFilters === 'function') {
            renderDropStyleFilters();
        }

        console.log('[visual-fx-styles] 6 estilos de arte direcional registrados no DROP_FILTER_DB.');
    }

    _tryExtend();
})();

console.log('[visual-fx-styles] Módulo carregado — HALFTONE_MATRIX, SCANLINES_OVERDRIVE, MONOCHROME_STAMP, RGB_SPLIT_GLITCH, CYBER_HOLOGRAM, RETRO_MOSAIC.');
