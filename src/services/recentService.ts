import * as vscode from "vscode";
import { ProblemSummary } from "../types/problem";

const STORAGE_KEY = "bojSearch.recents";

export class RecentService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  // Read recent entries from global extension storage.
  list(): ProblemSummary[] {
    const stored = this.context.globalState.get<ProblemSummary[]>(STORAGE_KEY);
    return stored ?? [];
  }

  // Insert or move selected problem to top, then trim with maxRecent.
  async add(problem: ProblemSummary): Promise<void> {
    const maxRecent = vscode.workspace
      .getConfiguration("bojSearch")
      .get<number>("maxRecent", 50);

    const current = this.list().filter((entry) => entry.problemId !== problem.problemId);
    current.unshift(problem);

    await this.context.globalState.update(STORAGE_KEY, current.slice(0, maxRecent));
  }

  async clear(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, []);
  }
}
