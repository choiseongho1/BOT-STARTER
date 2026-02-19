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
exports.runSearchAndScaffoldCommand = runSearchAndScaffoldCommand;
const vscode = __importStar(require("vscode"));
const problemQuickPick_1 = require("../ui/problemQuickPick");
const workspaceTarget_1 = require("../utils/workspaceTarget");
// Main command flow: search -> select -> open web -> scaffold files.
async function runSearchAndScaffoldCommand(deps) {
    const targetRootUri = await (0, workspaceTarget_1.pickTargetRootUri)();
    if (!targetRootUri) {
        vscode.window.showWarningMessage("파일을 생성할 폴더를 선택해야 합니다.");
        return;
    }
    const selectedProblem = await (0, problemQuickPick_1.showProblemQuickPick)({
        recents: deps.recentService.list(),
        search: (query, tierGroup) => deps.problemSearchService.search(query, tierGroup)
    });
    if (!selectedProblem) {
        return;
    }
    const config = vscode.workspace.getConfiguration("bojSearch");
    const languages = config.get("languages", ["py", "cpp"]);
    const outputDir = config.get("outputDir", ".");
    const openWebOnSelect = config.get("openWebOnSelect", true);
    if (openWebOnSelect) {
        await vscode.env.openExternal(vscode.Uri.parse(`https://www.acmicpc.net/problem/${selectedProblem.problemId}`));
    }
    const scaffoldResult = await deps.scaffoldService.scaffold(targetRootUri, outputDir, selectedProblem, languages);
    await deps.recentService.add(selectedProblem);
    if (scaffoldResult.created.length > 0) {
        const document = await vscode.workspace.openTextDocument(scaffoldResult.created[0]);
        await vscode.window.showTextDocument(document);
    }
    const createdCount = scaffoldResult.created.length;
    const skippedCount = scaffoldResult.skipped.length;
    vscode.window.showInformationMessage(`BOJ ${selectedProblem.problemId}: 생성 ${createdCount}개, 기존 파일 ${skippedCount}개`);
}
//# sourceMappingURL=searchAndScaffoldCommand.js.map