import * as vscode from "vscode";

export interface UserTestCase {
  id: string;
  input: string;
  output: string;
  createdAt: number;
  updatedAt: number;
}

type UserTestCaseStore = Record<string, UserTestCase[]>;

const STORAGE_KEY = "bojSearch.userTestCases.v1";

export class UserTestCaseService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  list(problemId: number): UserTestCase[] {
    const store = this.readStore();
    const value = store[String(problemId)] ?? [];
    return [...value].sort((left, right) => left.createdAt - right.createdAt);
  }

  async add(problemId: number, input: string, output: string): Promise<UserTestCase[]> {
    const store = this.readStore();
    const key = String(problemId);
    const now = Date.now();

    const nextCase: UserTestCase = {
      id: this.generateId(),
      input: this.normalizeText(input),
      output: this.normalizeText(output),
      createdAt: now,
      updatedAt: now
    };

    const current = store[key] ?? [];
    store[key] = [...current, nextCase];
    await this.context.globalState.update(STORAGE_KEY, store);
    return this.list(problemId);
  }

  async update(
    problemId: number,
    caseId: string,
    input: string,
    output: string
  ): Promise<UserTestCase[]> {
    const store = this.readStore();
    const key = String(problemId);
    const current = store[key] ?? [];

    let updated = false;
    store[key] = current.map((testCase) => {
      if (testCase.id !== caseId) {
        return testCase;
      }

      updated = true;

      return {
        ...testCase,
        input: this.normalizeText(input),
        output: this.normalizeText(output),
        updatedAt: Date.now()
      };
    });

    if (!updated) {
      throw new Error("수정할 사용자 테스트케이스를 찾지 못했습니다.");
    }

    await this.context.globalState.update(STORAGE_KEY, store);
    return this.list(problemId);
  }

  async remove(problemId: number, caseId: string): Promise<UserTestCase[]> {
    const store = this.readStore();
    const key = String(problemId);
    const current = store[key] ?? [];
    const next = current.filter((testCase) => testCase.id !== caseId);
    if (next.length === current.length) {
      throw new Error("삭제할 사용자 테스트케이스를 찾지 못했습니다.");
    }

    store[key] = next;
    await this.context.globalState.update(STORAGE_KEY, store);
    return this.list(problemId);
  }

  private readStore(): UserTestCaseStore {
    return this.context.globalState.get<UserTestCaseStore>(STORAGE_KEY, {});
  }

  private normalizeText(value: string): string {
    return value.replace(/\r/g, "");
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
