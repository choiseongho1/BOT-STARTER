import * as vscode from "vscode";

// Pick target root directory for scaffold output.
// - If workspace exists: select workspace folder (or the only one).
// - If no workspace: let user choose a folder directly.
export async function pickTargetRootUri(): Promise<vscode.Uri | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "생성 폴더 선택"
    });

    return picked?.[0];
  }

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri;
  }

  const picked = await vscode.window.showQuickPick(
    workspaceFolders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder
    })),
    {
      title: "문제를 생성할 워크스페이스 선택"
    }
  );

  return picked?.folder.uri;
}
