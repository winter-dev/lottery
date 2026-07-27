(() => {
  "use strict";

  const PAGE_SIZE = 50;
  const tableBody = document.querySelector("#recordRows");
  const emptyState = document.querySelector("#recordEmpty");
  const pageInfo = document.querySelector("#pageInfo");
  const previousButton = document.querySelector("#previousPage");
  const nextButton = document.querySelector("#nextPage");
  let currentPage = 1;
  let totalPages = 1;
  let currentRecords = [];
  let toastTimer = 0;
  let recordsLoaded = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(timestamp) {
    return new Date(Number(timestamp)).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
  }

  function dateBoundary(value, endOfDay) {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return String(date.getTime());
  }

  function buildQuery() {
    const params = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(PAGE_SIZE),
    });
    const query = document.querySelector("#filterQuery").value.trim();
    const mode = document.querySelector("#filterMode").value;
    const from = dateBoundary(document.querySelector("#filterFrom").value, false);
    const to = dateBoundary(document.querySelector("#filterTo").value, true);
    if (query) params.set("q", query);
    if (mode) params.set("mode", mode);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }

  async function loadRecords({ announce = false } = {}) {
    const refreshButton = document.querySelector("#refreshRecords");
    refreshButton.disabled = true;
    refreshButton.textContent = "载入中…";
    document.querySelector("#recordsMeta").textContent = "正在读取数据...";

    try {
      const response = await fetch(`/api/admin/draws?${buildQuery()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 401) {
        location.reload();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      currentRecords = Array.isArray(data.records) ? data.records : [];
      totalPages = Math.max(1, Number(data.pagination?.totalPages) || 1);
      currentPage = Math.min(currentPage, totalPages);
      renderRecords(data);
      if (announce) showToast("抽奖记录已刷新");
    } catch (error) {
      console.error(error);
      document.querySelector("#recordsMeta").textContent = "数据载入失败，请稍后重试";
      showToast("无法读取 D1 数据");
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "刷新数据";
    }
  }

  function renderRecords(data) {
    const stats = data.stats || {};
    document.querySelector("#statTotal").textContent = Number(stats.total || 0).toLocaleString("zh-CN");
    document.querySelector("#statToday").textContent = Number(stats.today || 0).toLocaleString("zh-CN");
    document.querySelector("#statPrizes").textContent = Number(stats.uniquePrizes || 0).toLocaleString("zh-CN");
    document.querySelector("#statStock").textContent = Number(stats.stockMode || 0).toLocaleString("zh-CN");

    const total = Number(data.pagination?.total || 0);
    document.querySelector("#recordsMeta").textContent =
      `共 ${total.toLocaleString("zh-CN")} 条 · 每页 ${PAGE_SIZE} 条`;
    pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页`;
    previousButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages;
    emptyState.hidden = currentRecords.length > 0;

    tableBody.innerHTML = currentRecords
      .map((record) => `
        <tr>
          <td data-label="奖品">
            <span class="admin-prize-icon">${escapeHtml(record.prize_emoji || "🎁")}</span>
            <b>${escapeHtml(record.prize_name)}</b>
          </td>
          <td data-label="模式"><span class="mode-badge ${record.draw_mode === "stock" ? "stock" : ""}">${record.draw_mode === "stock" ? "库存" : "无限"}</span></td>
          <td data-label="抽奖序号">#${Number(record.draw_no)}</td>
          <td data-label="权重">${Number(record.weight)}</td>
          <td data-label="抽后库存">${record.draw_mode === "stock" ? Number(record.stock_after) : "—"}</td>
          <td data-label="中奖时间">${escapeHtml(formatDate(record.drawn_at))}</td>
          <td data-label="记录 ID"><code title="${escapeHtml(record.id)}">${escapeHtml(String(record.id).slice(0, 8))}</code></td>
        </tr>`)
      .join("");
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    if (!currentRecords.length) {
      showToast("当前页没有可导出的记录");
      return;
    }
    const header = ["奖品", "模式", "抽奖序号", "权重", "抽后库存", "中奖时间", "记录ID"];
    const rows = currentRecords.map((record) => [
      record.prize_name,
      record.draw_mode === "stock" ? "库存模式" : "无限模式",
      record.draw_no,
      record.weight,
      record.draw_mode === "stock" ? record.stock_after : "",
      formatDate(record.drawn_at),
      record.id,
    ]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `威利华木抽奖记录-${new Date().toISOString().slice(0, 10)}-第${currentPage}页.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function activePanelFromHash() {
    return location.hash === "#records" ? "records" : "config";
  }

  function showAdminPanel(panelName, { updateHash = false } = {}) {
    const selected = panelName === "records" ? "records" : "config";
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.adminPanel !== selected;
    });
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      const active = button.dataset.adminTab === selected;
      button.setAttribute("aria-selected", String(active));
      button.classList.toggle("is-active", active);
    });
    if (updateHash) history.replaceState(null, "", `#${selected}`);
    if (selected === "records" && !recordsLoaded) {
      recordsLoaded = true;
      void loadRecords();
    }
  }

  document.querySelector("#recordFilters").addEventListener("submit", (event) => {
    event.preventDefault();
    currentPage = 1;
    void loadRecords();
  });

  document.querySelector("#resetFilters").addEventListener("click", () => {
    document.querySelector("#recordFilters").reset();
    currentPage = 1;
    void loadRecords();
  });

  document.querySelector("#refreshRecords").addEventListener("click", () => {
    void loadRecords({ announce: true });
  });

  previousButton.addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    void loadRecords();
  });

  nextButton.addEventListener("click", () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    void loadRecords();
  });

  document.querySelector("#exportCsv").addEventListener("click", exportCsv);
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      showAdminPanel(button.dataset.adminTab, { updateHash: true });
    });
  });
  addEventListener("hashchange", () => {
    showAdminPanel(activePanelFromHash());
  });

  const configRoot = document.querySelector("#configMount");
  if (!globalThis.WeilihuaLotteryConfig?.mount(configRoot)) {
    configRoot.innerHTML =
      '<div class="surface admin-config-error">配置模块载入失败，请刷新页面重试。</div>';
  }
  showAdminPanel(activePanelFromHash(), { updateHash: !location.hash });
})();
