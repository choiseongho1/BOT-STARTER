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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const solvedAcClient_1 = require("./clients/solvedAcClient");
const problemDetailPanel_1 = require("./panels/problemDetailPanel");
const problemSearchService_1 = require("./services/problemSearchService");
const problemDetailService_1 = require("./services/problemDetailService");
const recentService_1 = require("./services/recentService");
const scaffoldService_1 = require("./services/scaffoldService");
const testCaseRunnerService_1 = require("./services/testCaseRunnerService");
const userTestCaseService_1 = require("./services/userTestCaseService");
const bojSidebarViewProvider_1 = require("./views/bojSidebarViewProvider");
function activate(context) {
    // Manual dependency wiring keeps the architecture simple and testable.
    const solvedAcClient = new solvedAcClient_1.SolvedAcClient();
    const problemSearchService = new problemSearchService_1.ProblemSearchService(solvedAcClient);
    const problemDetailService = new problemDetailService_1.ProblemDetailService();
    const testCaseRunnerService = new testCaseRunnerService_1.TestCaseRunnerService();
    const userTestCaseService = new userTestCaseService_1.UserTestCaseService(context);
    const problemDetailPanel = new problemDetailPanel_1.ProblemDetailPanel(problemDetailService, testCaseRunnerService, userTestCaseService);
    const recentService = new recentService_1.RecentService(context);
    const scaffoldService = new scaffoldService_1.ScaffoldService();
    const sidebarProvider = new bojSidebarViewProvider_1.BojSidebarViewProvider({
        extensionUri: context.extensionUri,
        problemSearchService,
        recentService,
        scaffoldService,
        showProblemPanel: async (problemId, reveal) => {
            await problemDetailPanel.show(problemId, reveal);
        }
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(bojSidebarViewProvider_1.BojSidebarViewProvider.viewType, sidebarProvider));
}
function deactivate() {
    // No-op.
}
//# sourceMappingURL=extension.js.map