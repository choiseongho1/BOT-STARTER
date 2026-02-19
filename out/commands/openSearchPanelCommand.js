"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOpenSearchPanelCommand = runOpenSearchPanelCommand;
const vscode = __importStar(require("vscode"));
const workspaceTarget_1 = require("../utils/workspaceTarget");
const DEFAULT_PAGE_SIZE = 50;
const PRESET_LANGUAGES = ["py", "cpp", "js", "java", "kt", "go", "rs"];
let searchPanel;
// Rich panel UI alternative to QuickPick.
async function runOpenSearchPanelCommand(extensionUri, deps) {
    if (searchPanel) {
        searchPanel.reveal(vscode.ViewColumn.One);
        return;
    }
    const panel = vscode.window.createWebviewPanel("bojSearchPanel", "BOJ Search UI", vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
    });
    searchPanel = panel;
    panel.webview.html = getWebviewHtml(panel.webview);
    const latestProblemMap = new Map();
    const postRecents = async () => {
        const recents = deps.recentService.list();
        await panel.webview.postMessage({ type: "recents", recents });
    };
    const postDefaults = async () => {
        const config = vscode.workspace.getConfiguration("bojSearch");
        const defaultLanguages = config.get("languages", ["py", "cpp"]);
        await panel.webview.postMessage({
            type: "settings",
            defaultLanguages,
            presetLanguages: PRESET_LANGUAGES
        });
    };
    panel.onDidDispose(() => {
        searchPanel = undefined;
    });
    panel.webview.onDidReceiveMessage(async (rawMessage) => {
        const message = asPanelMessage(rawMessage);
        if (!message) {
            return;
        }
        try {
            if (message.type === "ready") {
                await postDefaults();
                await postRecents();
                return;
            }
            if (message.type === "search") {
                const query = message.query.trim();
                if (!query) {
                    latestProblemMap.clear();
                    await panel.webview.postMessage({
                        type: "searchResult",
                        items: [],
                        total: 0,
                        tierCounts: {
                            unrated: 0,
                            bronze: 0,
                            silver: 0,
                            gold: 0,
                            platinum: 0,
                            diamond: 0,
                            ruby: 0,
                            master: 0
                        },
                        tierCountSum: 0,
                        page: 1,
                        hasPrev: false,
                        hasNext: false
                    });
                    await panel.webview.postMessage({ type: "status", text: "검색어를 입력해 주세요." });
                    return;
                }
                const result = await deps.problemSearchService.searchPaged(query, {
                    tierGroup: message.tierGroup,
                    page: message.page,
                    sort: message.sort,
                    direction: message.direction
                });
                const tierCountResult = await deps.problemSearchService.getTierCounts(query, message.tierGroup, result.total);
                latestProblemMap.clear();
                for (const item of result.items) {
                    latestProblemMap.set(item.problemId, item);
                }
                const hasPrev = result.page > 1;
                const hasNext = result.page * DEFAULT_PAGE_SIZE < result.total;
                await panel.webview.postMessage({
                    type: "searchResult",
                    items: result.items,
                    total: result.total,
                    tierCounts: tierCountResult.counts,
                    tierCountSum: tierCountResult.sum,
                    page: result.page,
                    hasPrev,
                    hasNext
                });
                const mismatch = tierCountResult.sum !== result.total;
                await panel.webview.postMessage({
                    type: "status",
                    text: mismatch
                        ? `총 ${result.total}개 · 랭크 합계 ${tierCountResult.sum}개 (불일치)`
                        : `총 ${result.total}개 · 랭크 합계 ${tierCountResult.sum}개 · ${result.page}페이지 · 현재 ${result.items.length}개`
                });
                return;
            }
            if (message.type === "openWeb") {
                await vscode.env.openExternal(vscode.Uri.parse(`https://www.acmicpc.net/problem/${message.problemId}`));
                return;
            }
            const targetRootUri = await (0, workspaceTarget_1.pickTargetRootUri)();
            if (!targetRootUri) {
                return;
            }
            const selectedProblem = await resolveProblem(message.problemId, latestProblemMap, deps);
            if (!selectedProblem) {
                vscode.window.showErrorMessage("선택한 문제 정보를 찾지 못했습니다. 다시 검색해 주세요.");
                return;
            }
            const config = vscode.workspace.getConfiguration("bojSearch");
            const configLanguages = config.get("languages", ["py", "cpp"]);
            const outputDir = config.get("outputDir", ".");
            const openWebOnSelect = config.get("openWebOnSelect", true);
            const requestedLanguages = normalizeLanguages(message.languages);
            const languages = requestedLanguages.length > 0 ? requestedLanguages : configLanguages;
            if (openWebOnSelect) {
                await vscode.env.openExternal(vscode.Uri.parse(`https://www.acmicpc.net/problem/${selectedProblem.problemId}`));
            }
            const scaffoldResult = await deps.scaffoldService.scaffold(targetRootUri, outputDir, selectedProblem, languages);
            await deps.recentService.add(selectedProblem);
            await postRecents();
            if (scaffoldResult.created.length > 0) {
                const doc = await vscode.workspace.openTextDocument(scaffoldResult.created[0]);
                await vscode.window.showTextDocument(doc);
            }
            await panel.webview.postMessage({
                type: "status",
                text: `생성 ${scaffoldResult.created.length}개, 기존 파일 ${scaffoldResult.skipped.length}개 · 언어 ${languages.join(", ")}`
            });
        }
        catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            await panel.webview.postMessage({ type: "error", text: messageText });
            vscode.window.showErrorMessage(`BOJ UI 처리 중 오류: ${messageText}`);
        }
    });
}
async function resolveProblem(problemId, latestProblemMap, deps) {
    const inMemory = latestProblemMap.get(problemId);
    if (inMemory) {
        return inMemory;
    }
    const recent = deps.recentService.list().find((item) => item.problemId === problemId);
    if (recent) {
        return recent;
    }
    const fetched = await deps.problemSearchService.search(`${problemId}`, "all");
    return fetched.find((item) => item.problemId === problemId);
}
function normalizeLanguages(languages) {
    return Array.from(new Set(languages
        .map((language) => language.trim().toLowerCase())
        .filter((language) => /^[a-z0-9]+$/.test(language))));
}
function asPanelMessage(rawMessage) {
    if (!rawMessage || typeof rawMessage !== "object") {
        return undefined;
    }
    const maybeMessage = rawMessage;
    const type = maybeMessage.type;
    if (typeof type !== "string") {
        return undefined;
    }
    if (type === "ready") {
        return { type: "ready" };
    }
    if (type === "search") {
        const query = typeof maybeMessage.query === "string" ? maybeMessage.query : "";
        const tierGroup = isTierGroup(maybeMessage.tierGroup) ? maybeMessage.tierGroup : "all";
        const page = normalizePositiveInt(maybeMessage.page, 1);
        const sort = isProblemSortKey(maybeMessage.sort) ? maybeMessage.sort : "id";
        const direction = isSortDirection(maybeMessage.direction) ? maybeMessage.direction : "asc";
        return { type: "search", query, tierGroup, page, sort, direction };
    }
    if (type === "openWeb" || type === "openAndScaffold") {
        const problemId = typeof maybeMessage.problemId === "number"
            ? maybeMessage.problemId
            : Number(maybeMessage.problemId);
        if (!Number.isInteger(problemId) || problemId <= 0) {
            return undefined;
        }
        if (type === "openWeb") {
            return { type: "openWeb", problemId };
        }
        const languages = Array.isArray(maybeMessage.languages)
            ? maybeMessage.languages.filter((language) => typeof language === "string")
            : [];
        return { type: "openAndScaffold", problemId, languages };
    }
    return undefined;
}
function normalizePositiveInt(value, fallback) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}
function isTierGroup(value) {
    return (value === "all" ||
        value === "unrated" ||
        value === "bronze" ||
        value === "silver" ||
        value === "gold" ||
        value === "platinum" ||
        value === "diamond" ||
        value === "ruby" ||
        value === "master");
}
function isProblemSortKey(value) {
    return value === "id" || value === "level" || value === "solved";
}
function isSortDirection(value) {
    return value === "asc" || value === "desc";
}
function getWebviewHtml(webview) {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>BOJ Search UI</title>
  <style>
    :root {
      --bg: #121924;
      --panel: #1d2735;
      --panel-soft: #202d3f;
      --line: #31445d;
      --text: #e7edf8;
      --muted: #a7b8cf;
      --accent: #5eb0ff;
      --good: #56c9a3;
      --warn: #ff7d91;
      --unrated: #7e8aa1;
      --bronze: #c08b58;
      --silver: #9eb0cc;
      --gold: #e2c35b;
      --platinum: #5cc7b8;
      --diamond: #76c6ff;
      --ruby: #e6809b;
      --master: #f0f0f0;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: radial-gradient(circle at top left, #23324d, #121924 55%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
    }

    .wrap {
      max-width: 1040px;
      margin: 0 auto;
      padding: 16px;
      display: grid;
      gap: 12px;
    }

    .hero {
      background: linear-gradient(130deg, #1e2b43, #31507a);
      border: 1px solid #4a6992;
      border-radius: 14px;
      padding: 16px;
    }

    .hero h1 {
      margin: 0 0 6px;
      font-size: 20px;
      letter-spacing: 0.2px;
    }

    .hero p {
      margin: 0;
      font-size: 13px;
      color: #dbe7fb;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
    }

    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    input[type="text"],
    select {
      background: #101722;
      border: 1px solid #354861;
      color: var(--text);
      border-radius: 8px;
      padding: 8px 10px;
    }

    #queryInput {
      flex: 1;
      min-width: 240px;
    }

    button {
      border: 1px solid #435a77;
      background: #233650;
      color: var(--text);
      border-radius: 8px;
      padding: 7px 12px;
      cursor: pointer;
      font-weight: 600;
    }

    button:hover { filter: brightness(1.08); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }

    .search-btn { background: #2f5a8f; border-color: #4b75aa; }

    .tier {
      background: #1b2432;
      border-color: #3a4455;
      padding: 6px 10px;
      font-size: 12px;
    }

    .tier[data-active="true"] { outline: 2px solid var(--accent); }
    .tier-unrated[data-active="true"] { outline-color: var(--unrated); }
    .tier-bronze[data-active="true"] { outline-color: var(--bronze); }
    .tier-silver[data-active="true"] { outline-color: var(--silver); }
    .tier-gold[data-active="true"] { outline-color: var(--gold); }
    .tier-platinum[data-active="true"] { outline-color: var(--platinum); }
    .tier-diamond[data-active="true"] { outline-color: var(--diamond); }
    .tier-ruby[data-active="true"] { outline-color: var(--ruby); }
    .tier-master[data-active="true"] { outline-color: var(--master); }

    .status {
      margin-top: 8px;
      min-height: 18px;
      color: var(--muted);
      font-size: 12px;
    }

    .status.error { color: var(--warn); }

    .section-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .section-title h2 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0.2px;
    }

    .list {
      display: grid;
      gap: 8px;
    }

    .item {
      background: var(--panel-soft);
      border: 1px solid #3a4d68;
      border-radius: 10px;
      padding: 10px;
      display: grid;
      gap: 8px;
    }

    .top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .id {
      font-weight: 700;
      color: #89c0ff;
    }

    .title {
      font-weight: 600;
      flex: 1;
      min-width: 180px;
    }

    .meta,
    .tags,
    .small {
      color: var(--muted);
      font-size: 12px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .open-btn { background: #2b4d78; border-color: #4673a4; }
    .scaffold-btn { background: #2d6359; border-color: #47887d; }

    .lang-box {
      display: grid;
      gap: 6px;
      margin-top: 8px;
      padding: 8px;
      border: 1px dashed #41556f;
      border-radius: 8px;
    }

    .lang-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 10px;
      font-size: 12px;
    }

    .lang-list label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    #customLang {
      width: 100%;
    }

    .pager {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid #3d526c;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      color: var(--muted);
    }

    .rank-grid {
      margin-top: 8px;
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    }

    .rank-cell {
      border: 1px solid #3a4b64;
      border-radius: 8px;
      padding: 7px 8px;
      background: #1b2534;
    }

    .rank-name {
      font-size: 11px;
      color: #c6d4ec;
    }

    .rank-count {
      margin-top: 2px;
      font-size: 14px;
      font-weight: 700;
      color: #f1f6ff;
    }

    @media (max-width: 700px) {
      .actions button { width: 100%; }
      #queryInput { min-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>BOJ Search UI</h1>
      <p>페이지네이션/정렬/티어 필터로 찾고, 원하는 개발 언어를 선택해 바로 파일을 생성합니다.</p>
    </section>

    <section class="panel">
      <div class="row">
        <input id="queryInput" type="text" placeholder="예: 1000, A+B, #dp, id:1000..1099" />
        <button id="searchBtn" class="search-btn">검색</button>
      </div>

      <div class="row" style="margin-top: 8px;">
        <button class="tier" data-tier="all" data-active="true">ALL</button>
        <button class="tier tier-unrated" data-tier="unrated" data-active="false">UNRATED</button>
        <button class="tier tier-bronze" data-tier="bronze" data-active="false">BRONZE</button>
        <button class="tier tier-silver" data-tier="silver" data-active="false">SILVER</button>
        <button class="tier tier-gold" data-tier="gold" data-active="false">GOLD</button>
        <button class="tier tier-platinum" data-tier="platinum" data-active="false">PLATINUM</button>
        <button class="tier tier-diamond" data-tier="diamond" data-active="false">DIAMOND</button>
        <button class="tier tier-ruby" data-tier="ruby" data-active="false">RUBY</button>
        <button class="tier tier-master" data-tier="master" data-active="false">MASTER</button>

        <span class="badge">정렬</span>
        <select id="sortSelect">
          <option value="id">문제 번호</option>
          <option value="level">난이도</option>
          <option value="solved">푼 사람 수</option>
        </select>
        <select id="directionSelect">
          <option value="asc">오름차순</option>
          <option value="desc">내림차순</option>
        </select>
      </div>

      <div class="lang-box">
        <div class="small">생성할 개발 언어 선택 (체크 + 커스텀)</div>
        <div id="languagePreset" class="lang-list"></div>
        <input id="customLang" type="text" placeholder="추가 확장자 (예: c, cs, swift)" />
      </div>

      <div id="status" class="status"></div>
      <div class="pager">
        <button id="prevBtn">이전</button>
        <span id="pageLabel" class="small">페이지 1</span>
        <button id="nextBtn">다음</button>
      </div>

      <div class="rank-grid" id="rankGrid"></div>
      <div id="rankSumLabel" class="small" style="margin-top: 6px;">랭크 합계 0개</div>
    </section>

    <section class="panel">
      <div class="section-title">
        <h2>Search Results</h2>
        <span id="totalLabel" class="small">총 0개</span>
      </div>
      <div id="results" class="list"></div>
    </section>

    <section class="panel">
      <div class="section-title">
        <h2>Recent</h2>
      </div>
      <div id="recents" class="list"></div>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const queryInput = document.getElementById('queryInput');
    const searchBtn = document.getElementById('searchBtn');
    const sortSelect = document.getElementById('sortSelect');
    const directionSelect = document.getElementById('directionSelect');
    const statusEl = document.getElementById('status');
    const resultsEl = document.getElementById('results');
    const recentsEl = document.getElementById('recents');
    const tierButtons = Array.from(document.querySelectorAll('.tier'));
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const pageLabel = document.getElementById('pageLabel');
    const totalLabel = document.getElementById('totalLabel');
    const rankGrid = document.getElementById('rankGrid');
    const rankSumLabel = document.getElementById('rankSumLabel');
    const languagePreset = document.getElementById('languagePreset');
    const customLang = document.getElementById('customLang');

    const rankOrder = ['unrated', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ruby', 'master'];
    const rankLabels = {
      unrated: 'Unrated',
      bronze: 'Bronze',
      silver: 'Silver',
      gold: 'Gold',
      platinum: 'Platinum',
      diamond: 'Diamond',
      ruby: 'Ruby',
      master: 'Master'
    };

    let selectedTier = 'all';
    let currentPage = 1;
    let hasPrev = false;
    let hasNext = false;
    let debounceTimer = undefined;

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function setStatus(text, isError) {
      statusEl.textContent = text || '';
      statusEl.className = isError ? 'status error' : 'status';
    }

    function updatePager() {
      pageLabel.textContent = '페이지 ' + currentPage;
      prevBtn.disabled = !hasPrev;
      nextBtn.disabled = !hasNext;
    }

    function renderRankCounts(counts, total) {
      const source = counts && typeof counts === 'object' ? counts : {};
      let sum = 0;

      const cards = rankOrder.map((rankKey) => {
        const count = Number(source[rankKey] || 0);
        sum += count;

        return '<div class="rank-cell">'
          + '<div class="rank-name">' + escapeHtml(rankLabels[rankKey]) + '</div>'
          + '<div class="rank-count">' + escapeHtml(count) + '</div>'
          + '</div>';
      });

      rankGrid.innerHTML = cards.join('');

      const mismatch = sum !== Number(total || 0);
      rankSumLabel.textContent = mismatch
        ? '랭크 합계 ' + sum + '개 / 총 ' + Number(total || 0) + '개 (불일치)'
        : '랭크 합계 ' + sum + '개 / 총 ' + Number(total || 0) + '개';
      rankSumLabel.style.color = mismatch ? '#ff7d91' : '';
    }

    function getSelectedLanguages() {
      const checked = Array.from(document.querySelectorAll('input[data-language]:checked'))
        .map((input) => input.getAttribute('data-language') || '')
        .filter((value) => value);

      const custom = customLang.value
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-z0-9]+$/.test(value));

      return Array.from(new Set([...checked, ...custom]));
    }

    function sendSearch(page) {
      const query = queryInput.value.trim();
      currentPage = page;
      vscode.postMessage({
        type: 'search',
        query,
        tierGroup: selectedTier,
        page: currentPage,
        sort: sortSelect.value,
        direction: directionSelect.value
      });
      updatePager();
    }

    function debounceSearchToFirstPage() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => sendSearch(1), 250);
    }

    function renderItem(problem) {
      const tags = Array.isArray(problem.tags) ? problem.tags.slice(0, 6).join(', ') : '';
      return '<div class="item">'
        + '<div class="top">'
        + '<div class="id">#' + escapeHtml(problem.problemId) + '</div>'
        + '<div class="title">' + escapeHtml(problem.title) + '</div>'
        + '<div class="meta">' + escapeHtml(problem.tierText) + '</div>'
        + '</div>'
        + '<div class="tags">' + escapeHtml(tags || '-') + '</div>'
        + '<div class="actions">'
        + '<button class="open-btn" data-action="open" data-problem-id="' + escapeHtml(problem.problemId) + '">문제 웹 열기</button>'
        + '<button class="scaffold-btn" data-action="scaffold" data-problem-id="' + escapeHtml(problem.problemId) + '">웹 열기 + 파일 생성</button>'
        + '</div>'
        + '</div>';
    }

    function renderList(container, items, emptyText) {
      if (!items || items.length === 0) {
        container.innerHTML = '<div class="item"><div class="small">' + escapeHtml(emptyText) + '</div></div>';
        return;
      }

      container.innerHTML = items.map(renderItem).join('');
    }

    function handleActionClick(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest('button[data-action]');
      if (!button) {
        return;
      }

      const action = button.getAttribute('data-action');
      const problemId = Number(button.getAttribute('data-problem-id'));
      if (!Number.isInteger(problemId) || problemId <= 0) {
        return;
      }

      if (action === 'open') {
        vscode.postMessage({ type: 'openWeb', problemId });
        return;
      }

      const languages = getSelectedLanguages();
      vscode.postMessage({ type: 'openAndScaffold', problemId, languages });
    }

    function renderLanguagePreset(presetLanguages, defaultLanguages) {
      const defaultSet = new Set(defaultLanguages || []);
      languagePreset.innerHTML = presetLanguages
        .map((language) => {
          const checked = defaultSet.has(language) ? 'checked' : '';
          return '<label><input type="checkbox" data-language="' + escapeHtml(language) + '" ' + checked + ' /> .' + escapeHtml(language) + '</label>';
        })
        .join('');

      const customDefaults = (defaultLanguages || []).filter((language) => !presetLanguages.includes(language));
      if (customDefaults.length > 0) {
        customLang.value = customDefaults.join(',');
      }
    }

    searchBtn.addEventListener('click', () => sendSearch(1));
    queryInput.addEventListener('input', debounceSearchToFirstPage);
    queryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        sendSearch(1);
      }
    });

    sortSelect.addEventListener('change', () => sendSearch(1));
    directionSelect.addEventListener('change', () => sendSearch(1));

    prevBtn.addEventListener('click', () => {
      if (hasPrev) {
        sendSearch(currentPage - 1);
      }
    });

    nextBtn.addEventListener('click', () => {
      if (hasNext) {
        sendSearch(currentPage + 1);
      }
    });

    tierButtons.forEach((button) => {
      button.addEventListener('click', () => {
        selectedTier = button.getAttribute('data-tier') || 'all';
        tierButtons.forEach((item) => {
          item.setAttribute('data-active', item === button ? 'true' : 'false');
        });
        sendSearch(1);
      });
    });

    resultsEl.addEventListener('click', handleActionClick);
    recentsEl.addEventListener('click', handleActionClick);

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'settings') {
        const presetLanguages = Array.isArray(message.presetLanguages) ? message.presetLanguages : [];
        const defaultLanguages = Array.isArray(message.defaultLanguages) ? message.defaultLanguages : [];
        renderLanguagePreset(presetLanguages, defaultLanguages);
        return;
      }

      if (message.type === 'searchResult') {
        const items = Array.isArray(message.items) ? message.items : [];
        renderList(resultsEl, items, '검색 결과가 없습니다.');
        totalLabel.textContent = '총 ' + Number(message.total || 0) + '개';
        renderRankCounts(message.tierCounts, message.total);
        currentPage = Number(message.page || 1);
        hasPrev = Boolean(message.hasPrev);
        hasNext = Boolean(message.hasNext);
        updatePager();
        return;
      }

      if (message.type === 'recents') {
        const recents = Array.isArray(message.recents) ? message.recents : [];
        renderList(recentsEl, recents, '최근 기록이 없습니다.');
        return;
      }

      if (message.type === 'status') {
        setStatus(message.text || '', false);
        return;
      }

      if (message.type === 'error') {
        setStatus(message.text || '오류가 발생했습니다.', true);
      }
    });

    renderList(resultsEl, [], '검색어를 입력해 주세요.');
    renderList(recentsEl, [], '최근 기록이 없습니다.');
    renderRankCounts({}, 0);
    updatePager();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
function getNonce() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let i = 0; i < 16; i += 1) {
        value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return value;
}
//# sourceMappingURL=openSearchPanelCommand.js.map