(() => {
  "use strict";

  const MAX_PRIZES = 12;
  const MIN_PRIZES = 2;
  const MAX_HISTORY = 9;
  const TAU = Math.PI * 2;

  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

  const DEFAULT_PRIZES = [
    { name: "一等奖", emoji: "🏆", weight: 2, stock: 1 },
    { name: "二等奖", emoji: "🎁", weight: 5, stock: 2 },
    { name: "三等奖", emoji: "🎊", weight: 8, stock: 3 },
    { name: "现金红包", emoji: "🧧", weight: 10, stock: 5 },
    { name: "优惠券", emoji: "🎟️", weight: 14, stock: 8 },
    { name: "积分 × 100", emoji: "⭐", weight: 18, stock: 12 },
    { name: "再来一次", emoji: "🔁", weight: 20, stock: 99 },
    { name: "谢谢参与", emoji: "🍀", weight: 23, stock: 99 },
  ];

  function createDefaultState() {
    return {
      version: 2,
      mode: "infinite",
      prizes: DEFAULT_PRIZES.map((item) => ({
        id: uid(),
        ...item,
        image: "",
        initialStock: item.stock,
      })),
      history: [],
      drawCount: 0,
      historyCount: 0,
      revision: 0,
      updatedAt: Date.now(),
    };
  }

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
  }

  function safeImage(value) {
    return typeof value === "string" && value.startsWith("data:image/") ? value : "";
  }

  function normalizePrize(prize, index) {
    const stock = safeNumber(prize?.stock, DEFAULT_PRIZES[index]?.stock || 5);
    return {
      id: typeof prize?.id === "string" ? prize.id : uid(),
      name: typeof prize?.name === "string" ? prize.name.slice(0, 24) : `奖品 ${index + 1}`,
      emoji:
        typeof prize?.emoji === "string" && prize.emoji
          ? prize.emoji.slice(0, 8)
          : DEFAULT_PRIZES[index]?.emoji || "🎁",
      image: safeImage(prize?.image),
      weight: safeNumber(prize?.weight, 10),
      stock,
      initialStock: safeNumber(prize?.initialStock, stock),
    };
  }

  function normalizeHistoryItem(item) {
    return {
      id: typeof item?.id === "string" ? item.id : uid(),
      name: typeof item?.name === "string" ? item.name.slice(0, 24) : "未命名奖品",
      emoji: typeof item?.emoji === "string" ? item.emoji.slice(0, 8) : "🎁",
      image: safeImage(item?.image),
      createdAt: Number(item?.createdAt) || Date.now(),
      drawNo: safeNumber(item?.drawNo, 0),
      mode: item?.mode === "stock" ? "stock" : "infinite",
      prizeId: typeof item?.prizeId === "string" ? item.prizeId : "",
      weight: safeNumber(item?.weight, 0),
      stockAfter: safeNumber(item?.stockAfter, 0),
      timezone: typeof item?.timezone === "string" ? item.timezone.slice(0, 64) : "",
      synced: true,
    };
  }

  function applyRemoteState(raw, { includeHistory = true } = {}) {
    const incomingPrizes = Array.isArray(raw?.prizes) ? raw.prizes : [];
    const prizes = incomingPrizes.slice(0, MAX_PRIZES).map(normalizePrize);
    if (prizes.length >= MIN_PRIZES) state.prizes = prizes;
    state.revision = safeNumber(raw?.revision, state.revision);
    state.updatedAt = Number(raw?.updatedAt) || state.updatedAt;
    state.drawCount = safeNumber(raw?.drawCount, state.drawCount);
    state.historyCount = state.drawCount;
    if (includeHistory && Array.isArray(raw?.history)) {
      state.history = raw.history.slice(0, MAX_HISTORY).map(normalizeHistoryItem);
    }
  }

  let state = createDefaultState();
  let spinning = false;
  let spinFrame = 0;
  let confettiFrame = 0;
  let currentRotation = 0;
  let highlightedPrize = -1;
  let resizeObserver = null;
  let resizeHandler = null;
  let toastTimer = 0;
  let configLoaded = false;
  let configDirty = false;
  let configSaving = false;
  const imageCache = new Map();
  const app = document.querySelector("#app");

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function displayName(prize) {
    return prize.name.trim() || "未命名奖品";
  }

  function isMiss(prize) {
    return /谢谢|参与|未中奖|再接再厉/.test(displayName(prize));
  }

  function routeName() {
    return "draw";
  }

  function isFileRoute() {
    return location.protocol === "file:";
  }

  function routeHref() {
    if (!isFileRoute()) return "/";
    const inNestedPage = /[\\/](?:admin|config)[\\/]/.test(location.pathname);
    return inNestedPage ? "../index.html" : "./index.html";
  }

  function adminHref() {
    if (!isFileRoute()) return "/admin";
    const inAdmin = /[\\/]admin[\\/]/.test(location.pathname);
    return inAdmin ? "./index.html" : "./admin/index.html";
  }

  function assetUrl(filename) {
    if (!isFileRoute()) return `/${filename}`;
    const inNestedPage = /[\\/](?:admin|config)[\\/]/.test(location.pathname);
    return `${inNestedPage ? "../" : "./"}${filename}`;
  }

  function navigate(route) {
    if (spinning) {
      showToast("本轮抽奖结束后再离开页面");
      return;
    }
    if (!app) {
      location.href = routeHref(route);
      return;
    }
    if (isFileRoute()) {
      location.href = routeHref(route);
      return;
    }
    history.pushState({}, "", routeHref(route));
    renderRoute();
    scrollTo({ top: 0, behavior: "smooth" });
  }

  function brandHeader() {
    return `
      <header class="masthead">
        <a class="brand" href="${routeHref("draw")}" data-route="draw" aria-label="返回威利华木抽奖首页">
          <img class="brand-logo" src="${assetUrl("logo.png")}" alt="威利华木">
          <span class="brand-copy">
            <strong>威利华木</strong>
            <span>WEILIHUAMU</span>
          </span>
        </a>
        <div class="header-note"><b>LUCKY DRAW</b>让每一次转动，都值得期待</div>
      </header>`;
  }

  function globalLayers() {
    return `
      <canvas class="confetti" id="confettiCanvas" aria-hidden="true"></canvas>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
  }

  function cleanupView() {
    cancelAnimationFrame(spinFrame);
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (resizeHandler) {
      removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
  }

  function renderRoute() {
    if (!app) return;
    cleanupView();
    document.title = "威利华木 · 幸运抽奖";
    app.innerHTML = `
      <div class="app-shell">
        ${brandHeader()}
        ${drawTemplate()}
        <footer class="site-footer">WEILIHUAMU · 幸运由心，美好常在</footer>
      </div>
      ${globalLayers()}`;

    app.querySelectorAll("[data-route]").forEach((link) => {
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(link.dataset.route);
      });
    });

    initDrawView();
  }

  function drawTemplate() {
    return `
      <main class="draw-view route-enter">
        <div class="draw-toolbar" aria-label="抽奖控制">
          <div class="mode-switch" id="modeSwitch" aria-label="抽奖模式">
            <button type="button" data-mode="infinite">无限模式</button>
            <button type="button" data-mode="stock">库存模式</button>
          </div>
          <div class="stock-chip" id="stockChip"><span>可抽数量</span><b>∞</b></div>
          <a class="btn btn-outline admin-link" href="${adminHref()}">
            <span aria-hidden="true">🔐</span> 管理后台
          </a>
        </div>

        <section class="stage" aria-labelledby="drawTitle">
          <div class="stage-intro">
            <h1 id="drawTitle">幸运抽奖</h1>
            <p id="modeDescription">按权重无限抽取，每一次都有同样的期待</p>
          </div>
          <div class="wheel-area">
            <div class="wheel-frame" id="wheelFrame">
              <canvas id="wheelCanvas" aria-label="幸运抽奖转盘"></canvas>
              <span class="pointer" aria-hidden="true"></span>
            </div>
          </div>
          <button class="btn btn-gold draw-action" id="drawButton" type="button">立即抽奖</button>
          <p class="draw-hint">点击转盘或按空格键也可以开始</p>
        </section>

        <section class="history-panel" aria-labelledby="historyTitle">
          <div class="section-heading">
            <div>
              <h2 id="historyTitle">抽奖记录</h2>
              <p>最近 9 次抽奖记录由 Cloudflare D1 持久化保存</p>
            </div>
          </div>
          <ul class="history-list" id="historyList"></ul>
        </section>
      </main>

      <div class="modal" id="resultModal" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
        <div class="modal-card">
          <div class="modal-seal" id="resultSeal">恭喜中奖</div>
          <div class="modal-prize" id="resultVisual"></div>
          <h2 id="resultTitle"></h2>
          <p id="resultMeta"></p>
          <div class="modal-actions">
            <button class="btn btn-outline" id="closeResult" type="button">收下好运</button>
            <button class="btn btn-gold" id="drawAgain" type="button">再抽一次</button>
          </div>
        </div>
      </div>`;
  }

  function activePool() {
    return state.prizes
      .map((prize, index) => ({ prize, index }))
      .filter(({ prize }) => prize.weight > 0 && (state.mode === "infinite" || prize.stock > 0));
  }

  function totalActiveWeight() {
    return activePool().reduce((sum, item) => sum + item.prize.weight, 0);
  }

  function weightedPick(pool = activePool()) {
    const total = pool.reduce((sum, item) => sum + item.prize.weight, 0);
    if (!pool.length || total <= 0) return -1;
    let cursor = Math.random() * total;
    for (const item of pool) {
      cursor -= item.prize.weight;
      if (cursor < 0) return item.index;
    }
    return pool.at(-1).index;
  }

  function initDrawView() {
    const canvas = document.querySelector("#wheelCanvas");
    const frame = document.querySelector("#wheelFrame");
    const drawButton = document.querySelector("#drawButton");
    const context = canvas.getContext("2d");

    function resizeWheel() {
      const size = Math.max(1, Math.floor(canvas.clientWidth));
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWheel(context, size);
    }

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(resizeWheel);
      resizeObserver.observe(canvas);
    } else {
      resizeHandler = resizeWheel;
      addEventListener("resize", resizeHandler);
    }

    frame.addEventListener("click", startDraw);
    drawButton.addEventListener("click", startDraw);
    document.querySelector("#modeSwitch").addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button || spinning || button.dataset.mode === state.mode) return;
      state.mode = button.dataset.mode;
      highlightedPrize = -1;
      updateDrawControls();
      drawWheel(context, Math.floor(canvas.clientWidth));
    });

    const modal = document.querySelector("#resultModal");
    const closeModal = () => modal.classList.remove("is-open");
    document.querySelector("#closeResult").addEventListener("click", closeModal);
    document.querySelector("#drawAgain").addEventListener("click", () => {
      closeModal();
      setTimeout(startDraw, 80);
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });

    const keyboardHandler = (event) => {
      if (routeName() !== "draw") return;
      if (event.code === "Escape") closeModal();
      if (
        event.code === "Space" &&
        !event.repeat &&
        !modal.classList.contains("is-open") &&
        !event.target.closest("button, a, input, select, textarea")
      ) {
        event.preventDefault();
        startDraw();
      }
    };
    addEventListener("keydown", keyboardHandler, { once: false });
    const oldCleanup = cleanupView;
    cleanupView = function cleanupDrawView() {
      removeEventListener("keydown", keyboardHandler);
      oldCleanup();
      cleanupView = oldCleanup;
    };

    async function startDraw() {
      if (spinning || !configLoaded) return;
      spinning = true;
      highlightedPrize = -1;
      frame.classList.add("spinning");
      drawButton.disabled = true;
      drawButton.textContent = "正在确认奖池…";

      let drawResult;
      try {
        const response = await fetch("/api/draws", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            mode: state.mode,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 409) {
            showToast(
              state.mode === "stock"
                ? "可抽库存已用完，请前往管理后台重置库存"
                : "请前往管理后台设置有效奖品权重"
            );
            await loadPublicLotteryState({ announce: false });
            return;
          }
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        drawResult = data;
        if (data.config) applyRemoteState(data.config, { includeHistory: false });
      } catch (error) {
        console.error(error);
        showToast("无法连接 D1 奖池，请稍后重试");
        return;
      } finally {
        if (!drawResult) {
          spinning = false;
          frame.classList.remove("spinning");
          drawButton.disabled = !configLoaded;
          drawButton.textContent = "立即抽奖";
        }
      }

      const selectedIndex = state.prizes.findIndex(
        (prize) => prize.id === drawResult?.prize?.id
      );
      if (selectedIndex < 0) {
        spinning = false;
        frame.classList.remove("spinning");
        drawButton.disabled = false;
        drawButton.textContent = "立即抽奖";
        showToast("奖池刚刚发生变化，请重新抽取");
        await loadPublicLotteryState({ announce: false });
        return;
      }
      drawButton.textContent = "好运转动中…";

      const prizeCount = state.prizes.length;
      const arc = TAU / prizeCount;
      const currentMod = ((currentRotation % TAU) + TAU) % TAU;
      const desiredMod = ((-selectedIndex * arc) % TAU + TAU) % TAU;
      const extraTurns = 7 + Math.floor(Math.random() * 3);
      const delta = ((desiredMod - currentMod + TAU) % TAU) + extraTurns * TAU;
      const startRotation = currentRotation;
      const startedAt = performance.now();
      const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = reduceMotion ? 280 : 4300;

      function animate(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 5);
        currentRotation = startRotation + delta * eased;
        drawWheel(context, Math.floor(canvas.clientWidth));

        if (progress < 1) {
          spinFrame = requestAnimationFrame(animate);
          return;
        }

        currentRotation = desiredMod;
        completeDraw(selectedIndex, drawResult.record);
      }

      spinFrame = requestAnimationFrame(animate);
    }

    function completeDraw(selectedIndex, record) {
      const prize = state.prizes[selectedIndex];
      if (!prize) {
        spinning = false;
        renderRoute();
        return;
      }

      const normalizedRecord = normalizeHistoryItem(record || {});
      state.drawCount = Math.max(state.drawCount, normalizedRecord.drawNo);
      state.historyCount = state.drawCount;
      state.history.unshift(normalizedRecord);
      state.history = state.history.slice(0, MAX_HISTORY);
      highlightedPrize = selectedIndex;
      spinning = false;
      frame.classList.remove("spinning");
      drawButton.disabled = false;
      drawButton.textContent = "立即抽奖";
      updateDrawControls();
      renderHistory();
      drawWheel(context, Math.floor(canvas.clientWidth));
      openResult(prize);
      if (!isMiss(prize)) launchConfetti();
    }

    updateDrawControls();
    renderHistory();
    resizeWheel();
    drawButton.disabled = true;
    drawButton.textContent = "载入奖池…";
    void loadPublicLotteryState();

    async function loadPublicLotteryState({ announce = true } = {}) {
      try {
        const response = await fetch("/api/config", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        applyRemoteState(await response.json());
        configLoaded = true;
        updateDrawControls();
        renderHistory();
        resizeWheel();
        drawButton.disabled = false;
        drawButton.textContent = "立即抽奖";
        if (announce) showToast("D1 奖池已载入");
      } catch (error) {
        console.error(error);
        configLoaded = false;
        drawButton.disabled = true;
        drawButton.textContent = "奖池载入失败";
        showToast("无法读取 D1 奖池，请刷新页面重试");
      }
    }
  }

  function drawWheel(context, size) {
    if (!context || !size || routeName() !== "draw") return;
    const radius = size / 2;
    const count = state.prizes.length;
    const arc = TAU / count;
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(radius, radius);

    state.prizes.forEach((prize, index) => {
      const start = -Math.PI / 2 - arc / 2 + index * arc + currentRotation;
      const end = start + arc;
      const sold = state.mode === "stock" && prize.stock <= 0;
      let fill = index % 2 === 0 ? "#E8F5EB" : "#FFFFFF";
      if (sold) fill = "#E8ECE9";
      if (highlightedPrize === index) fill = "#FFF0C5";

      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius * 0.98, start, end);
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      context.lineWidth = Math.max(1.2, size * 0.004);
      context.strokeStyle = "#FFFFFF";
      context.stroke();
    });

    context.beginPath();
    context.arc(0, 0, radius * 0.96, 0, TAU);
    context.lineWidth = Math.max(2, size * 0.009);
    context.strokeStyle = "#D4A338";
    context.stroke();
    context.restore();

    state.prizes.forEach((prize, index) => {
      const mid = -Math.PI / 2 + index * arc + currentRotation;
      const textRadius = radius * (count > 9 ? 0.68 : 0.64);
      const x = radius + Math.cos(mid) * textRadius;
      const y = radius + Math.sin(mid) * textRadius;
      const sold = state.mode === "stock" && prize.stock <= 0;
      const iconSize = Math.max(20, Math.min(size * 0.068, 55));
      const image = prize.image ? cachedImage(prize.image) : null;

      context.save();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.globalAlpha = sold ? 0.48 : 1;

      if (image?.complete && image.naturalWidth) {
        const crop = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = (image.naturalWidth - crop) / 2;
        const sourceY = (image.naturalHeight - crop) / 2;
        context.save();
        context.beginPath();
        context.arc(x, y - iconSize * 0.44, iconSize * 0.48, 0, TAU);
        context.clip();
        context.drawImage(
          image,
          sourceX,
          sourceY,
          crop,
          crop,
          x - iconSize / 2,
          y - iconSize * 0.94,
          iconSize,
          iconSize
        );
        context.restore();
      } else {
        context.font = `${iconSize}px "Segoe UI Emoji", sans-serif`;
        context.fillText(prize.emoji || "🎁", x, y - iconSize * 0.42);
      }

      const fontSize = Math.max(10, Math.min(size / (count > 9 ? 45 : 37), 21));
      context.font = `700 ${fontSize}px "Microsoft YaHei", sans-serif`;
      context.fillStyle = sold ? "#84918A" : "#183229";
      const label = sold ? "已抽完" : displayName(prize);
      context.fillText(label, x, y + iconSize * 0.48, radius * 0.38);
      context.restore();
    });

    context.save();
    context.translate(radius, radius);
    context.shadowColor = "rgba(0, 76, 42, .28)";
    context.shadowBlur = size * 0.035;
    context.beginPath();
    context.arc(0, 0, radius * 0.215, 0, TAU);
    context.fillStyle = "#00A651";
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = Math.max(4, size * 0.014);
    context.strokeStyle = "#E6B85C";
    context.stroke();
    context.beginPath();
    context.arc(0, 0, radius * 0.17, 0, TAU);
    context.lineWidth = Math.max(1, size * 0.003);
    context.strokeStyle = "rgba(255,255,255,.38)";
    context.stroke();
    context.fillStyle = "#FFFFFF";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `700 ${Math.max(16, size * 0.055)}px "STZhongsong", "Microsoft YaHei", serif`;
    context.fillText(spinning ? "好运" : "抽奖", 0, -size * 0.008);
    context.fillStyle = "#DDF6E8";
    context.font = `700 ${Math.max(7, size * 0.015)}px Georgia, serif`;
    context.fillText("LUCKY", 0, size * 0.06);
    context.restore();
  }

  function cachedImage(src) {
    if (!src) return null;
    if (imageCache.has(src)) return imageCache.get(src);
    const image = new Image();
    image.onload = () => {
      if (!spinning && routeName() === "draw") {
        const canvas = document.querySelector("#wheelCanvas");
        drawWheel(canvas?.getContext("2d"), Math.floor(canvas?.clientWidth || 0));
      }
    };
    image.src = src;
    imageCache.set(src, image);
    return image;
  }

  function updateDrawControls() {
    const mode = state.mode;
    document.querySelectorAll("#modeSwitch [data-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });

    const totalStock = state.prizes.reduce((sum, prize) => sum + prize.stock, 0);
    const chip = document.querySelector("#stockChip");
    if (chip) {
      chip.innerHTML =
        mode === "stock"
          ? `<span>剩余库存</span><b>${totalStock}</b>`
          : "<span>可抽数量</span><b>∞</b>";
    }

    const description = document.querySelector("#modeDescription");
    if (description) {
      description.textContent =
        mode === "stock"
          ? "中奖后自动扣减库存，售罄奖品不再参与抽取"
          : "按权重无限抽取，每一次都有同样的期待";
    }
  }

  function renderHistory() {
    const list = document.querySelector("#historyList");
    if (!list) return;
    if (!state.history.length) {
      list.innerHTML = '<li class="empty-state">还没有抽奖记录，转动一次试试吧</li>';
      return;
    }

    list.innerHTML = state.history
      .slice(0, 9)
      .map((item) => {
        const visual = item.image
          ? `<img src="${item.image}" alt="">`
          : escapeHtml(item.emoji || "🎁");
        const time = new Date(item.createdAt).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        return `
          <li class="history-item">
            <span class="history-icon">${visual}</span>
            <span class="history-info">
              <b>${escapeHtml(item.name)}</b>
              <time>${escapeHtml(time)}</time>
            </span>
            <span class="history-tag" title="${item.synced ? "已同步至 D1" : "等待同步"}">#${item.drawNo}</span>
          </li>`;
      })
      .join("");
  }

  function openResult(prize) {
    const modal = document.querySelector("#resultModal");
    const miss = isMiss(prize);
    document.querySelector("#resultSeal").textContent = miss ? "幸运相伴" : "恭喜中奖";
    document.querySelector("#resultTitle").textContent = displayName(prize);
    document.querySelector("#resultVisual").innerHTML = prize.image
      ? `<img src="${prize.image}" alt="${escapeHtml(displayName(prize))}">`
      : escapeHtml(prize.emoji || "🎁");
    document.querySelector("#resultMeta").textContent =
      state.mode === "stock"
        ? `第 ${state.drawCount} 抽 · 当前库存 ${prize.stock}`
        : `第 ${state.drawCount} 抽 · 权重 ${prize.weight}`;
    modal.classList.add("is-open");
    document.querySelector("#closeResult").focus();
  }

  function configTemplate() {
    return `
      <section class="admin-config-section route-enter">
        <div class="surface admin-config-intro">
          <div>
            <p class="admin-config-kicker">PRIZE &amp; PROBABILITY</p>
            <h2>抽奖配置</h2>
            <p>设置奖品名称、图片、权重与库存。点击保存后写入 Cloudflare D1，并立即供所有抽奖设备使用。</p>
          </div>
          <div class="admin-config-actions">
            <span class="save-state" id="saveState">正在读取 D1…</span>
            <button class="btn btn-green" id="saveConfig" type="button">保存到 D1</button>
            <button class="btn btn-gold" id="saveAndReturn" type="button">保存并返回抽奖</button>
          </div>
        </div>

        <div class="config-grid">
          <section class="surface" aria-labelledby="prizeSettingsTitle">
            <div class="surface-head">
              <div>
                <h2 id="prizeSettingsTitle">奖品与库存</h2>
                <p>权重越高，被抽中的机会越大</p>
              </div>
              <span class="weight-total">TOTAL <b id="totalWeight">0</b></span>
            </div>
            <div class="prize-table-head" aria-hidden="true">
              <span>图片</span><span>奖品名称</span><span>权重</span><span>当前库存</span><span>有效概率</span><span></span>
            </div>
            <div class="prize-list" id="prizeList"></div>
            <div class="table-actions">
              <button class="btn btn-green" id="addPrize" type="button">＋ 添加奖品</button>
              <button class="btn btn-outline" id="resetStock" type="button">↻ 重置库存</button>
            </div>
          </section>

          <aside class="side-stack">
            <section class="surface" aria-labelledby="simulationTitle">
              <div class="surface-head">
                <div>
                  <h2 id="simulationTitle">概率自检</h2>
                  <p>按当前模式与可抽池随机模拟</p>
                </div>
              </div>
              <div class="sim-controls">
                <select class="field" id="simulationCount" aria-label="模拟次数">
                  <option value="1000">模拟 1,000 次</option>
                  <option value="10000">模拟 10,000 次</option>
                  <option value="50000">模拟 50,000 次</option>
                </select>
                <button class="btn btn-gold" id="runSimulation" type="button">开始模拟</button>
              </div>
              <div class="sim-results" id="simulationResults">
                <div class="sim-placeholder">点击“开始模拟”<br>校验当前奖品概率分布</div>
              </div>
            </section>

            <section class="surface config-summary" aria-labelledby="summaryTitle">
              <div class="section-heading">
                <div>
                  <h2 id="summaryTitle">配置概览</h2>
                  <p>当前抽奖池的实时状态</p>
                </div>
              </div>
              <dl class="summary-list">
                <dt>抽奖模式</dt><dd id="summaryMode">前台可切换</dd>
                <dt>奖品数量</dt><dd id="summaryPrizeCount">—</dd>
                <dt>有效奖品</dt><dd id="summaryActiveCount">—</dd>
                <dt>剩余库存</dt><dd id="summaryStock">—</dd>
                <dt>累计抽奖</dt><dd id="summaryHistory">—</dd>
              </dl>
            </section>
          </aside>
        </div>
      </section>`;
  }

  function initConfigView({ onSaveAndReturn } = {}) {
    renderPrizeEditor();
    refreshConfigComputed();

    document.querySelector("#prizeList").addEventListener("input", (event) => {
      const input = event.target.closest("[data-field]");
      if (!input) return;
      const prize = state.prizes.find((item) => item.id === input.dataset.id);
      if (!prize) return;

      if (input.dataset.field === "name") {
        prize.name = input.value.slice(0, 24);
      } else if (input.dataset.field === "weight") {
        prize.weight = safeNumber(input.value);
      } else if (input.dataset.field === "stock") {
        prize.stock = safeNumber(input.value);
        prize.initialStock = prize.stock;
        input.closest(".prize-row")?.classList.toggle(
          "is-sold",
          state.mode === "stock" && prize.stock <= 0
        );
      }
      markConfigDirty();
      refreshConfigComputed();
    });

    document.querySelector("#prizeList").addEventListener("click", (event) => {
      const imageButton = event.target.closest('[data-action="image"]');
      const deleteButton = event.target.closest('[data-action="delete"]');
      if (imageButton) choosePrizeImage(imageButton.dataset.id);
      if (deleteButton) deletePrize(deleteButton.dataset.id);
    });

    document.querySelector("#addPrize").addEventListener("click", () => {
      if (state.prizes.length >= MAX_PRIZES) {
        showToast(`最多可设置 ${MAX_PRIZES} 个奖品`);
        return;
      }
      state.prizes.push({
        id: uid(),
        name: "新奖品",
        emoji: "🎁",
        image: "",
        weight: 10,
        stock: 5,
        initialStock: 5,
      });
      markConfigDirty();
      renderPrizeEditor();
      refreshConfigComputed();
      document.querySelector("#prizeList .prize-row:last-child .name-field")?.focus();
    });

    document.querySelector("#resetStock").addEventListener("click", () => {
      state.prizes.forEach((prize) => {
        prize.stock = prize.initialStock;
      });
      markConfigDirty();
      renderPrizeEditor();
      refreshConfigComputed();
      showToast("库存已恢复为配置值");
    });

    document.querySelector("#runSimulation").addEventListener("click", runSimulation);
    document.querySelector("#saveConfig").addEventListener("click", () => {
      void saveAdminConfig();
    });
    document.querySelector("#saveAndReturn").addEventListener("click", async () => {
      if (await saveAdminConfig()) {
        showToast("配置已保存，正在返回抽奖");
        setTimeout(() => {
          if (typeof onSaveAndReturn === "function") onSaveAndReturn();
          else navigate("draw");
        }, 260);
      }
    });
  }

  function markConfigDirty() {
    configDirty = true;
    setConfigStatus("有未保存的修改");
  }

  function setConfigStatus(message) {
    const indicator = document.querySelector("#saveState");
    if (indicator) indicator.textContent = message;
  }

  function setConfigSaving(saving) {
    configSaving = saving;
    document.querySelectorAll("#saveConfig, #saveAndReturn").forEach((button) => {
      button.disabled = saving;
    });
  }

  async function saveAdminConfig() {
    if (configSaving) return false;
    if (state.prizes.some((prize) => !prize.name.trim())) {
      showToast("请填写所有奖品名称");
      return false;
    }

    setConfigSaving(true);
    setConfigStatus("正在保存到 D1…");
    try {
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          revision: state.revision,
          prizes: state.prizes,
        }),
      });
      if (response.status === 401) {
        location.reload();
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      applyRemoteState(data);
      configDirty = false;
      renderPrizeEditor();
      refreshConfigComputed();
      const time = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      setConfigStatus(`已保存至 D1 · ${time}`);
      showToast("抽奖配置已保存到 D1");
      return true;
    } catch (error) {
      console.error(error);
      setConfigStatus("保存失败，请重试");
      showToast("无法保存 D1 配置");
      return false;
    } finally {
      setConfigSaving(false);
    }
  }

  function renderPrizeEditor() {
    const list = document.querySelector("#prizeList");
    if (!list) return;
    const pool = activePool();
    const activeIds = new Set(pool.map((item) => item.prize.id));
    const total = pool.reduce((sum, item) => sum + item.prize.weight, 0);

    list.innerHTML = state.prizes
      .map((prize) => {
        const probability =
          activeIds.has(prize.id) && total > 0
            ? `${((prize.weight / total) * 100).toFixed(1)}%`
            : "—";
        const visual = prize.image
          ? `<img src="${prize.image}" alt="">`
          : escapeHtml(prize.emoji || "🎁");
        const soldClass = state.mode === "stock" && prize.stock <= 0 ? " is-sold" : "";
        return `
          <div class="prize-row${soldClass}" data-row-id="${prize.id}">
            <button class="image-picker" type="button" data-action="image" data-id="${prize.id}" aria-label="更换 ${escapeHtml(displayName(prize))} 的图片">
              ${visual}<small>＋</small>
            </button>
            <input class="field name-field" data-field="name" data-id="${prize.id}" value="${escapeHtml(prize.name)}" maxlength="24" aria-label="奖品名称">
            <input class="field field-number" data-field="weight" data-id="${prize.id}" type="number" min="0" max="9999" value="${prize.weight}" aria-label="${escapeHtml(displayName(prize))}的权重">
            <input class="field field-number" data-field="stock" data-id="${prize.id}" type="number" min="0" max="9999" value="${prize.stock}" aria-label="${escapeHtml(displayName(prize))}的库存">
            <span class="probability" data-probability="${prize.id}">${probability}</span>
            <button class="btn btn-outline btn-square btn-danger" type="button" data-action="delete" data-id="${prize.id}" aria-label="删除 ${escapeHtml(displayName(prize))}">×</button>
          </div>`;
      })
      .join("");
  }

  function refreshConfigComputed() {
    const pool = activePool();
    const activeIds = new Set(pool.map((item) => item.prize.id));
    const activeWeight = pool.reduce((sum, item) => sum + item.prize.weight, 0);
    const allWeight = state.prizes.reduce((sum, prize) => sum + prize.weight, 0);
    const stock = state.prizes.reduce((sum, prize) => sum + prize.stock, 0);

    const totalElement = document.querySelector("#totalWeight");
    if (totalElement) totalElement.textContent = allWeight.toLocaleString("zh-CN");
    state.prizes.forEach((prize) => {
      const element = document.querySelector(`[data-probability="${CSS.escape(prize.id)}"]`);
      if (!element) return;
      element.textContent =
        activeIds.has(prize.id) && activeWeight > 0
          ? `${((prize.weight / activeWeight) * 100).toFixed(1)}%`
          : "—";
    });

    setText("#summaryMode", "前台可切换");
    setText("#summaryPrizeCount", `${state.prizes.length} 项`);
    setText("#summaryActiveCount", `${pool.length} 项`);
    setText("#summaryStock", `${stock} 份`);
    setText("#summaryHistory", `${state.historyCount.toLocaleString("zh-CN")} 次`);
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  }

  function deletePrize(id) {
    if (state.prizes.length <= MIN_PRIZES) {
      showToast(`至少保留 ${MIN_PRIZES} 个奖品`);
      return;
    }
    state.prizes = state.prizes.filter((prize) => prize.id !== id);
    markConfigDirty();
    renderPrizeEditor();
    refreshConfigComputed();
  }

  function choosePrizeImage(id) {
    const prize = state.prizes.find((item) => item.id === id);
    if (!prize) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.addEventListener(
      "change",
      async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          showToast("请选择 8MB 以内的图片");
          return;
        }
        try {
          const resized = await resizeImage(file);
          prize.image = resized;
          markConfigDirty();
          renderPrizeEditor();
          refreshConfigComputed();
          showToast("奖品图片已更新，请保存到 D1");
        } catch {
          showToast("图片读取失败，请换一张图片重试");
        }
      },
      { once: true }
    );
    input.click();
  }

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const maxSide = 220;
          const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.fillStyle = "#FFFFFF";
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/webp", 0.82));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function runSimulation() {
    const pool = activePool();
    if (!pool.length || totalActiveWeight() <= 0) {
      showToast("当前没有可模拟的有效奖品");
      return;
    }
    const iterations = safeNumber(document.querySelector("#simulationCount").value, 1000);
    const counts = state.prizes.map(() => 0);
    for (let index = 0; index < iterations; index += 1) {
      const selected = weightedPick(pool);
      if (selected >= 0) counts[selected] += 1;
    }
    const maxCount = Math.max(...counts, 1);
    const activeIds = new Set(pool.map((item) => item.prize.id));
    const results = document.querySelector("#simulationResults");
    results.innerHTML = state.prizes
      .map((prize, index) => {
        const active = activeIds.has(prize.id);
        const percent = active ? (counts[index] / iterations) * 100 : 0;
        const width = active ? (counts[index] / maxCount) * 100 : 0;
        return `
          <div class="sim-row">
            <div class="sim-meta">
              <b>${escapeHtml(displayName(prize))}</b>
              <span>${active ? `${counts[index].toLocaleString("zh-CN")} · ${percent.toFixed(1)}%` : "未进入奖池"}</span>
            </div>
            <div class="sim-track"><i data-width="${width.toFixed(1)}"></i></div>
          </div>`;
      })
      .join("");

    requestAnimationFrame(() => {
      results.querySelectorAll("[data-width]").forEach((bar) => {
        bar.style.width = `${bar.dataset.width}%`;
      });
    });
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  function launchConfetti() {
    const canvas = document.querySelector("#confettiCanvas");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const colors = ["#00A651", "#007F3E", "#E6B85C", "#D4A338", "#F7E4AC", "#FFFFFF"];
    let pieces = Array.from({ length: 150 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * Math.min(360, innerWidth * 0.45),
      y: innerHeight * 0.36,
      vx: (Math.random() - 0.5) * 12,
      vy: -5 - Math.random() * 11,
      gravity: 0.22 + Math.random() * 0.12,
      size: 4 + Math.random() * 7,
      rotation: Math.random() * TAU,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 110 + Math.random() * 70,
    }));

    cancelAnimationFrame(confettiFrame);
    function animate() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      pieces = pieces.filter((piece) => piece.life > 0 && piece.y < innerHeight + 30);
      pieces.forEach((piece) => {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.vy += piece.gravity;
        piece.vx *= 0.99;
        piece.rotation += piece.rotationSpeed;
        piece.life -= 1;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.globalAlpha = Math.min(1, piece.life / 35);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * 0.66);
        context.restore();
      });
      if (pieces.length) confettiFrame = requestAnimationFrame(animate);
      else context.clearRect(0, 0, canvas.width, canvas.height);
    }
    confettiFrame = requestAnimationFrame(animate);
  }

  function mountAdminConfig(root) {
    if (!root) return false;
    state = createDefaultState();
    root.innerHTML = configTemplate();
    root.querySelectorAll("button, input, select").forEach((control) => {
      control.disabled = true;
    });
    void loadAdminConfig(root);
    return true;
  }

  async function loadAdminConfig(root) {
    try {
      const response = await fetch("/api/admin/config", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 401) {
        location.reload();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyRemoteState(await response.json());
      configDirty = false;
      initConfigView({
        onSaveAndReturn: () => {
          location.href = routeHref("draw");
        },
      });
      root.querySelectorAll("button, input, select").forEach((control) => {
        control.disabled = false;
      });
      const time = state.updatedAt
        ? new Date(state.updatedAt).toLocaleString("zh-CN", { hour12: false })
        : "刚刚";
      setConfigStatus(`已从 D1 载入 · ${time}`);
    } catch (error) {
      console.error(error);
      setConfigStatus("D1 配置载入失败，请刷新页面重试");
      showToast("无法读取 D1 抽奖配置");
      root.querySelector(".admin-config-section")?.classList.add("has-error");
    }
  }

  globalThis.WeilihuaLotteryConfig = Object.freeze({
    mount: mountAdminConfig,
  });

  if (app) {
    addEventListener("popstate", renderRoute);
  }
  addEventListener("beforeunload", (event) => {
    if (!configDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (app) renderRoute();
})();
