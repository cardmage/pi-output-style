# `pi-output-style` 확장(Extension) 구현 계획

Claude Code의 **Output Styles** 기능을 Pi(`@earendil-works/pi-coding-agent`)에 1:1로 이식하고, Pi의 구조화된 시스템 프롬프트 섹션(`systemPromptOptions.sections`) 및 UI 컴포넌트와 자연스럽게 통합하는 계획입니다.

---

## 1. 핵심 기능 요약 (Claude Code Output Styles 패리티)

1. **3가지 빌트인(Built-in) 스타일 제공**
   - **`Default`**: Pi의 기본 소프트웨어 엔지니어링 에이전트 동작 유지 (추가 스타일 프롬프트 없음).
   - **`Explanatory`**: 코딩 작업을 수행하면서 코드베이스 패턴, 설계 결정, 아키텍처 맥락을 설명하는 교육적 인사이트 박스(`★ Insight ─────────────────────────────────────`)를 함께 제공.
   - **`Learning`**: 사용자와 함께 코딩하는 Learn-by-doing 모드. 설명 인사이트와 함께 핵심 비즈니스 로직이나 설계 지점을 `TODO(human)` 마커로 남겨 사용자가 직접 작성하도록 유도하고 리뷰.

2. **커스텀 Output Style 마크다운(`.md`) 지원 및 호환성**
   - YAML Frontmatter(`name`, `description`, `keep-coding-instructions`) + Markdown 본문 형식 100% 지원.
   - **탐색 경로 (우선순위 순)**:
     1. 프로젝트: `.pi/output-styles/*.md` 및 `.claude/output-styles/*.md` (기존 Claude Code 스타일 파일 무수정 호환)
     2. 글로벌(유저): `~/.pi/agent/output-styles/*.md` 및 `~/.claude/output-styles/*.md`

3. **`keep-coding-instructions` 동작 완벽 재현**
   - Pi의 `before_agent_start` 훅과 `BuildSystemPromptOptions`의 동작 방식을 활용:
     - **`keep-coding-instructions: true`** (빌트인 `Explanatory`, `Learning` 포함):
       - Pi의 기본 `preamble`, `<tools>`, `<rules>`, `<docs>`를 모두 유지하면서 `event.systemPromptOptions.sections.output_style` 섹션에 스타일 지침을 주입.
     - **`keep-coding-instructions: false`** (커스텀 스타일 기본값):
       - 코딩 전용 지침(`You are an expert coding assistant...`, `Be concise...` 등 코딩 rules)을 제거하고 커스텀 스타일을 메인 프롬프트로 설정하되, 도구(`tools`), 프로젝트 컨텍스트(`project_context`), 스킬(`skills`), 작업 경로(`cwd`)는 그대로 사용할 수 있도록 구성.

4. **슬래시 명령어, CLI 플래그 & TUI 연동**
   - `/output-style` : 인터랙티브 선택 메뉴(`ctx.ui.select`)로 스타일 선택 후 적용 범위(현재 세션 / 프로젝트 기본값 / 글로벌 기본값) 지정 (자동완성 지원).
   - `/output-style <style-name> [--project|--global|--session]` : 추가 팝업 없이 즉시 해당 스타일로 전환 (예: `/output-style explanatory`, `/output-style default --project`).
   - `/output-style:new [설명]` (또는 `/output-style new <설명>`) : 사용자의 설명을 바탕으로 마크다운 스타일 파일을 생성하고 에디터(`ctx.ui.editor`)로 검토 후 `.pi/output-styles/` 또는 `~/.pi/agent/output-styles/`에 저장.
   - `--output-style <style-name>` : CLI 플래그(`pi.registerFlag`)를 지원하여 헤드리스/서브에이전트/스크립트 실행 시에도 스타일 지정 가능.
   - **하단 상태바(Footer Status)**: `Default`가 아닌 스타일이 활성화되어 있을 때 `ctx.ui.setStatus("output-style", "Style: Explanatory")` 표시 (`Default` 전환 시 `undefined`로 클리어).

5. **세션 및 설정 영속성 (Persistence) & 우선순위**
   - **세션 단위 브랜치 복원**: `pi.appendEntry("output-style", { styleId })`를 기록하여 `session_start`(`startup`, `reload`, `new`, `resume`, `fork`) 및 **`session_tree`(`/tree` 브랜치 이동)** 시 현재 브랜치의 활성 스타일을 정확히 복원.
   - **프로젝트/글로벌 기본값 저장 및 Claude Code 설정 호환**:
     - `.pi/output-style.json` (프로젝트) 또는 `~/.pi/agent/output-style.json` (글로벌) 설정 파일에 기본 활성 스타일 저장.
     - `.pi/output-style.json`이 없을 경우 `.claude/settings.local.json` → `.claude/settings.json` (및 글로벌 `~/.claude/settings.json`)의 `"outputStyle"` 필드를 읽기 전용 Fallback으로 참조하여 기존 Claude Code 프로젝트와 무설정 호환.
   - **신뢰되지 않은 프로젝트 보호(`ctx.isProjectTrusted()`)**:
     - 프롬프트 인젝션 방지를 위해 프로젝트 로컬 스타일(`.pi/output-styles/`, `.claude/output-styles/`)과 프로젝트 설정(`.pi/output-style.json`, `.claude/settings*.json`)은 `ctx.isProjectTrusted()`가 `true`일 때만 로드 및 적용.

---

## 2. 디렉터리 및 모듈 구조

`C:/Users/hc2/orca/projects/pi-output-style` 내에 다음과 같이 구성합니다:

```text
pi-output-style/
├── package.json              # Pi package 매니페스트 ("pi": { "extensions": ["./src/index.ts"] })
├── tsconfig.json             # TypeScript 설정
├── README.md                 # 사용법 및 커스텀 스타일 작성 가이드
├── docs/
│   └── concept/
│       └── plan.md           # 구현 계획 문서
├── src/
│   ├── index.ts              # Extension 엔트리포인트 (명령어, 훅, 상태바 등록)
│   ├── types.ts              # OutputStyle 인터페이스 및 설정 타입 정의
│   ├── builtin-styles.ts     # Default, Explanatory, Learning 프롬프트 정의
│   ├── loader.ts             # .pi/ 및 .claude/ 의 output-styles/*.md 로드 & Frontmatter 파서
│   ├── state.ts              # 설정 파일(글로벌/프로젝트) 및 세션 엔트리 상태 관리
│   └── generator.ts          # /output-style:new 실행 시 새 스타일 .md 템플릿/모델 생성기
└── test/
    ├── loader.test.ts        # Frontmatter(CRLF/무헤더 포함) 파싱, 신뢰 가드 및 우선순위 테스트
    ├── prompt.test.ts        # keep-coding-instructions true/false 시 프롬프트 및 도구 가이드라인 변환 테스트
    └── state.test.ts         # CLI 플래그 / 세션 브랜치 / 프로젝트 / 글로벌 설정 우선순위 및 Fallback 테스트
```

---

## 3. 핵심 모듈별 상세 설계

### 3.1. `src/types.ts` — 데이터 모델
```ts
export interface OutputStyle {
  id: string;                      // 파일명 기반 slug 또는 빌트인 id (예: "default", "explanatory", "learning")
  name: string;                    // 표시 이름 (Frontmatter `name` 또는 파일명)
  description: string;             // 설명 (Frontmatter `description`)
  keepCodingInstructions: boolean; // Frontmatter `keep-coding-instructions` (커스텀 기본값: false, 빌트인: true)
  prompt: string;                  // 마크다운 본문 (시스템 프롬프트에 주입할 지침)
  source: "builtin" | "user-pi" | "user-claude" | "project-pi" | "project-claude";
  filePath?: string;
}
```

### 3.2. `src/builtin-styles.ts` — 빌트인 스타일 프롬프트
Claude Code의 실제 빌트인 스타일 동작과 동일하게 작성합니다:
- **`Default`**:
  - `description`: `"Standard software-engineering assistant tuned for efficient, concise work"`
  - `prompt`: `""` (기본 Pi 프롬프트 그대로 사용)
- **`Explanatory`**:
  - `description`: `"Educational insights explaining implementation choices and codebase patterns"`
  - `keepCodingInstructions`: `true`
  - `prompt`: 작업 전후에 코드베이스의 설계 패턴, 아키텍처 결정, 트레이드오프를 설명하는 인사이트 블록을 출력하도록 지시:
    ```markdown
    `★ Insight ─────────────────────────────────────`
    [2-3 key educational points specific to the codebase and implementation]
    `─────────────────────────────────────────────────`
    ```
- **`Learning`**:
  - `description`: `"Collaborative learn-by-doing mode with TODO(human) markers and insights"`
  - `keepCodingInstructions`: `true`
  - `prompt`:
    - Explanatory의 `★ Insight` 기능을 동일하게 포함.
    - 보일러플레이트와 구조는 에이전트가 작성하되, 핵심 비즈니스 로직/설계/트레이드오프가 담긴 코드 조각(5~15줄 내외)은 파일 내에 `TODO(human)` 주석으로 비워둠.
    - **핵심 제약**: `TODO(human)` 마커를 배치한 직후에는 에이전트가 스스로 코드를 채우지 않고 **즉시 턴을 종료(Stop and wait)**하며, 사용자에게 무엇을 어떻게 구현하면 되는지 가이드를 안내. 이후 사용자가 코드를 작성하고 응답하면 이를 리뷰 및 피드백한 뒤 다음 단계로 진행.

### 3.3. `src/loader.ts` & `src/state.ts` — 마크다운 파서, 탐색기 및 상태 우선순위
- **YAML Frontmatter 파서 (`loader.ts`)**:
  - 외부 의존성 없이 가벼운 파서 구현 (`---` 블록에서 `name`, `description`, `keep-coding-instructions` 추출).
  - Windows CRLF(`\r\n`) 및 LF(`\n`) 줄바꿈 모두 지원, 따옴표 감싸기(`"..."`, `'...'`) 및 불리언 문자열(`true` / `"true"`) 처리.
  - Frontmatter가 없는 일반 마크다운 파일도 에러 없이 로드 (`name`: 파일명, `description`: `""`, `keepCodingInstructions`: `false`, `prompt`: 전체 본문).
- **탐색 순서 및 신뢰 가드** (뒤에 로드된 항목이 같은 `id`를 덮어씀):
  1. 빌트인 (`default`, `explanatory`, `learning`)
  2. `~/.claude/output-styles/*.md`
  3. `~/.pi/agent/output-styles/*.md`
  4. `<cwd>/.claude/output-styles/*.md` (`ctx.isProjectTrusted() === true`일 때만 로드)
  5. `<cwd>/.pi/output-styles/*.md` (`ctx.isProjectTrusted() === true`일 때만 로드)
- **실시간 리로드**:
  - 세션 도중 스타일 `.md` 파일이 추가·수정될 수 있으므로 `/output-style` 호출 시점과 `before_agent_start` 시점에 스타일 목록(또는 활성 스타일 파일)을 재스캔하여 `/reload` 없이 즉시 반영.
- **활성 스타일 결정 우선순위 (`state.ts`)**:
  1. `--output-style <name>` CLI 플래그 (`pi.getFlag("output-style")`)
  2. 현재 세션 브랜치(`ctx.sessionManager.getBranch()`)의 가장 마지막 `"output-style"` 커스텀 엔트리
  3. 프로젝트 설정 (`ctx.isProjectTrusted()`일 때): `.pi/output-style.json` → 없을 경우 `.claude/settings.local.json` 및 `.claude/settings.json`의 `"outputStyle"` 필드
  4. 글로벌 설정: `~/.pi/agent/output-style.json` → 없을 경우 `~/.claude/settings.json`의 `"outputStyle"` 필드
  5. 기본값: `"default"`
  - *Fallback 처리*: 저장된 스타일 ID/이름이 삭제되어 존재하지 않을 경우 `"default"`로 폴백하고 `ctx.hasUI`일 때 경고 알림(`ctx.ui.notify`) 표시.

### 3.4. `src/index.ts` — Pi 라이프사이클 & 프롬프트 주입 (`before_agent_start`)
Pi의 `system-prompt.ts`는 `customPrompt`가 설정되면 기본 코딩 `preamble`, `tools`, `rules`, `docs`를 생략하며, `_prepareRun()`은 `before_agent_start` 실행 이후에야 `selectedTools`를 동기화합니다. 이를 고려하여 다음과 같이 정교하게 처리합니다:

1. **스타일이 `default`인 경우**:
   - `delete event.systemPromptOptions.sections.output_style;` (기본 상태 유지)
2. **`keepCodingInstructions: true`인 경우**:
   - 기본 Pi 코딩 프롬프트(`preamble`, `tools`, `rules`, `docs` 또는 기존 `SYSTEM.md`)를 그대로 유지하고 섹션만 추가:
   - `event.systemPromptOptions.sections.output_style = `# Output Style: ${style.name}\n\nNote: The output style instructions below take precedence over the default "Be concise in your responses" rule regarding explanation depth, formatting, and collaboration flow.\n\n${style.prompt}`;`
3. **`keepCodingInstructions: false`인 경우**:
   - 코딩 전용 페르소나(`You are an expert coding assistant...`), `"Be concise in your responses"`, `<docs>`를 제거하고 스타일 프롬프트를 메인 지침으로 설정:
   - 기존 `event.systemPromptOptions.customPrompt`(사용자의 `SYSTEM.md` 등)가 있을 경우 덮어쓰지 않고 결합하며, `style.prompt`가 비어 있더라도 기본 코딩 `preamble`로 되돌아가지 않도록 최소 지침 문자열을 보장.
   - **활성 도구 목록 및 도구 가이드라인 보존**:
     - `before_agent_start` 시점에는 `event.systemPromptOptions.selectedTools`가 동적 활성 도구와 다를 수 있으므로 `pi.getActiveTools()`에서 `event.systemPromptOptions.hiddenTools`를 제외한 실제 선언 도구 목록을 구함.
     - `toolSnippets`를 사용해 `event.systemPromptOptions.sections.tools`를 구성.
     - `edit`, `read` 등 도구 호출 규약이 깨지지 않도록 `"Be concise in your responses"`를 제외한 순수 도구 가이드라인(`toolGuidelines` + `promptGuidelines`)만 추출하여 `event.systemPromptOptions.sections.rules`로 유지.

### 3.5. 슬래시 명령어 UX (`/output-style`, `/output-style:new`)
- **UI 모드 가드**:
  - 대화형 UI가 없는 모드(`!ctx.hasUI`)에서 인자 없이 호출되면 현재 활성 스타일과 사용 가능한 스타일 목록을 안내하거나 에러를 반환.
- **`/output-style` (인자 없음, 대화형 메뉴)**:
  1. 현재 발견된 모든 스타일 목록을 `ctx.ui.select("Select Output Style", items)`로 표시:
     - 예: `● Explanatory — Educational insights explaining implementation choices... [builtin]`
  2. 스타일 선택 후 적용 범위를 `ctx.ui.select("Save Output Style Scope", scopes)`로 선택:
     - `Session only (current branch)` — `pi.appendEntry("output-style", { styleId })`만 기록
     - `Project default (.pi/output-style.json)` — 세션 엔트리 기록 + 프로젝트 설정 파일 저장
     - `Global default (~/.pi/agent/output-style.json)` — 세션 엔트리 기록 + 글로벌 설정 파일 저장
  3. `ctx.ui.notify`로 전환 알림 표시 및 `ctx.ui.setStatus("output-style", ...)` 업데이트.
- **`/output-style <name> [--project|--global|--session]`**:
  - 대소문자 구분 없이 `id` 또는 `name`으로 매칭하여 추가 팝업 없이 즉시 전환 (기본값: 현재 세션 적용, `--project` 또는 `--global` 플래그 지정 시 해당 설정 파일에도 함께 저장).
  - `getArgumentCompletions`를 등록하여 `/output-style ` 입력 시 스타일 ID 및 서브커맨드(`new`, `--project`, `--global`) 탭 자동완성 제공.
- **`/output-style:new [설명]` (및 `/output-style new [설명]`)**:
  - 인자가 없으면 `ctx.ui.input`으로 원하는 스타일 설명을 입력받고, `ctx.ui.select`로 저장 위치(프로젝트 `.pi/output-styles/` vs 글로벌 `~/.pi/agent/output-styles/`)를 선택.
  - `ctx.mode === "tui"`일 때 `BorderedLoader` 스피너와 함께 `ctx.modelRegistry.complete()`를 호출하여 영문 kebab-case `slug`(파일명용, 한글/유니코드 이름일 때 빈 파일명 방지 및 경로 탈출 방지)와 YAML frontmatter(`name`, `description`, `keep-coding-instructions`), 마크다운 본문을 생성.
  - 저장 전 `ctx.ui.editor("Review & edit generated style", content)`로 사용자가 내용을 검토·수정할 수 있게 하고, 동일 파일이 이미 존재하면 `ctx.ui.confirm`으로 덮어쓰기 확인 후 저장 및 즉시 활성화.

---

## 4. 구현 단계 (Step-by-Step)

1. **Step 1: 프로젝트 초기화**
   - `package.json`, `tsconfig.json` 생성 (`@earendil-works/pi-coding-agent` 타입 연결).
2. **Step 2: 타입 및 빌트인 스타일 작성 (`src/types.ts`, `src/builtin-styles.ts`)**
   - `Default`, `Explanatory`, `Learning`(Stop-and-wait 제약 포함) 프롬프트 정교화.
3. **Step 3: 마크다운 로더 및 상태 관리 구현 (`src/loader.ts`, `src/state.ts`)**
   - CRLF/무헤더 호환 Frontmatter 파서, `.pi`/`.claude` 디렉터리 스캔(`isProjectTrusted` 가드 포함), 우선순위 기반 상태 복원 및 `.claude/settings*.json` 호환 로직 구현.
4. **Step 4: 메인 Extension 및 `/output-style:new` 구현 (`src/generator.ts`, `src/index.ts`)**
   - `session_start`, `session_tree`, `before_agent_start` 훅 연결, `--output-style` 플래그, `/output-style` 및 `/output-style:new` 명령어 등록, 하단 상태바(`ctx.ui.setStatus`) 연동.
5. **Step 5: 테스트 및 검증 (`test/`, `README.md`)**
   - `loader.test.ts`, `prompt.test.ts`, `state.test.ts` 단위 테스트 실행 및 `pi --extension ./src/index.ts` 로드 검증.
