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
exports.ScaffoldService = void 0;
const vscode = __importStar(require("vscode"));
const templateRegistry_1 = require("../templates/templateRegistry");
class ScaffoldService {
    // Create a problem directory like "1000번 - A+B" and scaffold source files inside it.
    async scaffold(targetRootUri, outputDir, problem, language) {
        const normalizedLanguage = language.trim().toLowerCase();
        if (!normalizedLanguage) {
            throw new Error("No scaffold language is configured.");
        }
        const baseUri = vscode.Uri.joinPath(targetRootUri, outputDir);
        await vscode.workspace.fs.createDirectory(baseUri);
        const problemDirectoryName = this.buildProblemDirectoryName(problem);
        const problemDirectoryUri = vscode.Uri.joinPath(baseUri, problemDirectoryName);
        await vscode.workspace.fs.createDirectory(problemDirectoryUri);
        const created = [];
        const skipped = [];
        const fileName = this.resolveFileName(problem.problemId, normalizedLanguage);
        const fileUri = vscode.Uri.joinPath(problemDirectoryUri, fileName);
        const exists = await this.exists(fileUri);
        if (exists) {
            skipped.push(fileUri);
            return { created, skipped };
        }
        const content = (0, templateRegistry_1.renderTemplate)(problem, normalizedLanguage);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
        created.push(fileUri);
        return { created, skipped };
    }
    async exists(fileUri) {
        try {
            await vscode.workspace.fs.stat(fileUri);
            return true;
        }
        catch {
            return false;
        }
    }
    buildProblemDirectoryName(problem) {
        const safeTitle = this.sanitizePathSegment(problem.title);
        const suffix = safeTitle.length > 0 ? ` - ${safeTitle}` : "";
        return `${problem.problemId}번${suffix}`;
    }
    resolveFileName(problemId, language) {
        return `${problemId}.${language}`;
    }
    sanitizePathSegment(value) {
        const replaced = value
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[. ]+$/g, "");
        if (!replaced) {
            return "problem";
        }
        const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
        return windowsReserved.test(replaced) ? `_${replaced}` : replaced;
    }
}
exports.ScaffoldService = ScaffoldService;
//# sourceMappingURL=scaffoldService.js.map