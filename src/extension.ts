import * as vscode from "vscode";
import { SolvedAcClient } from "./clients/solvedAcClient";
import { ProblemDetailPanel } from "./panels/problemDetailPanel";
import { ProblemSearchService } from "./services/problemSearchService";
import { ProblemDetailService } from "./services/problemDetailService";
import { RecentService } from "./services/recentService";
import { ScaffoldService } from "./services/scaffoldService";
import { TestCaseRunnerService } from "./services/testCaseRunnerService";
import { UserTestCaseService } from "./services/userTestCaseService";
import { BojSidebarViewProvider } from "./views/bojSidebarViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  // Manual dependency wiring keeps the architecture simple and testable.
  const solvedAcClient = new SolvedAcClient();
  const problemSearchService = new ProblemSearchService(solvedAcClient);
  const problemDetailService = new ProblemDetailService();
  const testCaseRunnerService = new TestCaseRunnerService();
  const userTestCaseService = new UserTestCaseService(context);
  const problemDetailPanel = new ProblemDetailPanel(
    problemDetailService,
    testCaseRunnerService,
    userTestCaseService
  );
  const recentService = new RecentService(context);
  const scaffoldService = new ScaffoldService();

  const sidebarProvider = new BojSidebarViewProvider({
    extensionUri: context.extensionUri,
    problemSearchService,
    recentService,
    scaffoldService,
    showProblemPanel: async (problemId: number, reveal: boolean) => {
      await problemDetailPanel.show(problemId, reveal);
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(BojSidebarViewProvider.viewType, sidebarProvider)
  );
}

export function deactivate(): void {
  // No-op.
}
