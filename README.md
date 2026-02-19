# BOJ-STARTER (VS Code Extension)

검색 중심 GUI로 BOJ 문제를 찾고, 파일을 생성하고, 테스트케이스를 바로 실행할 수 있는 확장입니다.

커맨드 팔레트 없이 Activity Bar의 `BOJ-STARTER` 아이콘에서 모든 기능을 사용할 수 있습니다.

## 1) 설치

- VS Code 확장 마켓에서 설치
- 또는 VSIX 파일로 설치

```bash
code --install-extension boj-starter-0.1.0.vsix
```

## 2) 기본 사용 흐름

1. VS Code에서 워크스페이스 폴더를 엽니다.
2. Activity Bar에서 `BOJ-STARTER` 아이콘을 클릭합니다.
3. 검색창에 문제 번호/제목/태그를 입력해 검색합니다.
4. 검색 결과에서 `문제 보기(우측)`으로 상세 패널을 엽니다.
5. `파일 생성`으로 문제 폴더와 코드 파일을 생성합니다.
6. 우측 패널에서 테스트케이스를 실행해 결과를 확인합니다.

## 3) 좌측 패널(검색/생성)

- 랭크 필터: Unrated ~ Master, All
- 정렬: 문제 번호 / 난이도 / 푼 사람 수 (오름/내림)
- 페이지 이동: 이전/다음
- 문제별 액션
  - `문제 보기(우측)`
  - `웹 열기`
  - `파일 생성`
- 최근 문제 목록 재사용 가능

## 4) 우측 패널(문제/테스트)

- 문제/입력/출력/예제 테스트케이스 표시
- 테스트 실행
  - `모든 테스트 실행`
  - 각 케이스별 `▶ 실행`
- 실행 결과
  - `SUCCESS` / `FAILED` / `ERROR`
  - expected / actual / duration(ms)

## 5) 사용자 테스트케이스 사용법

- 우측 패널의 입력/출력 에디터에 값을 작성한 뒤 `추가`
- 사용자 케이스는 `수정`, `삭제` 가능
- BOJ 기본 예제 케이스는 읽기 전용
- `취소`를 누르면 편집 상태가 초기화됩니다

## 6) 파일 생성 규칙

- 폴더명: `문제번호번 - 문제제목` (예: `1000번 - A+B`)
- 파일명: `문제번호.확장자` (예: `1000.py`, `1000.java`)
- 생성 언어는 `bojSearch.defaultLanguage` 단일 설정으로 결정

## 7) 주요 설정

- `bojSearch.defaultLanguage`: 기본 생성 언어 (`py`, `cpp`, `java` 등)
- `bojSearch.outputDir`: 생성 위치(상대 경로)
- `bojSearch.openWebOnSelect`: 문제 선택 시 웹 자동 오픈
- `bojSearch.runnerCommands`: 언어별 실행/컴파일 명령어
- `bojSearch.compilerOptions`: C/C++/Rust 컴파일 옵션

예시:

```json
{
  "bojSearch.defaultLanguage": "py",
  "bojSearch.outputDir": ".",
  "bojSearch.openWebOnSelect": true,
  "bojSearch.runnerCommands": {
    "py": "python",
    "js": "node",
    "java": "java",
    "javac": "javac",
    "cpp": "g++",
    "c": "gcc",
    "rs": "rustc",
    "go": "go",
    "kt": "kotlinc",
    "swift": "swift"
  },
  "bojSearch.compilerOptions": {
    "cpp": "-std=c++17",
    "c": "-std=c11",
    "rs": ""
  }
}
```

## 8) 자주 발생하는 문제

- `워크스페이스 폴더를 열어야 파일을 생성할 수 있습니다.`
  - VS Code에서 먼저 폴더를 연 뒤 사용하세요.
- `실행 도구를 찾지 못했습니다` / `spawn ... ENOENT`
  - 해당 언어 런타임/컴파일러 설치 후 PATH를 확인하세요.
  - 필요하면 `bojSearch.runnerCommands`에서 명령어를 직접 지정하세요.
