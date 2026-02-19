import * as path from "path";
import * as vscode from "vscode";
import { ProblemSearchService } from "../services/problemSearchService";
import { RecentService } from "../services/recentService";
import { ScaffoldService } from "../services/scaffoldService";
import { ProblemSortKey, ProblemSummary, SortDirection, TierGroup } from "../types/problem";
import { pickTargetRootUri } from "../utils/workspaceTarget";

interface SidebarDeps {
  extensionUri: vscode.Uri;
  problemSearchService: ProblemSearchService;
  recentService: RecentService;
  scaffoldService: ScaffoldService;
  showProblemPanel: (problemId: number, reveal: boolean) => Promise<void>;
}

type SidebarMessage =
  | { type: "ready" }
  | {
      type: "search";
      query: string;
      tierGroup: TierGroup;
      page: number;
      sort: ProblemSortKey;
      direction: SortDirection;
    }
  | { type: "openResult"; problemId: number }
  | { type: "createResult"; problemId: number }
  | { type: "loadResult"; problemId: number }
  | { type: "openRecent"; problemId: number }
  | { type: "createRecent"; problemId: number }
  | { type: "loadRecent"; problemId: number }
  | { type: "clearRecent" }
  | { type: "openSettings" };

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_LANGUAGE = "py";

export class BojSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "boj.sidebar";

  private view?: vscode.WebviewView;
  private latestProblemMap = new Map<number, ProblemSummary>();
  private currentProblemId?: number;

  constructor(private readonly deps: SidebarDeps) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.deps.extensionUri]
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
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
      } catch (error) {
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

  private async autoLoadCurrentProblemFromEditor(): Promise<void> {
    const problemId = this.detectProblemIdFromActiveEditor();
    if (!problemId || problemId === this.currentProblemId) {
      return;
    }

    await this.loadProblemPanel(problemId, false);
  }

  private detectProblemIdFromActiveEditor(): number | undefined {
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

  private async loadProblemPanel(problemId: number, reveal: boolean): Promise<void> {
    this.currentProblemId = problemId;
    await this.deps.showProblemPanel(problemId, reveal);
    await this.postStatus(`문제 패널 로드: ${problemId}번`);
  }

  private async handleSearch(message: Extract<SidebarMessage, { type: "search" }>): Promise<void> {
    const query = message.query.trim();

    if (!query) {
      this.latestProblemMap.clear();
      await this.view?.webview.postMessage({
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

    const tierCountResult = await this.deps.problemSearchService.getTierCounts(
      query,
      message.tierGroup,
      result.total
    );

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
      tierCounts: tierCountResult.counts,
      page: result.page,
      hasPrev,
      hasNext
    });

    await this.postStatus(`총 ${result.total}개 · ${result.page}페이지 · 현재 ${result.items.length}개`);
  }

  private async resolveProblemFromSearch(problemId: number): Promise<ProblemSummary | undefined> {
    const latest = this.latestProblemMap.get(problemId);
    if (latest) {
      return latest;
    }

    return this.findProblemById(problemId);
  }

  private async findProblemById(problemId: number): Promise<ProblemSummary | undefined> {
    const items = await this.deps.problemSearchService.search(String(problemId), "all");
    return items.find((item) => item.problemId === problemId);
  }

  private async openProblemWeb(problemId: number): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(`https://www.acmicpc.net/problem/${problemId}`));
  }

  private async createProblem(problem: ProblemSummary): Promise<void> {
    const targetRootUri = await pickTargetRootUri();
    if (!targetRootUri) {
      return;
    }

    const config = vscode.workspace.getConfiguration("bojSearch");
    const configuredLanguage = this.resolveConfiguredLanguage(config);
    const outputDir = config.get<string>("outputDir", ".");
    const openWebOnSelect = config.get<boolean>("openWebOnSelect", true);

    if (openWebOnSelect) {
      await this.openProblemWeb(problem.problemId);
    }

    const scaffoldResult = await this.deps.scaffoldService.scaffold(
      targetRootUri,
      outputDir,
      problem,
      configuredLanguage
    );

    await this.deps.recentService.add(problem);
    await this.postRecents();

    if (scaffoldResult.created.length > 0) {
      const doc = await vscode.workspace.openTextDocument(scaffoldResult.created[0]);
      await vscode.window.showTextDocument(doc);
    }

    await this.postStatus(
      `BOJ ${problem.problemId}: 생성 ${scaffoldResult.created.length}개, 기존 ${scaffoldResult.skipped.length}개 · 언어 ${configuredLanguage}`
    );
  }

  private async postSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration("bojSearch");
    const defaultLanguage = this.resolveConfiguredLanguage(config);

    await this.view?.webview.postMessage({
      type: "settings",
      defaultLanguage
    });
  }

  private resolveConfiguredLanguage(config: vscode.WorkspaceConfiguration): string {
    const configured = config.get<string>("defaultLanguage", DEFAULT_LANGUAGE);
    const trimmed = configured.trim().toLowerCase();
    if (/^[a-z0-9]+$/.test(trimmed)) {
      return trimmed;
    }

    return DEFAULT_LANGUAGE;
  }

  private async postRecents(): Promise<void> {
    await this.view?.webview.postMessage({ type: "recents", items: this.deps.recentService.list() });
  }

  private async postStatus(text: string): Promise<void> {
    await this.view?.webview.postMessage({ type: "status", text });
  }

  private async postError(text: string): Promise<void> {
    await this.view?.webview.postMessage({ type: "error", text });
    vscode.window.showErrorMessage(`BOJ: ${text}`);
  }

  private parseMessage(rawMessage: unknown): SidebarMessage | undefined {
    if (!rawMessage || typeof rawMessage !== "object") {
      return undefined;
    }

    const message = rawMessage as Record<string, unknown>;
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

    if (
      type === "openResult" ||
      type === "createResult" ||
      type === "loadResult" ||
      type === "openRecent" ||
      type === "createRecent" ||
      type === "loadRecent"
    ) {
      const problemId =
        typeof message.problemId === "number" ? message.problemId : Number(message.problemId);

      if (!Number.isInteger(problemId) || problemId <= 0) {
        return undefined;
      }

      return { type, problemId };
    }

    return undefined;
  }

  private getHtml(webview: vscode.Webview): string {
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
      padding: 12px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
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
      margin-top: 12px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 10px;
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

    .pager { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    .rank-grid {
      margin-top: 6px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .rank {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 7px;
      padding: 6px;
      background: var(--vscode-sideBar-background);
    }

    .rank-name { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .rank-count { margin-top: 2px; font-size: 13px; font-weight: 700; }

    .list {
      display: grid;
      gap: 6px;
      margin-top: 6px;
      max-height: 280px;
      overflow: auto;
      padding-right: 2px;
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

    .status {
      margin-top: 10px;
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
  <section class="section" style="margin-top: 0;">
    <h1>BOJ-STARTER</h1>
    <div class="subtitle">좌측은 검색/생성 허브, 문제 상세/테스트케이스는 우측 탭 패널에서 엽니다.</div>
  </section>

  <section class="section">
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
      </select>
    </div>

    <div class="small" id="languageLabel" style="margin-top: 8px;">파일 생성 언어: .py</div>

    <div class="pager">
      <button id="prevBtn">이전</button>
      <div id="pageLabel" class="small">페이지 1</div>
      <button id="nextBtn">다음</button>
      <div id="totalLabel" class="small">총 0개</div>
    </div>

    <div id="rankGrid" class="rank-grid"></div>
    <div id="resultList" class="list"></div>
  </section>

  <section class="section">
    <h2 class="section-title">최근 문제</h2>
    <div class="row">
      <button id="clearRecentBtn">최근 기록 비우기</button>
      <button id="openSettingsBtn">설정 열기</button>
    </div>
    <div id="recentList" class="list"></div>
  </section>

  <div id="status" class="status"></div>

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
    const rankGrid = document.getElementById('rankGrid');

    const resultList = document.getElementById('resultList');
    const recentList = document.getElementById('recentList');

    const languageLabel = document.getElementById('languageLabel');
    const clearRecentBtn = document.getElementById('clearRecentBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const statusEl = document.getElementById('status');

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

    function renderRankCounts(counts) {
      const source = counts && typeof counts === 'object' ? counts : {};
      const cards = rankOrder.map((rankKey) => {
        const count = Number(source[rankKey] || 0);
        return '<div class="rank">'
          + '<div class="rank-name">' + escapeHtml(rankLabels[rankKey]) + '</div>'
          + '<div class="rank-count">' + escapeHtml(count) + '</div>'
          + '</div>';
      });

      rankGrid.innerHTML = cards.join('');
    }

    function renderLanguageLabel(language) {
      const normalized = String(language || '').trim().toLowerCase();
      const fallback = normalized || 'py';
      languageLabel.textContent = '파일 생성 언어: .' + fallback;
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

      resultList.innerHTML = items.map((problem) => {
        const tags = Array.isArray(problem.tags) ? problem.tags.slice(0, 4).join(', ') : '';
        return '<div class="item">'
          + '<div class="item-title">#' + escapeHtml(problem.problemId) + ' · ' + escapeHtml(problem.title) + '</div>'
          + '<div class="small">' + escapeHtml(problem.tierText) + (tags ? ' · ' + escapeHtml(tags) : '') + '</div>'
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
        return '<div class="item">'
          + '<div class="item-title">#' + escapeHtml(problem.problemId) + ' · ' + escapeHtml(problem.title) + '</div>'
          + '<div class="small">' + escapeHtml(problem.tierText) + '</div>'
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
        renderRankCounts(message.tierCounts);
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
    renderRankCounts({});
    updatePager();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  private getNonce(): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let i = 0; i < 16; i += 1) {
      value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return value;
  }
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function isTierGroup(value: unknown): value is TierGroup {
  return (
    value === "all" ||
    value === "unrated" ||
    value === "bronze" ||
    value === "silver" ||
    value === "gold" ||
    value === "platinum" ||
    value === "diamond" ||
    value === "ruby" ||
    value === "master"
  );
}

function isProblemSortKey(value: unknown): value is ProblemSortKey {
  return value === "id" || value === "level" || value === "solved";
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}
