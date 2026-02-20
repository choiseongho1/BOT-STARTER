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
exports.BojSidebarViewProvider = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const workspaceTarget_1 = require("../utils/workspaceTarget");
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_LANGUAGE = "py";
class BojSidebarViewProvider {
    deps;
    static viewType = "boj.sidebar";
    view;
    latestProblemMap = new Map();
    currentProblemId;
    constructor(deps) {
        this.deps = deps;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.deps.extensionUri]
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (rawMessage) => {
            const message = this.parseMessage(rawMessage);
            if (!message) {
                return;
            }
            try {
                if (message.type === "ready") {
                    await this.postSettings();
                    await this.postRecents();
                    await this.autoLoadCurrentProblemFromEditor();
                    return;
                }
                if (message.type === "openSettings") {
                    await vscode.commands.executeCommand("workbench.action.openSettings", "bojSearch");
                    return;
                }
                if (message.type === "clearRecent") {
                    await this.deps.recentService.clear();
                    await this.postRecents();
                    await this.postStatus("최근 기록을 비웠습니다.");
                    return;
                }
                if (message.type === "search") {
                    await this.handleSearch(message);
                    return;
                }
                if (message.type === "loadResult" || message.type === "loadRecent") {
                    await this.loadProblemPanel(message.problemId, true);
                    return;
                }
                if (message.type === "openResult" || message.type === "openRecent") {
                    await this.openProblemWeb(message.problemId);
                    return;
                }
                if (message.type === "createResult") {
                    const selected = await this.resolveProblemFromSearch(message.problemId);
                    if (!selected) {
                        await this.postError("검색 결과에서 문제를 찾지 못했습니다. 다시 검색해 주세요.");
                        return;
                    }
                    await this.createProblem(selected);
                    await this.loadProblemPanel(selected.problemId, true);
                    return;
                }
                if (message.type === "createRecent") {
                    const recent = this.deps.recentService
                        .list()
                        .find((item) => item.problemId === message.problemId);
                    if (!recent) {
                        await this.postError("최근 목록에서 문제를 찾지 못했습니다.");
                        return;
                    }
                    await this.createProblem(recent);
                    await this.loadProblemPanel(recent.problemId, true);
                }
            }
            catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                await this.postError(messageText);
            }
        });
        webviewView.onDidChangeVisibility(() => {
            if (!webviewView.visible) {
                return;
            }
            void this.autoLoadCurrentProblemFromEditor();
        });
    }
    async autoLoadCurrentProblemFromEditor() {
        const problemId = this.detectProblemIdFromActiveEditor();
        if (!problemId || problemId === this.currentProblemId) {
            return;
        }
        await this.loadProblemPanel(problemId, false);
    }
    detectProblemIdFromActiveEditor() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }
        const filePath = editor.document.fileName;
        const basenameWithoutExtension = path.basename(filePath, path.extname(filePath));
        const basenameWithExtension = path.basename(filePath);
        const directorySegments = filePath.split(/[\\/]/).filter(Boolean).reverse();
        const candidates = [basenameWithoutExtension, basenameWithExtension, ...directorySegments];
        for (const candidate of candidates) {
            const exact = candidate.match(/^(\d+)$/);
            if (exact) {
                return Number(exact[1]);
            }
            const prefixed = candidate.match(/^(\d+)\s*번?/);
            if (prefixed) {
                return Number(prefixed[1]);
            }
            const inside = candidate.match(/(\d{3,})/);
            if (inside) {
                return Number(inside[1]);
            }
        }
        return undefined;
    }
    async loadProblemPanel(problemId, reveal) {
        this.currentProblemId = problemId;
        await this.deps.showProblemPanel(problemId, reveal);
        await this.postStatus(`문제 패널 로드: ${problemId}번`);
    }
    async handleSearch(message) {
        const query = message.query.trim();
        if (!query) {
            this.latestProblemMap.clear();
            await this.view?.webview.postMessage({
                type: "searchResult",
                items: [],
                total: 0,
                page: 1,
                hasPrev: false,
                hasNext: false
            });
            await this.postStatus("검색어를 입력해 주세요.");
            return;
        }
        const result = await this.deps.problemSearchService.searchPaged(query, {
            tierGroup: message.tierGroup,
            page: message.page,
            sort: message.sort,
            direction: message.direction
        });
        this.latestProblemMap.clear();
        for (const item of result.items) {
            this.latestProblemMap.set(item.problemId, item);
        }
        const hasPrev = result.page > 1;
        const hasNext = result.page * DEFAULT_PAGE_SIZE < result.total;
        await this.view?.webview.postMessage({
            type: "searchResult",
            items: result.items,
            total: result.total,
            page: result.page,
            hasPrev,
            hasNext
        });
        await this.postStatus(`총 ${result.total}개 · ${result.page}페이지 · 현재 ${result.items.length}개`);
    }
    async resolveProblemFromSearch(problemId) {
        const latest = this.latestProblemMap.get(problemId);
        if (latest) {
            return latest;
        }
        return this.findProblemById(problemId);
    }
    async findProblemById(problemId) {
        const items = await this.deps.problemSearchService.search(String(problemId), "all");
        return items.find((item) => item.problemId === problemId);
    }
    async openProblemWeb(problemId) {
        await vscode.env.openExternal(vscode.Uri.parse(`https://www.acmicpc.net/problem/${problemId}`));
    }
    async createProblem(problem) {
        const targetRootUri = await (0, workspaceTarget_1.pickTargetRootUri)();
        if (!targetRootUri) {
            return;
        }
        const config = vscode.workspace.getConfiguration("bojSearch");
        const configuredLanguage = this.resolveConfiguredLanguage(config);
        const outputDir = config.get("outputDir", ".");
        const openWebOnSelect = config.get("openWebOnSelect", true);
        if (openWebOnSelect) {
            await this.openProblemWeb(problem.problemId);
        }
        const scaffoldResult = await this.deps.scaffoldService.scaffold(targetRootUri, outputDir, problem, configuredLanguage);
        await this.deps.recentService.add(problem);
        await this.postRecents();
        if (scaffoldResult.created.length > 0) {
            const doc = await vscode.workspace.openTextDocument(scaffoldResult.created[0]);
            await vscode.window.showTextDocument(doc);
        }
        await this.postStatus(`BOJ ${problem.problemId}: 생성 ${scaffoldResult.created.length}개, 기존 ${scaffoldResult.skipped.length}개 · 언어 ${configuredLanguage}`);
    }
    async postSettings() {
        const config = vscode.workspace.getConfiguration("bojSearch");
        const defaultLanguage = this.resolveConfiguredLanguage(config);
        await this.view?.webview.postMessage({
            type: "settings",
            defaultLanguage
        });
    }
    resolveConfiguredLanguage(config) {
        const configured = config.get("defaultLanguage", DEFAULT_LANGUAGE);
        const trimmed = configured.trim().toLowerCase();
        if (/^[a-z0-9]+$/.test(trimmed)) {
            return trimmed;
        }
        return DEFAULT_LANGUAGE;
    }
    async postRecents() {
        await this.view?.webview.postMessage({ type: "recents", items: this.deps.recentService.list() });
    }
    async postStatus(text) {
        await this.view?.webview.postMessage({ type: "status", text });
    }
    async postError(text) {
        await this.view?.webview.postMessage({ type: "error", text });
        vscode.window.showErrorMessage(`BOJ: ${text}`);
    }
    parseMessage(rawMessage) {
        if (!rawMessage || typeof rawMessage !== "object") {
            return undefined;
        }
        const message = rawMessage;
        const type = message.type;
        if (typeof type !== "string") {
            return undefined;
        }
        if (type === "ready" || type === "clearRecent" || type === "openSettings") {
            return { type };
        }
        if (type === "search") {
            const query = typeof message.query === "string" ? message.query : "";
            const tierGroup = isTierGroup(message.tierGroup) ? message.tierGroup : "all";
            const page = normalizePositiveInt(message.page, 1);
            const sort = isProblemSortKey(message.sort) ? message.sort : "id";
            const direction = isSortDirection(message.direction) ? message.direction : "asc";
            return { type, query, tierGroup, page, sort, direction };
        }
        if (type === "openResult" ||
            type === "createResult" ||
            type === "loadResult" ||
            type === "openRecent" ||
            type === "createRecent" ||
            type === "loadRecent") {
            const problemId = typeof message.problemId === "number" ? message.problemId : Number(message.problemId);
            if (!Number.isInteger(problemId) || problemId <= 0) {
                return undefined;
            }
            return { type, problemId };
        }
        return undefined;
    }
    getHtml(webview) {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      min-height: 100vh;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    h1 {
      margin: 0;
      font-size: 16px;
      letter-spacing: 0.2px;
      line-height: 1.35;
    }

    .subtitle {
      margin-top: 6px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }

    .section {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 10px;
    }

    .section-search {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    .section-recent {
      flex: 0 0 auto;
    }

    .section-recent.collapsed #recentBody {
      display: none;
    }

    .recent-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .recent-header .section-title {
      margin: 0;
    }

    .collapse-toggle {
      width: auto;
      padding: 4px 10px;
      font-size: 11px;
      line-height: 1.5;
    }

    .section-title {
      margin: 0 0 8px;
      font-size: 12px;
      letter-spacing: 0.4px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
    }

    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

    input, select, button {
      border-radius: 8px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      color: var(--vscode-input-foreground, var(--vscode-editor-foreground));
      background: var(--vscode-input-background, var(--vscode-editor-background));
      padding: 7px 8px;
    }

    input, select { width: 100%; }

    button { cursor: pointer; font-weight: 600; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }

    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-border, var(--vscode-panel-border));
    }

    .primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .small { color: var(--vscode-descriptionForeground); font-size: 11px; }

    .meta-line {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
    }

    .badge-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      line-height: 1.5;
    }

    .pager { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    .list {
      display: grid;
      gap: 6px;
      margin-top: 6px;
      overflow: auto;
      padding-right: 2px;
      min-height: 0;
    }

    #resultList {
      flex: 1 1 auto;
      max-height: none;
      margin-top: 8px;
    }

    #recentList {
      max-height: 220px;
    }

    .item {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 7px;
      display: grid;
      gap: 6px;
    }

    .item-title { line-height: 1.35; color: var(--vscode-editor-foreground); }

    .title-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .title-row .item-title {
      flex: 1 1 auto;
      min-width: 0;
    }

    .rank-chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 10px;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .status {
      margin-top: 8px;
      min-height: 14px;
      color: var(--vscode-testing-iconPassed, #56c9a3);
      line-height: 1.3;
    }

    .status.error {
      color: var(--vscode-errorForeground, #ff7b90);
    }
  </style>
</head>
<body>
  <section class="section">
    <h1>BOJ-STARTER</h1>
    <div class="subtitle">좌측은 검색/생성 허브, 문제 상세/테스트케이스는 우측 탭 패널에서 엽니다.</div>
  </section>

  <section class="section section-search">
    <h2 class="section-title">문제 검색</h2>
    <div class="row">
      <input id="queryInput" placeholder="번호/제목/태그 (예: 1000, A+B, #dp)" />
      <button id="searchBtn" class="primary">검색</button>
    </div>

    <div class="row" style="margin-top: 6px;">
      <select id="tierSelect">
        <option value="all">ALL</option>
        <option value="unrated">UNRATED</option>
        <option value="bronze">BRONZE</option>
        <option value="silver">SILVER</option>
        <option value="gold">GOLD</option>
        <option value="platinum">PLATINUM</option>
        <option value="diamond">DIAMOND</option>
        <option value="ruby">RUBY</option>
        <option value="master">MASTER</option>
      </select>
      <select id="sortSelect">
        <option value="id">번호순</option>
        <option value="level">난이도순</option>
        <option value="solved">푼 사람순</option>
      </select>
      <select id="directionSelect">
        <option value="asc">오름차순</option>
        <option value="desc">내림차순</option>
        <option value="rankAsc">랭크 오름차순 (브론즈→마스터, 언랭크 마지막)</option>
        <option value="rankDesc">랭크 내림차순 (마스터→브론즈, 언랭크 마지막)</option>
      </select>
    </div>

    <div class="small" id="languageLabel" style="margin-top: 8px;">파일 생성 언어: .py</div>

    <div class="pager">
      <button id="prevBtn">이전</button>
      <div id="pageLabel" class="small">페이지 1</div>
      <button id="nextBtn">다음</button>
      <div id="totalLabel" class="small">총 0개</div>
    </div>

    <div id="resultList" class="list"></div>
    <div id="status" class="status"></div>
  </section>

  <section id="recentSection" class="section section-recent collapsed">
    <div class="recent-header">
      <h2 class="section-title">최근 문제</h2>
      <button id="toggleRecentBtn" class="collapse-toggle" aria-controls="recentBody" aria-expanded="false">펼치기</button>
    </div>
    <div id="recentBody">
      <div class="row" style="margin-top: 8px;">
        <button id="clearRecentBtn">최근 기록 비우기</button>
        <button id="openSettingsBtn">설정 열기</button>
      </div>
      <div id="recentList" class="list"></div>
    </div>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const queryInput = document.getElementById('queryInput');
    const searchBtn = document.getElementById('searchBtn');
    const tierSelect = document.getElementById('tierSelect');
    const sortSelect = document.getElementById('sortSelect');
    const directionSelect = document.getElementById('directionSelect');

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const pageLabel = document.getElementById('pageLabel');
    const totalLabel = document.getElementById('totalLabel');

    const resultList = document.getElementById('resultList');
    const recentList = document.getElementById('recentList');
    const recentSection = document.getElementById('recentSection');
    const recentBody = document.getElementById('recentBody');
    const toggleRecentBtn = document.getElementById('toggleRecentBtn');

    const languageLabel = document.getElementById('languageLabel');
    const clearRecentBtn = document.getElementById('clearRecentBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const statusEl = document.getElementById('status');

    const persisted = vscode.getState();
    let viewState = persisted && typeof persisted === 'object' ? persisted : {};

    let selectedTier = 'all';
    let currentPage = 1;
    let hasPrev = false;
    let hasNext = false;
    let debounceTimer = undefined;
    let isRecentCollapsed = typeof viewState.recentCollapsed === 'boolean' ? viewState.recentCollapsed : true;

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

    function renderLanguageLabel(language) {
      const normalized = String(language || '').trim().toLowerCase();
      const fallback = normalized || 'py';
      languageLabel.textContent = '파일 생성 언어: .' + fallback;
    }

    function setRecentCollapsed(collapsed) {
      isRecentCollapsed = Boolean(collapsed);
      recentSection.classList.toggle('collapsed', isRecentCollapsed);
      recentBody.hidden = isRecentCollapsed;
      toggleRecentBtn.textContent = isRecentCollapsed ? '펼치기' : '접기';
      toggleRecentBtn.setAttribute('aria-expanded', String(!isRecentCollapsed));
      viewState = { ...viewState, recentCollapsed: isRecentCollapsed };
      vscode.setState(viewState);
    }

    function renderTitleWithRank(problem) {
      const tier = String(problem && problem.tierText ? problem.tierText : 'Unrated');
      return '<div class="title-row">'
        + '<div class="item-title">#' + escapeHtml(problem.problemId) + ' · ' + escapeHtml(problem.title) + '</div>'
        + '<span class="rank-chip">' + escapeHtml(tier) + '</span>'
        + '</div>';
    }

    function sendSearch(page) {
      currentPage = page;
      vscode.postMessage({
        type: 'search',
        query: queryInput.value.trim(),
        tierGroup: selectedTier,
        page: currentPage,
        sort: sortSelect.value,
        direction: directionSelect.value
      });
      updatePager();
    }

    function debounceSearchFirstPage() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => sendSearch(1), 300);
    }

    function renderResultItems(items) {
      if (!Array.isArray(items) || items.length === 0) {
        resultList.innerHTML = '<div class="item"><div class="small">검색 결과가 없습니다.</div></div>';
        return;
      }

      function formatCount(value) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized.toLocaleString('ko-KR') : '-';
      }

      function formatAverageTries(value) {
        const normalized = Number(value);
        return Number.isFinite(normalized) ? normalized.toFixed(2) : '-';
      }

      resultList.innerHTML = items.map((problem) => {
        const tags = Array.isArray(problem.tags) ? problem.tags.slice(0, 4).join(', ') : '';
        const tagsLine = tags ? '<div class="small">태그 · ' + escapeHtml(tags) + '</div>' : '';
        const badges = [];
        if (problem.official === true) {
          badges.push('공식');
        }

        if (problem.official === false) {
          badges.push('비공식');
        }

        if (problem.isPartial === true) {
          badges.push('부분점수');
        }

        if (problem.sprout === true) {
          badges.push('새싹');
        }

        const badgeHtml = badges.length > 0
          ? '<div class="badge-row">' + badges.map((badge) => '<span class="badge">' + escapeHtml(badge) + '</span>').join('') + '</div>'
          : '';

        const statText = '맞은 사람 ' + formatCount(problem.acceptedUserCount)
          + ' · 평균 시도 ' + formatAverageTries(problem.averageTries)
          + ' · 기여자 ' + formatCount(problem.votedUserCount);

        return '<div class="item">'
          + renderTitleWithRank(problem)
          + tagsLine
          + '<div class="meta-line">' + escapeHtml(statText) + '</div>'
          + badgeHtml
          + '<div class="row">'
          + '<button data-action="loadResult" data-problem-id="' + escapeHtml(problem.problemId) + '">문제 보기</button>'
          + '<button data-action="openResult" data-problem-id="' + escapeHtml(problem.problemId) + '">웹 열기</button>'
          + '<button class="primary" data-action="createResult" data-problem-id="' + escapeHtml(problem.problemId) + '">파일 생성</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    function renderRecents(items) {
      if (!Array.isArray(items) || items.length === 0) {
        recentList.innerHTML = '<div class="item"><div class="small">최근 문제 기록이 없습니다.</div></div>';
        return;
      }

      recentList.innerHTML = items.map((problem) => {
        const tags = Array.isArray(problem.tags) ? problem.tags.slice(0, 4).join(', ') : '';
        const tagsLine = tags ? '<div class="small">태그 · ' + escapeHtml(tags) + '</div>' : '';
        return '<div class="item">'
          + renderTitleWithRank(problem)
          + tagsLine
          + '<div class="row">'
          + '<button data-action="loadRecent" data-problem-id="' + escapeHtml(problem.problemId) + '">문제 보기</button>'
          + '<button data-action="openRecent" data-problem-id="' + escapeHtml(problem.problemId) + '">웹 열기</button>'
          + '<button class="primary" data-action="createRecent" data-problem-id="' + escapeHtml(problem.problemId) + '">파일 생성</button>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    function handleActionMessage(action, problemId) {
      vscode.postMessage({ type: action, problemId });
    }

    searchBtn.addEventListener('click', () => sendSearch(1));
    queryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        sendSearch(1);
      }
    });
    queryInput.addEventListener('input', debounceSearchFirstPage);

    sortSelect.addEventListener('change', () => sendSearch(1));
    directionSelect.addEventListener('change', () => sendSearch(1));
    tierSelect.addEventListener('change', () => {
      selectedTier = tierSelect.value || 'all';
      sendSearch(1);
    });

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

    clearRecentBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearRecent' });
    });

    toggleRecentBtn.addEventListener('click', () => {
      setRecentCollapsed(!isRecentCollapsed);
    });

    openSettingsBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    resultList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('button[data-action]');
      if (!button) return;

      const action = button.getAttribute('data-action');
      const problemId = Number(button.getAttribute('data-problem-id'));
      if (!action || !Number.isInteger(problemId) || problemId <= 0) return;
      handleActionMessage(action, problemId);
    });

    recentList.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest('button[data-action]');
      if (!button) return;

      const action = button.getAttribute('data-action');
      const problemId = Number(button.getAttribute('data-problem-id'));
      if (!action || !Number.isInteger(problemId) || problemId <= 0) return;
      handleActionMessage(action, problemId);
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      if (message.type === 'settings') {
        renderLanguageLabel(message.defaultLanguage);
        return;
      }

      if (message.type === 'searchResult') {
        const items = Array.isArray(message.items) ? message.items : [];
        renderResultItems(items);
        currentPage = Number(message.page || 1);
        hasPrev = Boolean(message.hasPrev);
        hasNext = Boolean(message.hasNext);
        totalLabel.textContent = '총 ' + Number(message.total || 0) + '개';
        updatePager();
        return;
      }

      if (message.type === 'recents') {
        renderRecents(message.items);
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

    renderResultItems([]);
    renderRecents([]);
    setRecentCollapsed(isRecentCollapsed);
    updatePager();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
    getNonce() {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let value = "";
        for (let i = 0; i < 16; i += 1) {
            value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        }
        return value;
    }
}
exports.BojSidebarViewProvider = BojSidebarViewProvider;
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
    return value === "asc" || value === "desc" || value === "rankAsc" || value === "rankDesc";
}
//# sourceMappingURL=bojSidebarViewProvider.js.map