import * as vscode from "vscode";
import { ProblemSummary } from "../types/problem";
import { renderTemplate } from "../templates/templateRegistry";

export interface ScaffoldResult {
  created: vscode.Uri[];
  skipped: vscode.Uri[];
}

export class ScaffoldService {
  // Create a problem directory like "1000번 - A+B" and scaffold source files inside it.
  async scaffold(
    targetRootUri: vscode.Uri,
    outputDir: string,
    problem: ProblemSummary,
    language: string
  ): Promise<ScaffoldResult> {
    const normalizedLanguage = language.trim().toLowerCase();

    if (!normalizedLanguage) {
      throw new Error("No scaffold language is configured.");
    }

    const baseUri = vscode.Uri.joinPath(targetRootUri, outputDir);
    await vscode.workspace.fs.createDirectory(baseUri);

    const problemDirectoryName = this.buildProblemDirectoryName(problem);
    const problemDirectoryUri = vscode.Uri.joinPath(baseUri, problemDirectoryName);
    await vscode.workspace.fs.createDirectory(problemDirectoryUri);

    const created: vscode.Uri[] = [];
    const skipped: vscode.Uri[] = [];

    const fileName = this.resolveFileName(problem.problemId, normalizedLanguage);
    const fileUri = vscode.Uri.joinPath(problemDirectoryUri, fileName);
    const exists = await this.exists(fileUri);

    if (exists) {
      skipped.push(fileUri);
      return { created, skipped };
    }

    const content = renderTemplate(problem, normalizedLanguage);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
    created.push(fileUri);

    return { created, skipped };
  }

  private async exists(fileUri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(fileUri);
      return true;
    } catch {
      return false;
    }
  }

  private buildProblemDirectoryName(problem: ProblemSummary): string {
    const safeTitle = this.sanitizePathSegment(problem.title);
    const suffix = safeTitle.length > 0 ? ` - ${safeTitle}` : "";
    return `${problem.problemId}번${suffix}`;
  }

  private resolveFileName(problemId: number, language: string): string {
    return `${problemId}.${language}`;
  }

  private sanitizePathSegment(value: string): string {
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
