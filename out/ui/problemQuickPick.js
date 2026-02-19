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
exports.showProblemQuickPick = showProblemQuickPick;
const vscode = __importStar(require("vscode"));
const debounce_1 = require("../utils/debounce");
const TIER_GROUP_LABELS = {
    all: "전체",
    bronze: "브론즈",
    silver: "실버",
    gold: "골드"
};
// Show a dynamic QuickPick search UI (number/title/tag + tier filter).
async function showProblemQuickPick(options) {
    const quickPick = vscode.window.createQuickPick();
    quickPick.title = "BOJ 문제 검색";
    quickPick.placeholder = "번호/제목/태그 검색 (예: 1000, A+B, #dp)";
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.ignoreFocusOut = true;
    const filterButton = {
        iconPath: new vscode.ThemeIcon("filter"),
        tooltip: "난이도 필터 변경"
    };
    quickPick.buttons = [filterButton];
    let selectedTierGroup = "all";
    let latestProblems = [];
    let requestVersion = 0;
    const toItem = (problem) => ({
        label: `${problem.problemId}`,
        description: `${problem.title} • ${problem.tierText}`,
        detail: problem.tags.slice(0, 5).join(", "),
        problem
    });
    const showRecentItems = () => {
        if (options.recents.length === 0) {
            quickPick.items = [
                {
                    label: "최근 기록 없음",
                    description: "검색어를 입력해 문제를 찾으세요.",
                    detail: `현재 필터: ${TIER_GROUP_LABELS[selectedTierGroup]}`
                }
            ];
            return;
        }
        quickPick.items = [
            {
                label: "Recent",
                kind: vscode.QuickPickItemKind.Separator
            },
            ...options.recents.map(toItem)
        ];
    };
    const renderSearchResults = (problems) => {
        if (problems.length === 0) {
            quickPick.items = [
                {
                    label: "검색 결과 없음",
                    description: "다른 키워드나 태그로 다시 시도해보세요.",
                    detail: `현재 필터: ${TIER_GROUP_LABELS[selectedTierGroup]}`
                }
            ];
            return;
        }
        quickPick.items = [
            {
                label: "Search Results",
                kind: vscode.QuickPickItemKind.Separator
            },
            ...problems.map(toItem)
        ];
    };
    const runSearch = (0, debounce_1.debounce)(async (rawInput) => {
        const query = rawInput.trim();
        if (!query) {
            latestProblems = [];
            quickPick.busy = false;
            showRecentItems();
            return;
        }
        const currentRequest = ++requestVersion;
        quickPick.busy = true;
        try {
            const problems = await options.search(query, selectedTierGroup);
            // Ignore stale results from previous async requests.
            if (currentRequest !== requestVersion) {
                return;
            }
            latestProblems = problems;
            renderSearchResults(problems);
        }
        catch (error) {
            if (currentRequest !== requestVersion) {
                return;
            }
            quickPick.items = [
                {
                    label: "검색 실패",
                    description: "네트워크 또는 API 오류가 발생했습니다.",
                    detail: error instanceof Error ? error.message : String(error)
                }
            ];
        }
        finally {
            if (currentRequest === requestVersion) {
                quickPick.busy = false;
            }
        }
    }, 300);
    quickPick.onDidChangeValue((value) => {
        void runSearch(value);
    });
    quickPick.onDidTriggerButton(async () => {
        const picked = await vscode.window.showQuickPick([
            { label: "all", description: "전체" },
            { label: "bronze", description: "브론즈" },
            { label: "silver", description: "실버" },
            { label: "gold", description: "골드" }
        ], {
            title: "난이도 필터",
            placeHolder: `현재: ${TIER_GROUP_LABELS[selectedTierGroup]}`
        });
        if (!picked) {
            return;
        }
        selectedTierGroup = picked.label;
        // Re-run with current query after changing filter.
        void runSearch(quickPick.value);
    });
    return new Promise((resolve) => {
        let settled = false;
        const finish = (problem) => {
            if (settled) {
                return;
            }
            settled = true;
            quickPick.dispose();
            resolve(problem);
        };
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (!selected?.problem) {
                return;
            }
            const byId = latestProblems.find((problem) => problem.problemId === selected.problem?.problemId);
            finish(byId ?? selected.problem);
            quickPick.hide();
        });
        quickPick.onDidHide(() => finish(undefined));
        showRecentItems();
        quickPick.show();
    });
}
//# sourceMappingURL=problemQuickPick.js.map