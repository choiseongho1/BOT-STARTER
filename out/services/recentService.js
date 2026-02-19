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
exports.RecentService = void 0;
const vscode = __importStar(require("vscode"));
const STORAGE_KEY = "bojSearch.recents";
class RecentService {
    context;
    constructor(context) {
        this.context = context;
    }
    // Read recent entries from global extension storage.
    list() {
        const stored = this.context.globalState.get(STORAGE_KEY);
        return stored ?? [];
    }
    // Insert or move selected problem to top, then trim with maxRecent.
    async add(problem) {
        const maxRecent = vscode.workspace
            .getConfiguration("bojSearch")
            .get("maxRecent", 50);
        const current = this.list().filter((entry) => entry.problemId !== problem.problemId);
        current.unshift(problem);
        await this.context.globalState.update(STORAGE_KEY, current.slice(0, maxRecent));
    }
    async clear() {
        await this.context.globalState.update(STORAGE_KEY, []);
    }
}
exports.RecentService = RecentService;
//# sourceMappingURL=recentService.js.map