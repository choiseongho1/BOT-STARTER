import { existsSync, readdirSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execSync, spawn } from "child_process";
import * as vscode from "vscode";
import { ProblemTestCase } from "../types/problem";

interface CommandResult {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface CaseRunResult {
  index: number;
  passed: boolean;
  timedOut: boolean;
  actual: string;
  expected: string;
  error?: string;
  durationMs: number;
}

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  cases: CaseRunResult[];
}

export class TestCaseRunnerService {
  private readonly outputChannel = vscode.window.createOutputChannel("BOJ Test Results");
  private readonly timeoutMs = 3_000;
  private readonly runnerEnv: NodeJS.ProcessEnv;
  private readonly extraCommandCache = new Map<string, string[]>();

  constructor() {
    this.runnerEnv = this.buildRunnerEnv();
  }

  async runAgainstTestCases(
    filePath: string,
    testCases: ProblemTestCase[],
    targetCaseIndex?: number
  ): Promise<TestRunSummary> {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const selectedCases =
      targetCaseIndex === undefined
        ? testCases
        : testCases.filter((testCase) => testCase.index === targetCaseIndex);

    if (selectedCases.length === 0) {
      throw new Error("실행할 테스트케이스가 없습니다.");
    }

    this.outputChannel.clear();
    this.outputChannel.show(true);
    this.outputChannel.appendLine(`File: ${filePath}`);
    this.outputChannel.appendLine(`Language: .${extension}`);
    this.outputChannel.appendLine("----------------------------------------");

    const results: CaseRunResult[] = [];
    for (const testCase of selectedCases) {
      const startedAt = Date.now();
      const commandResult = await this.executeFile(filePath, extension, testCase.input);
      const durationMs = Date.now() - startedAt;

      const actual = this.normalizeOutput(commandResult.stdout);
      const expected = this.normalizeOutput(testCase.output);
      const hasRuntimeError = commandResult.code !== 0 || commandResult.timedOut;

      const caseResult: CaseRunResult = {
        index: testCase.index,
        passed: !hasRuntimeError && actual === expected,
        timedOut: commandResult.timedOut,
        actual,
        expected,
        durationMs
      };

      if (hasRuntimeError) {
        caseResult.error = this.formatExecutionError(commandResult, extension);
      }

      results.push(caseResult);
      this.printCaseResult(caseResult);
    }

    const passed = results.filter((item) => item.passed).length;
    const errors = results.filter((item) => Boolean(item.error)).length;
    const summary: TestRunSummary = {
      total: results.length,
      passed,
      failed: results.length - passed,
      errors,
      cases: results
    };

    this.outputChannel.appendLine("----------------------------------------");
    this.outputChannel.appendLine(
      `Summary: ${summary.passed}/${summary.total} passed, failed=${summary.failed}, errors=${summary.errors}`
    );

    return summary;
  }

  private printCaseResult(result: CaseRunResult): void {
    this.outputChannel.appendLine(`Case #${result.index} (${result.durationMs}ms)`);
    if (result.passed) {
      this.outputChannel.appendLine("  ✅ PASS");
    } else if (result.error) {
      this.outputChannel.appendLine(`  ❗ ERROR: ${result.error}`);
      this.outputChannel.appendLine(`  expected: ${result.expected}`);
    } else {
      this.outputChannel.appendLine("  ❌ FAIL");
      this.outputChannel.appendLine(`  expected: ${result.expected}`);
      this.outputChannel.appendLine(`  actual  : ${result.actual}`);
    }
  }

  private async executeFile(
    filePath: string,
    extension: string,
    input: string
  ): Promise<CommandResult> {
    const cwd = this.getRunnerCwd(filePath);
    const commandMap = this.getCommandMap();
    const compileOptions = this.getCompileOptions();

    if (extension === "py") {
      return this.runWithFallback(
        "py",
        this.getCommandCandidates(commandMap, "py", [
          process.platform === "win32" ? "python" : "python3",
          "py",
          "python3"
        ]),
        [filePath],
        cwd,
        input
      );
    }

    if (extension === "js") {
      return this.runWithFallback(
        "js",
        this.getCommandCandidates(commandMap, "js", ["node"]),
        [filePath],
        cwd,
        input
      );
    }

    if (extension === "java") {
      // First try Java single-file source execution (Java 11+).
      const javaCandidates = this.getCommandCandidates(commandMap, "java", ["java"]);
      const javacCandidates = this.getCommandCandidates(commandMap, "javac", ["javac"]);

      const sourceRun = await this.runWithFallback("java", javaCandidates, [filePath], cwd, input);
      if (sourceRun.code === 0 && !sourceRun.timedOut) {
        return sourceRun;
      }

      if (this.looksLikeCommandNotFound(sourceRun.stderr, sourceRun.command)) {
        return sourceRun;
      }

      // Fallback: classic compile + run flow for older runtimes.
      const compile = await this.runWithFallback(
        "javac",
        javacCandidates,
        ["-encoding", "UTF-8", filePath],
        cwd
      );
      if (compile.code !== 0 || compile.timedOut) {
        return compile;
      }

      const mainClass = this.detectJavaMainClass(await fs.readFile(filePath, "utf8")) ?? "Main";
      return this.runWithFallback(
        "java",
        javaCandidates,
        ["-cp", path.dirname(filePath), mainClass],
        cwd,
        input
      );
    }

    if (extension === "cpp" || extension === "c" || extension === "rs") {
      const executablePath = this.getTempExecutablePath(filePath);
      const compilerCandidates =
        extension === "cpp"
          ? this.getCommandCandidates(commandMap, "cpp", ["g++", "clang++"])
          : extension === "c"
            ? this.getCommandCandidates(commandMap, "c", ["gcc", "clang"])
            : this.getCommandCandidates(commandMap, "rs", ["rustc"]);

      const optionText = compileOptions[extension] ?? "";
      const optionArgs = optionText
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);

      const compile = await this.runWithFallback(
        extension,
        compilerCandidates,
        [...optionArgs, filePath, "-o", executablePath],
        cwd
      );
      if (compile.code !== 0 || compile.timedOut) {
        await this.safeRemove(executablePath);
        return compile;
      }

      const run = await this.runCommand(executablePath, [], cwd, input);
      await this.safeRemove(executablePath);
      return run;
    }

    if (extension === "go") {
      return this.runWithFallback(
        "go",
        this.getCommandCandidates(commandMap, "go", ["go"]),
        ["run", filePath],
        cwd,
        input
      );
    }

    if (extension === "kt") {
      const jarPath = this.getTempJarPath(filePath);
      const kotlincCandidates = this.getCommandCandidates(commandMap, "kt", ["kotlinc"]);
      const javaCandidates = this.getCommandCandidates(commandMap, "java", ["java"]);

      const compile = await this.runWithFallback(
        "kt",
        kotlincCandidates,
        [filePath, "-include-runtime", "-d", jarPath],
        cwd
      );
      if (compile.code !== 0 || compile.timedOut) {
        await this.safeRemove(jarPath);
        return compile;
      }

      const run = await this.runWithFallback("java", javaCandidates, ["-jar", jarPath], cwd, input);
      await this.safeRemove(jarPath);
      return run;
    }

    if (extension === "swift") {
      return this.runWithFallback(
        "swift",
        this.getCommandCandidates(commandMap, "swift", ["swift"]),
        [filePath],
        cwd,
        input
      );
    }

    throw new Error(`현재 확장자(.${extension})의 테스트 실행은 아직 지원되지 않습니다.`);
  }

  private runCommand(
    command: string,
    args: string[],
    cwd: string,
    input: string = ""
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: this.runnerEnv
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (error: Error) => {
        clearTimeout(timer);
        resolve({
          command,
          code: 1,
          stdout,
          stderr: `${stderr}\n${error.message}`,
          timedOut
        });
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({
          command,
          code: code ?? 1,
          stdout,
          stderr,
          timedOut
        });
      });

      if (input.length > 0) {
        child.stdin.write(input);
      }
      child.stdin.end();
    });
  }

  private getTempExecutablePath(filePath: string): string {
    const baseName = path.basename(filePath, path.extname(filePath));
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const fileName = `${baseName}_boj_${suffix}${process.platform === "win32" ? ".exe" : ""}`;
    return path.join(os.tmpdir(), fileName);
  }

  private getTempJarPath(filePath: string): string {
    const baseName = path.basename(filePath, path.extname(filePath));
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return path.join(os.tmpdir(), `${baseName}_boj_${suffix}.jar`);
  }

  private async safeRemove(targetPath: string): Promise<void> {
    try {
      await fs.rm(targetPath, { force: true });
    } catch {
      // ignore cleanup failure
    }
  }

  private normalizeOutput(value: string): string {
    return value
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+$/g, ""))
      .join("\n")
      .trim();
  }

  private detectJavaMainClass(sourceCode: string): string | undefined {
    // Support both `class Main` and `public class Main`.
    const match = sourceCode.match(/(?:public\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/);
    return match?.[1];
  }

  private looksLikeCommandNotFound(stderr: string, command: string): boolean {
    const lowered = stderr.toLowerCase();
    const normalizedCommand = command.toLowerCase();
    return (
      lowered.includes("enoent") ||
      lowered.includes(`${normalizedCommand} is not recognized`) ||
      lowered.includes(`${normalizedCommand}: not found`) ||
      lowered.includes("command not found")
    );
  }

  private formatExecutionError(result: CommandResult, extension: string): string {
    if (result.timedOut) {
      return `시간 초과 (${this.timeoutMs}ms)`;
    }

    if (this.looksLikeCommandNotFound(result.stderr, result.command)) {
      const hint = this.getToolInstallHint(extension, result.command);
      return `실행 도구를 찾지 못했습니다: ${result.command}. ${hint}`;
    }

    return result.stderr.trim() || `비정상 종료 (code=${result.code})`;
  }

  private getToolInstallHint(extension: string, missingCommand: string): string {
    const common =
      "해당 언어 런타임/컴파일러를 설치하고 PATH 환경변수에 실행 파일 경로를 추가해 주세요.";

    const extensionKey = extension.toLowerCase();
    if (extensionKey === "py") {
      return "Python 설치 후 python/python3 명령이 동작해야 합니다.";
    }

    if (extensionKey === "js") {
      return "Node.js 설치 후 node 명령이 동작해야 합니다.";
    }

    if (extensionKey === "java") {
      return "JDK 설치 후 java/javac 명령이 동작해야 합니다.";
    }

    if (extensionKey === "cpp") {
      return "C++ 컴파일러(g++) 설치 후 g++ 명령이 동작해야 합니다.";
    }

    if (extensionKey === "c") {
      return "C 컴파일러(gcc) 설치 후 gcc 명령이 동작해야 합니다.";
    }

    if (extensionKey === "rs") {
      return "Rust 설치 후 rustc 명령이 동작해야 합니다.";
    }

    if (extensionKey === "go") {
      return "Go 설치 후 go 명령이 동작해야 합니다.";
    }

    if (extensionKey === "kt") {
      return "Kotlin(kotlinc)과 Java(java)가 설치되어야 합니다.";
    }

    if (extensionKey === "swift") {
      return "Swift 설치 후 swift 명령이 동작해야 합니다.";
    }

    return `${common} (missing: ${missingCommand})`;
  }

  private toMissingCommandResult(languageKey: string, tried: string[]): CommandResult {
    const primary = tried[0] ?? languageKey;
    const hint = this.getToolInstallHint(languageKey, primary);
    const triedText = tried.length > 0 ? `시도한 명령: ${tried.join(", ")}` : "";
    return {
      command: primary,
      code: 1,
      stdout: "",
      stderr: `실행 명령어를 찾지 못했습니다. ${hint}${triedText ? `\n${triedText}` : ""}`,
      timedOut: false
    };
  }

  private getCommandCandidates(
    commandMap: Partial<Record<string, string>>,
    key: string,
    fallbackCandidates: string[]
  ): string[] {
    const candidates: string[] = [];

    const configured = commandMap[key]?.trim();
    if (configured) {
      candidates.push(configured);
    }

    const base = fallbackCandidates.filter(Boolean);
    const extra = this.getExtraCandidates(key);
    return Array.from(new Set([...candidates, ...base, ...extra]));
  }

  private async runWithFallback(
    languageKey: string,
    candidates: string[],
    args: string[],
    cwd: string,
    input: string = ""
  ): Promise<CommandResult> {
    const tried: string[] = [];
    let lastResult: CommandResult | undefined;

    for (const candidate of candidates) {
      const parsed = this.parseCommand(candidate);
      if (!parsed.command) {
        continue;
      }

      tried.push(candidate);
      this.outputChannel.appendLine(`Try [${languageKey}] => ${parsed.command} ${[...parsed.args, ...args].join(" ")}`);
      const result = await this.runCommand(parsed.command, [...parsed.args, ...args], cwd, input);
      lastResult = result;

      if (!this.looksLikeCommandNotFound(result.stderr, result.command)) {
        return result;
      }
    }

    return lastResult ?? this.toMissingCommandResult(languageKey, tried);
  }

  private parseCommand(commandText: string): { command?: string; args: string[] } {
    const trimmed = commandText.trim();
    if (!trimmed) {
      return { args: [] };
    }

    if (existsSync(trimmed)) {
      return { command: trimmed, args: [] };
    }

    const tokens = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    if (tokens.length === 0) {
      return { args: [] };
    }

    const normalizedTokens = tokens.map((token) =>
      token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token
    );

    return {
      command: normalizedTokens[0],
      args: normalizedTokens.slice(1)
    };
  }

  private getCommandMap(): Partial<Record<string, string>> {
    const config = vscode.workspace.getConfiguration("bojSearch");
    const map = config.get<Record<string, string>>("runnerCommands", {});
    return map ?? {};
  }

  private getCompileOptions(): Record<string, string> {
    const config = vscode.workspace.getConfiguration("bojSearch");
    const options = config.get<Record<string, string>>("compilerOptions", {});
    const merged = { ...(options ?? {}) };

    // Compatibility: if user already configured BOJ-Tester options, reuse them.
    const legacy = vscode.workspace.getConfiguration("BOJ-Tester");
    if (!merged.cpp) {
      merged.cpp = legacy.get<string>("customCommandOption.cpp", "") ?? "";
    }
    if (!merged.c) {
      merged.c = legacy.get<string>("customCommandOption.c", "") ?? "";
    }

    return merged;
  }

  private buildRunnerEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    if (process.platform === "darwin") {
      // VS Code GUI launch on macOS can miss shell PATH.
      try {
        const shellPath = execSync('zsh -i -c "printenv PATH"', {
          encoding: "utf8"
        }).trim();
        if (shellPath.length > 0) {
          const current = env.PATH ?? "";
          env.PATH = current.length > 0 ? `${current}:${shellPath}` : shellPath;
        }
      } catch {
        // keep default env
      }
    }

    return env;
  }

  private getRunnerCwd(filePath: string): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      return workspaceRoot;
    }

    return path.dirname(filePath);
  }

  private getExtraCandidates(key: string): string[] {
    const cached = this.extraCommandCache.get(key);
    if (cached) {
      return cached;
    }

    let candidates: string[] = [];

    if (process.platform === "win32" && (key === "java" || key === "javac")) {
      candidates = this.collectWindowsJdkExecutables(key);
    }

    this.extraCommandCache.set(key, candidates);
    return candidates;
  }

  private collectWindowsJdkExecutables(key: "java" | "javac"): string[] {
    const executable = `${key}.exe`;
    const results: string[] = [];

    const javaConfig = vscode.workspace.getConfiguration("java");
    const javaHomeFromLs = javaConfig.get<string>("jdt.ls.java.home");
    const javaHomeFromConfig = javaConfig.get<string>("home");
    const javaHomes = [javaHomeFromLs, javaHomeFromConfig].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );

    for (const home of javaHomes) {
      const candidate = path.join(home, "bin", executable);
      if (existsSync(candidate)) {
        results.push(candidate);
      }
    }

    const runtimes = javaConfig.get<unknown[]>("configuration.runtimes", []);
    if (Array.isArray(runtimes)) {
      for (const runtime of runtimes) {
        if (!runtime || typeof runtime !== "object") {
          continue;
        }

        const runtimePath = (runtime as Record<string, unknown>).path;
        if (typeof runtimePath !== "string" || runtimePath.trim().length === 0) {
          continue;
        }

        const candidate = path.join(runtimePath, "bin", executable);
        if (existsSync(candidate)) {
          results.push(candidate);
        }
      }
    }

    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
      const fromJavaHome = path.join(javaHome, "bin", executable);
      if (existsSync(fromJavaHome)) {
        results.push(fromJavaHome);
      }
    }

    const homeCandidates = [process.env.USERPROFILE, process.env.HOME, os.homedir()].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );

    for (const home of homeCandidates) {
      const jdksRoot = path.join(home, ".jdks");
      if (!existsSync(jdksRoot)) {
        continue;
      }

      const names = readdirSync(jdksRoot)
        .filter((name) => !name.startsWith("."))
        .sort((left, right) => right.localeCompare(left));

      for (const name of names) {
        const candidate = path.join(jdksRoot, name, "bin", executable);
        if (existsSync(candidate)) {
          results.push(candidate);
        }
      }
    }

    const programFiles = process.env["ProgramFiles"];
    if (programFiles) {
      const parentCandidates = [
        path.join(programFiles, "Java"),
        path.join(programFiles, "Eclipse Adoptium")
      ];

      for (const parent of parentCandidates) {
        if (!existsSync(parent)) {
          continue;
        }

        const names = readdirSync(parent).sort((left, right) => right.localeCompare(left));
        for (const name of names) {
          const candidate = path.join(parent, name, "bin", executable);
          if (existsSync(candidate)) {
            results.push(candidate);
          }
        }
      }
    }

    return Array.from(new Set(results));
  }
}
