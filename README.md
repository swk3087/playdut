# Entry Fast Runner

Entry 프로젝트 JSON을 받아 `blocks -> IR -> bytecode VM`으로 실행하는 독립 실행기입니다.
공식 EntryJS 플레이어를 직접 사용하지 않고, 런타임을 새로 구현했습니다.

## 구성

- `server` : Node + Express + TypeScript
  - `GET /api/project/:id` : Entry GraphQL `SELECT_PROJECT` 프록시 (공개 작품만)
  - `GET /asset?url=...` : 에셋 프록시
- `web` : Vite + React + TypeScript + PixiJS
  - 프로젝트 입력 (`/project/<id>`, `/ws/<id>`, `<id>`)
  - 실행/일시정지/리셋/전체화면/원본 이동
  - 설정 패널 (해상도, tick, opcode budget, collision 주기, logging, 미지원 블록 정책)
  - 상태 패널 (FPS / Thread / Object / Opcode/sec)
  - 디버그 패널 (스레드 목록 / broadcast 로그 / 경고)

## 실행

```bash
npm install
npm run dev:server
npm run dev:web
```

- 서버 기본 포트: `4000`
- 웹 기본 포트: `5173`

## 핵심 런타임

- 컴파일 단계에서 스크립트 전체를 IR/bytecode로 변환
- VM 스레드 모델:
  - `Thread = { id, pc, stack, sleepUntilMs, waitingChildren, isDone }`
- 스케줄링:
  - ready 큐 기반 라운드로빈
  - `requestAnimationFrame` 또는 fixed 60 tick
  - sleep/waiting thread skip
- 충돌:
  - spatial hash + AABB
- 오디오:
  - WebAudio 기반 모듈 제공

## 하드웨어/미지원 블록 정책

컴파일 단계에서 하드웨어/미지원 블록을 감지합니다.

- `abort_script`: 해당 스크립트 중단 + 경고
- `noop`: noop + 경고

런타임에서 예외로 전체 크래시하지 않도록 방어합니다.
