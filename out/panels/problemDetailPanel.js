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
exports.ProblemDetailPanel = void 0;
const vscode = __importStar(require("vscode"));
class ProblemDetailPanel {
    detailService;
    testCaseRunner;
    userTestCaseService;
    panel;
    currentDetail;
    currentCases = [];
    constructor(detailService, testCaseRunner, userTestCaseService) {
        this.detailService = detailService;
        this.testCaseRunner = testCaseRunner;
        this.userTestCaseService = userTestCaseService;
    }
    async show(problemId, reveal) {
        if (!this.panel && !reveal) {
            return;
        }
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel("boj.problemDetail", "BOJ Problem", vscode.ViewColumn.Beside, {
                enableScripts: true,
                retainContextWhenHidden: true
            });
            this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.currentDetail = undefined;
                this.currentCases = [];
            });
            this.panel.webview.onDidReceiveMessage(async (rawMessage) => {
                const message = this.parseMessage(rawMessage);
                if (!message) {
                    return;
                }
                try {
                    if (message.type === "openWeb") {
                        await vscode.env.openExternal(vscode.Uri.parse(`https://www.acmicpc.net/problem/${message.problemId}`));
                        return;
                    }
                    if (message.type === "copyInput" || message.type === "copyOutput") {
                        await vscode.env.clipboard.writeText(message.value);
                        await this.postRunStatus("클립보드에 복사했습니다.", false);
                        return;
                    }
                    if (message.type === "addCase") {
                        await this.handleAddCase(message.input, message.output);
                        return;
                    }
                    if (message.type === "updateCase") {
                        await this.handleUpdateCase(message.caseId, message.input, message.output);
                        return;
                    }
                    if (message.type === "deleteCase") {
                        await this.handleDeleteCase(message.caseId);
                        return;
                    }
                    if (message.type === "runAll" || message.type === "runCase") {
                        await this.handleRun(message);
                    }
                }
                catch (error) {
                    const messageText = error instanceof Error ? error.message : String(error);
                    await this.postRunStatus(messageText, true);
                    vscode.window.showErrorMessage(`테스트 실행 오류: ${messageText}`);
                }
            });
        }
        if (this.currentDetail?.problemId !== problemId) {
            const detail = await this.detailService.getProblemDetail(problemId);
            const userCases = this.userTestCaseService.list(problemId);
            this.currentDetail = detail;
            this.currentCases = this.buildCases(detail, userCases);
            this.panel.title = `BOJ ${detail.problemId} - ${detail.title}`;
            this.panel.webview.html = this.getHtml(detail, this.currentCases);
        }
        if (reveal) {
            this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside);
        }
    }
    async handleAddCase(input, output) {
        if (!this.currentDetail) {
            await this.postRunStatus("문제 정보를 먼저 로드해 주세요.", true);
            return;
        }
        if (!input.trim() && !output.trim()) {
            await this.postRunStatus("추가할 입력/출력을 입력해 주세요.", true);
            return;
        }
        await this.userTestCaseService.add(this.currentDetail.problemId, input, output);
        await this.refreshUserCases("사용자 테스트케이스를 추가했습니다.");
    }
    async handleUpdateCase(caseId, input, output) {
        if (!this.currentDetail) {
            await this.postRunStatus("문제 정보를 먼저 로드해 주세요.", true);
            return;
        }
        if (!input.trim() && !output.trim()) {
            await this.postRunStatus("입력/출력은 모두 비워둘 수 없습니다.", true);
            return;
        }
        await this.userTestCaseService.update(this.currentDetail.problemId, caseId, input, output);
        await this.refreshUserCases("사용자 테스트케이스를 수정했습니다.");
    }
    async handleDeleteCase(caseId) {
        if (!this.currentDetail) {
            await this.postRunStatus("문제 정보를 먼저 로드해 주세요.", true);
            return;
        }
        await this.userTestCaseService.remove(this.currentDetail.problemId, caseId);
        await this.refreshUserCases("사용자 테스트케이스를 삭제했습니다.");
    }
    async handleRun(message) {
        if (!this.currentDetail) {
            await this.postRunStatus("문제 정보를 먼저 로드해 주세요.", true);
            return;
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            await this.postRunStatus("실행할 코드 파일을 먼저 열어 주세요.", true);
            return;
        }
        const runCases = message.type === "runAll"
            ? this.toRunnerCases(this.currentCases)
            : this.toRunnerCases(this.currentCases.filter((testCase) => testCase.key === message.caseKey));
        if (runCases.length === 0) {
            await this.postRunStatus("실행할 테스트케이스가 없습니다.", true);
            return;
        }
        await this.postRunStatus(message.type === "runAll"
            ? "모든 테스트케이스 실행 중..."
            : `케이스 ${runCases[0].index} 실행 중...`, false);
        const summary = await this.testCaseRunner.runAgainstTestCases(activeEditor.document.fileName, runCases);
        await this.panel?.webview.postMessage({
            type: "runResult",
            summary
        });
    }
    async refreshUserCases(statusText) {
        if (!this.currentDetail) {
            return;
        }
        const userCases = this.userTestCaseService.list(this.currentDetail.problemId);
        this.currentCases = this.buildCases(this.currentDetail, userCases);
        await this.panel?.webview.postMessage({
            type: "replaceCasesHtml",
            html: this.renderTestCasesHtml(this.currentCases)
        });
        if (statusText) {
            await this.postRunStatus(statusText, false);
        }
    }
    toRunnerCases(cases) {
        return cases.map((testCase) => ({
            index: testCase.index,
            input: testCase.input,
            output: testCase.output
        }));
    }
    buildCases(detail, userCases) {
        const sampleCases = detail.testCases.map((testCase) => ({
            key: `sample:${testCase.index}`,
            index: testCase.index,
            input: testCase.input,
            output: testCase.output,
            source: "sample"
        }));
        const startIndex = sampleCases.reduce((maxValue, item) => Math.max(maxValue, item.index), 0) + 1;
        const customCases = userCases.map((testCase, offset) => ({
            key: `user:${testCase.id}`,
            caseId: testCase.id,
            index: startIndex + offset,
            input: testCase.input,
            output: testCase.output,
            source: "user"
        }));
        return [...sampleCases, ...customCases];
    }
    async postRunStatus(text, isError) {
        await this.panel?.webview.postMessage({
            type: "runStatus",
            text,
            isError
        });
    }
    parseMessage(rawMessage) {
        if (!rawMessage || typeof rawMessage !== "object") {
            return undefined;
        }
        const message = rawMessage;
        const type = message.type;
        if (type === "openWeb") {
            const problemId = typeof message.problemId === "number"
                ? message.problemId
                : Number(message.problemId);
            if (!Number.isInteger(problemId) || problemId <= 0) {
                return undefined;
            }
            return { type, problemId };
        }
        if (type === "copyInput" || type === "copyOutput") {
            const value = typeof message.value === "string" ? message.value : "";
            return { type, value };
        }
        if (type === "runAll") {
            return { type: "runAll" };
        }
        if (type === "runCase") {
            if (typeof message.caseKey !== "string" || message.caseKey.trim().length === 0) {
                return undefined;
            }
            return { type: "runCase", caseKey: message.caseKey };
        }
        if (type === "addCase") {
            const input = typeof message.input === "string" ? message.input : "";
            const output = typeof message.output === "string" ? message.output : "";
            return { type, input, output };
        }
        if (type === "updateCase") {
            if (typeof message.caseId !== "string" || message.caseId.trim().length === 0) {
                return undefined;
            }
            const input = typeof message.input === "string" ? message.input : "";
            const output = typeof message.output === "string" ? message.output : "";
            return { type, caseId: message.caseId, input, output };
        }
        if (type === "deleteCase") {
            if (typeof message.caseId !== "string" || message.caseId.trim().length === 0) {
                return undefined;
            }
            return { type, caseId: message.caseId };
        }
        return undefined;
    }
    getHtml(detail, cases) {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 14px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .header {
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 12px;
      display: grid;
      gap: 8px;
    }

    .title {
      margin: 0;
      font-size: 18px;
      line-height: 1.35;
      letter-spacing: 0.2px;
    }

    .top-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 8px;
      padding: 7px 10px;
      cursor: pointer;
      font-weight: 700;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn.secondary {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }

    .btn.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }

    .section {
      margin-top: 12px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 12px;
      padding: 12px;
    }

    .section-title {
      margin: 0 0 8px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
    }

    .text-block {
      margin: 0;
      line-height: 1.55;
      white-space: pre-wrap;
      color: var(--vscode-editor-foreground);
    }

    .statement-content {
      color: var(--vscode-editor-foreground);
      line-height: 1.55;
      display: grid;
      gap: 8px;
      word-break: break-word;
    }

    .statement-content > :first-child {
      margin-top: 0;
    }

    .statement-content > :last-child {
      margin-bottom: 0;
    }

    .statement-content p,
    .statement-content ul,
    .statement-content ol,
    .statement-content blockquote,
    .statement-content table,
    .statement-content pre,
    .statement-content h1,
    .statement-content h2,
    .statement-content h3,
    .statement-content h4,
    .statement-content h5,
    .statement-content h6 {
      margin: 0;
    }

    .statement-content ul,
    .statement-content ol {
      padding-left: 20px;
    }

    .statement-content a {
      color: var(--vscode-textLink-foreground);
    }

    .statement-content img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
    }

    .statement-content table {
      width: 100%;
      border-collapse: collapse;
      overflow-x: auto;
      display: block;
    }

    .statement-content th,
    .statement-content td {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }

    .editor-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0));
      padding: 10px;
      margin-bottom: 10px;
      display: grid;
      gap: 8px;
    }

    .editor-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .editor-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-weight: 700;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .editor-input {
      width: 100%;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-input-background, var(--vscode-editor-background));
      color: var(--vscode-input-foreground, var(--vscode-editor-foreground));
      padding: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      min-height: 84px;
      resize: vertical;
    }

    .editor-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .editor-cancel {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
    }

    .case {
      margin-top: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: var(--vscode-sideBar-background);
      padding: 10px;
    }

    .case-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-weight: 700;
      color: var(--vscode-editor-foreground);
      flex-wrap: wrap;
    }

    .case-left {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .badge {
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      font-size: 10px;
      line-height: 1;
      padding: 3px 7px;
      color: var(--vscode-descriptionForeground);
    }

    .case-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .case-btn {
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
    }

    .case-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }

    .case-btn.run {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .io-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .io-col {
      display: grid;
      gap: 6px;
      align-content: start;
    }

    .io-title {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-weight: 700;
    }

    pre {
      margin: 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background));
      color: var(--vscode-editor-foreground);
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 32px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
    }

    .hint {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .run-status {
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--vscode-descriptionForeground);
    }

    .run-status.error {
      color: var(--vscode-errorForeground, #ff7b90);
    }

    .run-result-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 8px;
      background: var(--vscode-sideBar-background);
      margin-top: 8px;
      display: grid;
      gap: 6px;
    }

    .pass { color: var(--vscode-testing-iconPassed, #56c9a3); font-weight: 700; }
    .fail { color: var(--vscode-testing-iconFailed, var(--vscode-errorForeground, #ff7b90)); font-weight: 700; }
    .run-meta { color: var(--vscode-descriptionForeground); font-size: 11px; }

    @media (max-width: 800px) {
      .io-grid { grid-template-columns: 1fr; }
      .editor-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <section class="header">
    <h1 class="title">#${detail.problemId} · ${escapeHtml(detail.title)}</h1>
    <div class="top-actions">
      <button id="openWebBtn" class="btn secondary">BOJ 원문 열기</button>
      <button id="runAllBtn" class="btn">모든 테스트 실행</button>
    </div>
  </section>

  <section class="section">
    <h2 class="section-title">문제</h2>
    ${this.renderStatementSection(detail.problemHtml, detail.problem, "문제 정보가 없습니다.")}
  </section>

  <section class="section">
    <h2 class="section-title">입력</h2>
    ${this.renderStatementSection(detail.inputHtml, detail.input, "입력 정보가 없습니다.")}
  </section>

  <section class="section">
    <h2 class="section-title">출력</h2>
    ${this.renderStatementSection(detail.outputHtml, detail.output, "출력 정보가 없습니다.")}
  </section>

  <section class="section">
    <h2 class="section-title">테스트케이스</h2>
    <div class="editor-card">
      <div class="editor-grid">
        <div>
          <div class="editor-label">입력 <span id="editorInputIndex">새 케이스</span></div>
          <textarea id="caseInput" class="editor-input" placeholder="입력을 입력하세요..."></textarea>
        </div>
        <div>
          <div class="editor-label">출력</div>
          <textarea id="caseOutput" class="editor-input" placeholder="출력을 입력하세요..."></textarea>
        </div>
      </div>
      <div class="editor-actions">
        <button id="saveCaseBtn" class="btn">추가</button>
        <button id="cancelCaseBtn" class="btn editor-cancel">취소</button>
      </div>
    </div>
    <div id="testCaseContainer">${this.renderTestCasesHtml(cases)}</div>
  </section>

  <section class="section">
    <h2 class="section-title">실행 결과</h2>
    <div id="runStatus" class="run-status">실행 버튼을 눌러 테스트를 시작하세요.</div>
    <div id="runResultList"></div>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const openWebBtn = document.getElementById('openWebBtn');
    const runAllBtn = document.getElementById('runAllBtn');
    const saveCaseBtn = document.getElementById('saveCaseBtn');
    const cancelCaseBtn = document.getElementById('cancelCaseBtn');
    const caseInput = document.getElementById('caseInput');
    const caseOutput = document.getElementById('caseOutput');
    const editorInputIndex = document.getElementById('editorInputIndex');
    const testCaseContainer = document.getElementById('testCaseContainer');
    const runStatus = document.getElementById('runStatus');
    const runResultList = document.getElementById('runResultList');
    let editingCaseId = '';

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function decodeHtml(value) {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = String(value || '');
      return textarea.value;
    }

    function setRunStatus(text, isError) {
      runStatus.textContent = text || '';
      runStatus.className = isError ? 'run-status error' : 'run-status';
    }

    function resetEditor() {
      editingCaseId = '';
      editorInputIndex.textContent = '새 케이스';
      saveCaseBtn.textContent = '추가';
      cancelCaseBtn.style.visibility = 'hidden';
      caseInput.value = '';
      caseOutput.value = '';
    }

    function startEditorWithCase(caseId, input, output, displayIndex) {
      editingCaseId = caseId;
      editorInputIndex.textContent = '케이스 ' + String(displayIndex || '수정');
      saveCaseBtn.textContent = '수정';
      cancelCaseBtn.style.visibility = 'visible';
      caseInput.value = input || '';
      caseOutput.value = output || '';
      caseInput.focus();
    }

    function renderRunResult(summary) {
      if (!summary || !Array.isArray(summary.cases)) {
        return;
      }

      const html = summary.cases.map((item) => {
        const statusClass = item.passed ? 'pass' : 'fail';
        const statusText = item.passed ? 'SUCCESS' : (item.error ? 'ERROR' : 'FAILED');
        const errorLine = item.error
          ? '<div class="run-meta">error: ' + escapeHtml(item.error) + '</div>'
          : '';

        return '<div class="run-result-item">'
          + '<div class="' + statusClass + '">Case ' + escapeHtml(item.index) + ': ' + statusText + '</div>'
          + '<div class="run-meta">expected: ' + escapeHtml(item.expected) + '</div>'
          + '<div class="run-meta">actual: ' + escapeHtml(item.actual) + '</div>'
          + '<div class="run-meta">duration: ' + escapeHtml(item.durationMs) + 'ms</div>'
          + errorLine
          + '</div>';
      }).join('');

      runResultList.innerHTML = html;
      setRunStatus(
        '완료: ' + summary.passed + '/' + summary.total + ' 통과, 실패 ' + summary.failed + ', 오류 ' + summary.errors,
        summary.failed > 0 || summary.errors > 0
      );
    }

    openWebBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openWeb', problemId: ${detail.problemId} });
    });

    runAllBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'runAll' });
    });

    saveCaseBtn.addEventListener('click', () => {
      const input = caseInput.value || '';
      const output = caseOutput.value || '';

      if (!editingCaseId) {
        vscode.postMessage({ type: 'addCase', input, output });
      } else {
        vscode.postMessage({ type: 'updateCase', caseId: editingCaseId, input, output });
      }

      resetEditor();
    });

    cancelCaseBtn.addEventListener('click', () => {
      resetEditor();
    });

    document.body.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const button = target.closest('button[data-action]');
      if (!button) {
        return;
      }

      const action = button.getAttribute('data-action');
      if (!action) {
        return;
      }

      if (action === 'runCase') {
        const caseKey = button.getAttribute('data-case-key') || '';
        if (!caseKey) {
          return;
        }
        vscode.postMessage({ type: 'runCase', caseKey });
        return;
      }

      if (action === 'editUserCase') {
        const caseId = button.getAttribute('data-case-id') || '';
        if (!caseId) {
          return;
        }

        const currentInput = decodeHtml(button.getAttribute('data-input') || '');
        const currentOutput = decodeHtml(button.getAttribute('data-output') || '');
        const caseIndex = Number(button.getAttribute('data-case-index'));
        startEditorWithCase(caseId, currentInput, currentOutput, Number.isFinite(caseIndex) ? caseIndex : '수정');
        return;
      }

      if (action === 'deleteUserCase') {
        const caseId = button.getAttribute('data-case-id') || '';
        if (!caseId) {
          return;
        }

        vscode.postMessage({ type: 'deleteCase', caseId });
        return;
      }

      const value = button.getAttribute('data-value') || '';
      vscode.postMessage({ type: action, value });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'runStatus') {
        setRunStatus(message.text || '', Boolean(message.isError));
        return;
      }

      if (message.type === 'runResult') {
        renderRunResult(message.summary);
        return;
      }

      if (message.type === 'replaceCasesHtml') {
        testCaseContainer.innerHTML = message.html || '';
        resetEditor();
      }
    });

    resetEditor();
  </script>
</body>
</html>`;
    }
    renderStatementSection(html, text, fallback) {
        if (html.trim().length > 0) {
            return `<div class="statement-content">${html}</div>`;
        }
        const value = text.trim().length > 0 ? text : fallback;
        return `<p class="text-block">${escapeHtml(value)}</p>`;
    }
    renderTestCasesHtml(cases) {
        if (cases.length === 0) {
            return '<div class="hint">테스트케이스가 없습니다.</div>';
        }
        return cases
            .map((testCase) => {
            const sourceText = testCase.source === "sample" ? "BOJ 예제" : "사용자 추가";
            const userActions = testCase.source === "user" && testCase.caseId
                ? `<button class="case-btn" data-action="editUserCase" data-case-id="${escapeHtmlAttr(testCase.caseId)}" data-case-index="${testCase.index}" data-input="${escapeHtmlAttr(testCase.input)}" data-output="${escapeHtmlAttr(testCase.output)}">수정</button>
               <button class="case-btn" data-action="deleteUserCase" data-case-id="${escapeHtmlAttr(testCase.caseId)}">삭제</button>`
                : "";
            return `<section class="case">
        <div class="case-head">
          <div class="case-left">
            <span>케이스 ${testCase.index}</span>
            <span class="badge">${sourceText}</span>
          </div>
          <div class="case-actions">
            <button class="case-btn" data-action="copyInput" data-value="${escapeHtmlAttr(testCase.input)}">입력 복사</button>
            <button class="case-btn" data-action="copyOutput" data-value="${escapeHtmlAttr(testCase.output)}">출력 복사</button>
            <button class="case-btn run" data-action="runCase" data-case-key="${escapeHtmlAttr(testCase.key)}">▶ 실행</button>
            ${userActions}
          </div>
        </div>
        <div class="io-grid">
          <div class="io-col">
            <div class="io-title">입력</div>
            <pre>${escapeHtml(testCase.input)}</pre>
          </div>
          <div class="io-col">
            <div class="io-title">출력</div>
            <pre>${escapeHtml(testCase.output)}</pre>
          </div>
        </div>
      </section>`;
        })
            .join("");
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
exports.ProblemDetailPanel = ProblemDetailPanel;
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function escapeHtmlAttr(value) {
    return escapeHtml(value).replaceAll("\n", "&#10;");
}
//# sourceMappingURL=problemDetailPanel.js.map