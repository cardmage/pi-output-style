# `pi-output-style`

Claude Code의 **Output Styles**(`Default`, `Explanatory`, `Learning` 및 커스텀 `.md` 스타일) 기능을 [Pi Coding Agent](https://github.com/earendil-works/pi)(`@earendil-works/pi-coding-agent`)에서 그대로 사용할 수 있게 해주는 확장(Extension) 패키지입니다.

Pi의 구조화된 시스템 프롬프트 섹션(`systemPromptOptions.sections`), 세션 브랜치 히스토리, 하단 상태바(Status Bar)와 자연스럽게 통합되며, 기존에 작성해 둔 `.claude/output-styles/*.md` 및 `.claude/settings*.json` 설정도 수정 없이 그대로 호환됩니다.

---

## 주요 기능

1. **3가지 빌트인(Built-in) 스타일 제공**
   - **`Default`**: Pi의 기본 소프트웨어 엔지니어링 에이전트 동작 유지 (간결하고 효율적인 작업).
   - **`Explanatory`**: 코딩 작업을 수행하면서 코드베이스의 패턴, 아키텍처 설계 결정, 트레이드오프를 설명하는 교육적 인사이트 박스(`★ Insight ─────────────────────────────────────`)를 함께 제공.
   - **`Learning`**: 사용자와 함께 코딩하는 **Learn-by-doing** 모드. 보일러플레이트는 에이전트가 작성하고, 핵심 비즈니스 로직이나 의사결정 코드(5~15줄 내외)는 파일 내에 `TODO(human)` 주석으로 남겨둔 뒤 즉시 턴을 멈추고 사용자의 구현을 가이드 및 리뷰.

2. **커스텀 Output Style 마크다운(`.md`) 지원 및 Claude Code 완벽 호환**
   - YAML Frontmatter(`name`, `description`, `keep-coding-instructions`) + Markdown 본문 형식을 지원합니다.
   - `.pi/output-styles/*.md`뿐만 아니라 `.claude/output-styles/*.md` 경로도 자동으로 탐색합니다.

3. **`keep-coding-instructions` 동작 완벽 재현**
   - **`keep-coding-instructions: true`** (빌트인 스타일 기본값): Pi의 기본 코딩 페르소나, `<tools>`, `<rules>`, `<docs>`를 모두 유지하면서 `<output_style>` 섹션에 스타일 지침을 주입합니다.
   - **`keep-coding-instructions: false`** (커스텀 스타일 기본값): 코딩 전용 페르소나와 `"Be concise in your responses"` 규칙을 제거하고 커스텀 스타일을 메인 시스템 프롬프트로 설정하되, 활성화된 도구 목록(`<tools>`)과 도구 호출 규약(`<rules>` 내 도구 가이드라인), 프로젝트 컨텍스트(`AGENTS.md`), 스킬(`skills`)은 그대로 사용할 수 있도록 보존합니다.

4. **브랜치 단위 세션 복원 및 프로젝트/글로벌 설정 영속화**
   - 세션 브랜치에 스타일 변경 이력을 기록하여 `/resume`, `/fork`, `/tree`(브랜치 이동) 시 해당 시점의 스타일을 자동으로 복원합니다.
   - 하단 상태바에 현재 활성화된 스타일(`Style: Explanatory` 등)을 표시합니다.

---

## 설치 방법

### 1. 단일 세션에서 바로 실행해보기

```bash
pi --extension ./src/index.ts
```

### 2. Pi 패키지로 설치하기

**GitHub 저장소에서 설치**:
```bash
pi install https://github.com/cardmage/pi-output-style
```

**로컬 경로에서 설치**:
```bash
# 글로벌(개인) 설치 (~/.pi/agent/settings.json에 등록)
pi install ./pi-output-style

# 현재 프로젝트에만 로컬 설치 (.pi/settings.json에 등록)
pi install --local ./pi-output-style
```

---

## 사용 방법

### 1. 대화형 메뉴로 스타일 전환 (`/output-style`)

아무 인자 없이 `/output-style`을 입력하면 스타일 선택 메뉴가 열립니다.

```text
/output-style
```

1. **스타일 선택**: 현재 로드된 빌트인 및 커스텀 스타일 목록에서 원하는 스타일을 선택합니다 (또는 `✨ Create new output style...`을 선택해 새 스타일 생성).
2. **적용 범위 선택**:
   - `Session only (current branch)` — 현재 세션 브랜치에만 적용
   - `Project default (.pi/output-style.json)` — 현재 세션 적용 + 이 프로젝트의 기본 스타일로 저장
   - `Global default (~/.pi/agent/output-style.json)` — 현재 세션 적용 + 모든 프로젝트의 글로벌 기본 스타일로 저장

---

### 2. 명령어로 즉시 스타일 전환 (`/output-style <이름>`)

스타일 ID 또는 이름을 인자로 전달하면 추가 선택창 없이 즉시 전환됩니다 (`Tab` 자동완성 지원).

```text
/output-style explanatory
/output-style learning
/output-style default
```

저장 범위 플래그(`--project`, `--global`, `--session`)를 함께 지정할 수도 있습니다:

```text
# 프로젝트 기본값(.pi/output-style.json)으로 저장하며 전환
/output-style explanatory --project

# 글로벌 기본값(~/.pi/agent/output-style.json)으로 저장하며 전환
/output-style learning --global
```

---

### 3. AI로 새 커스텀 스타일 만들기 (`/output-style:new`)

원하는 역할이나 응답 방식을 설명하면 현재 모델을 사용해 커스텀 스타일 마크다운(`.md`)을 자동 생성합니다.

```text
/output-style:new
# 또는 설명을 바로 전달:
/output-style:new 코드를 바로 짜기 전에 아키텍처 트레이드오프를 질문해주는 소크라테스식 시니어 멘토
# 또는 서브커맨드 형태:
/output-style new 기술 문서 및 ADR 작성을 돕는 테크니컬 라이터
```

**진행 순서:**
1. 원하는 스타일 설명 입력 (인자로 전달하지 않은 경우 입력창 표시)
2. 저장 위치 선택 (`Project (.pi/output-styles/)` 또는 `Global (~/.pi/agent/output-styles/)`)
3. 모델이 YAML Frontmatter와 프롬프트 본문을 생성
4. Pi 멀티라인 에디터가 열려 저장 전 내용을 직접 확인·수정 가능
5. 파일 저장 후 해당 스타일이 즉시 활성화됨

---

### 4. CLI 플래그로 시작 시 스타일 지정 (`--output-style`)

Pi를 실행할 때나 헤드리스/스크립트 실행 시 플래그로 스타일을 지정할 수 있습니다.

```bash
pi --output-style explanatory
pi --output-style learning "로그인 API의 토큰 검증 로직을 같이 구현하자"
```

---

## 커스텀 Output Style 직접 작성하기

프로젝트나 유저 디렉터리에 `.md` 파일을 만들면 별도의 재시작(`/reload`) 없이 즉시 인식됩니다.

### 탐색 경로 및 우선순위 (아래로 갈수록 높은 우선순위)

같은 파일명(`id`)이 여러 경로에 존재할 경우 아래쪽 경로의 파일이 우선 적용됩니다:

1. 빌트인 스타일 (`default`, `explanatory`, `learning`)
2. `~/.claude/output-styles/*.md` (글로벌 Claude Code 스타일)
3. `~/.pi/agent/output-styles/*.md` (글로벌 Pi 스타일)
4. `<프로젝트>/.claude/output-styles/*.md` (프로젝트 Claude Code 스타일, 신뢰된 프로젝트에서만 로드)
5. `<프로젝트>/.pi/output-styles/*.md` (프로젝트 Pi 스타일, 신뢰된 프로젝트에서만 로드)

### 마크다운 파일 작성 예시

**예시 1: 코딩 지침을 유지하는 스타일 (`.pi/output-styles/socratic-mentor.md`)**
```markdown
---
name: Socratic Mentor
description: 코드를 작성하기 전에 설계 질문으로 사고를 유도하는 시니어 멘토
keep-coding-instructions: true
---

당신은 소크라테스식 질문법을 사용하는 시니어 소프트웨어 아키텍트입니다.

## 행동 규칙

1. 복잡한 기능을 구현하기 전에 엣지 케이스나 설계 트레이드오프에 관한 핵심 질문 1~2가지를 먼저 던지세요.
2. 코드를 수정할 때는 왜 이 패턴을 선택했는지 명확한 근거를 함께 제시하세요.
```

**예시 2: 코딩 외 목적의 페르소나 스타일 (`.pi/output-styles/research-writer.md`)**
```markdown
---
name: Research Writer
description: 출처 기반 심층 리서치 및 기술 보고서 작성가
keep-coding-instructions: false
---

당신은 심층 기술 리서처이자 테크니컬 라이터입니다.

## 응답 형식

- 항상 **핵심 요약(Executive Summary) → 상세 분석 → 근거 및 출처 → 결론** 순으로 구조화하여 작성하세요.
- 코드베이스나 웹 검색 도구를 활용해 사실을 먼저 검증한 뒤 답변하세요.
```

### Frontmatter 필드 설명

| 필드 | 기본값 | 설명 |
|---|---|---|
| `name` | 파일명 | `/output-style` 메뉴 및 하단 상태바에 표시되는 이름 |
| `description` | `""` | `/output-style` 선택 메뉴에 표시되는 한 줄 설명 |
| `keep-coding-instructions` | 커스텀: `false`<br>빌트인: `true` | `true`면 Pi의 기본 코딩 지침을 유지하고 `<output_style>` 섹션을 추가합니다.<br>`false`면 기본 코딩 페르소나와 간결성 규칙을 제거하고 이 스타일을 메인 프롬프트로 사용합니다. |

---

## 활성 스타일 결정 우선순위

세션이 시작되거나 `/tree`로 브랜치를 이동할 때 다음 순서로 활성 스타일을 결정합니다:

1. **CLI 플래그**: `--output-style <name>`
2. **현재 세션 브랜치 기록**: 세션 내 가장 최근에 전환한 `output-style` 엔트리
3. **프로젝트 설정** *(신뢰된 프로젝트인 경우)*:
   - `.pi/output-style.json` (`{ "outputStyle": "..." }`)
   - 없을 경우 `.claude/settings.local.json` → `.claude/settings.json`의 `"outputStyle"` 필드 자동 참조
4. **글로벌 설정**:
   - `~/.pi/agent/output-style.json` (`{ "outputStyle": "..." }`)
   - 없을 경우 `~/.claude/settings.json`의 `"outputStyle"` 필드 자동 참조
5. **기본값**: `default`

*(참고: 설정 파일이나 세션에 기록된 스타일 파일이 삭제되어 찾을 수 없는 경우 자동으로 `default`로 폴백하며 경고 알림을 표시합니다.)*

---

## 테스트 실행

```bash
npm test
```
