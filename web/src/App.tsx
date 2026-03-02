import { useEffect, useMemo, useRef, useState } from "react";
import { fetchProjectById } from "./api/client";
import { EntryFastRuntime, type RuntimeSnapshot } from "./runtime/entryRuntime";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type RunnerSettings,
} from "./runtime/settings";
import { parseProjectInput, toProjectUrl } from "./utils/input";
import { loadFromStorage, saveToStorage } from "./utils/storage";

const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  fps: 0,
  threadCount: 0,
  objectCount: 0,
  opcodePerSec: 0,
  threads: [],
  warnings: [],
  broadcastLogs: [],
};

export default function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<EntryFastRuntime | null>(null);

  const [input, setInput] = useState("");
  const [loadedProjectId, setLoadedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(EMPTY_SNAPSHOT);
  const [error, setError] = useState<string>("");

  const [settings, setSettings] = useState<RunnerSettings>(() =>
    loadFromStorage<RunnerSettings>(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS)
  );

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }

    const runtime = new EntryFastRuntime(stageRef.current, settings);
    runtimeRef.current = runtime;

    const timer = window.setInterval(() => {
      setSnapshot(runtime.getSnapshot());
    }, 120);

    return () => {
      window.clearInterval(timer);
      runtime.dispose().catch(() => undefined);
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveToStorage(SETTINGS_STORAGE_KEY, settings);
    runtimeRef.current?.updateSettings(settings).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "설정 반영 실패";
      setError(message);
    });
  }, [settings]);

  const statusLine = useMemo(() => {
    return `FPS ${snapshot.fps.toFixed(1)} / Thread ${snapshot.threadCount} / Object ${snapshot.objectCount} / Opcode ${snapshot.opcodePerSec.toLocaleString()}/sec`;
  }, [snapshot]);

  const onRun = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    try {
      setError("");
      setLoading(true);

      const id = parseProjectInput(input);
      if (!loadedProjectId || loadedProjectId !== id) {
        const project = await fetchProjectById(id);
        await runtime.loadProject(project);
        setLoadedProjectId(id);
      }

      runtime.play();
      setPlaying(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "실행 실패";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onPause = () => {
    runtimeRef.current?.pause();
    setPlaying(false);
  };

  const onReset = async () => {
    try {
      setError("");
      setLoading(true);
      await runtimeRef.current?.reset();
      if (playing) {
        runtimeRef.current?.play();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "리셋 실패";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onFullscreen = async () => {
    const target = stageRef.current;
    if (!target) {
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const onOpenOriginal = () => {
    try {
      const id = parseProjectInput(input || loadedProjectId);
      window.open(toProjectUrl(id), "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="control-row">
          <input
            className="project-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="https://playentry.org/project/<id> | /ws/<id> | <id>"
          />
          <button onClick={onRun} disabled={loading}>실행</button>
          <button onClick={onPause} disabled={loading}>일시정지</button>
          <button onClick={onReset} disabled={loading}>리셋</button>
          <button onClick={onFullscreen}>전체화면</button>
          <button onClick={onOpenOriginal}>원본 엔트리로</button>
          <button onClick={() => setSettingsOpen((prev) => !prev)}>설정</button>
        </div>
        <div className="status-row">
          <span className="status-item">{statusLine}</span>
          <span className="status-item">상태: {playing ? "RUN" : "PAUSE"}</span>
          {loading ? <span className="status-item">로딩 중...</span> : null}
          {loadedProjectId ? <span className="status-item">프로젝트: {loadedProjectId}</span> : null}
        </div>
        {error ? <div className="error-box">{error}</div> : null}
      </header>

      <main className="main-grid">
        <section className="stage-panel">
          <div className="stage-wrap" ref={stageRef} />
        </section>

        <aside className="side-panel">
          {settingsOpen ? (
            <section className="panel settings-panel">
              <h2>설정</h2>
              <label>
                해상도
                <select
                  value={settings.resolutionPreset}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      resolutionPreset: event.target.value as RunnerSettings["resolutionPreset"],
                    }))
                  }
                >
                  <option value="640x360">640x360 (기본)</option>
                  <option value="1280x720">1280x720</option>
                  <option value="1920x1080">1920x1080</option>
                  <option value="custom">Custom</option>
                </select>
              </label>

              {settings.resolutionPreset === "custom" ? (
                <div className="grid-2">
                  <label>
                    W
                    <input
                      type="number"
                      value={settings.customWidth}
                      onChange={(event) =>
                        setSettings((prev) => ({ ...prev, customWidth: Number(event.target.value) || 640 }))
                      }
                    />
                  </label>
                  <label>
                    H
                    <input
                      type="number"
                      value={settings.customHeight}
                      onChange={(event) =>
                        setSettings((prev) => ({ ...prev, customHeight: Number(event.target.value) || 360 }))
                      }
                    />
                  </label>
                </div>
              ) : null}

              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.keepAspect}
                  onChange={(event) => setSettings((prev) => ({ ...prev, keepAspect: event.target.checked }))}
                />
                비율 유지
              </label>

              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.pixelArtMode}
                  onChange={(event) => setSettings((prev) => ({ ...prev, pixelArtMode: event.target.checked }))}
                />
                픽셀 아트 모드
              </label>

              <label>
                렌더 스케일
                <input
                  type="number"
                  min={0.5}
                  max={3}
                  step={0.25}
                  value={settings.renderScale}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, renderScale: Number(event.target.value) || 1 }))
                  }
                />
              </label>

              <label>
                Tick 모드
                <select
                  value={settings.tickMode}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, tickMode: event.target.value as RunnerSettings["tickMode"] }))
                  }
                >
                  <option value="raf">requestAnimationFrame</option>
                  <option value="fixed">Fixed 60</option>
                </select>
              </label>

              <label>
                최대 opcode/프레임
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={settings.maxOpcodePerFrame}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, maxOpcodePerFrame: Number(event.target.value) || 20000 }))
                  }
                />
              </label>

              <label>
                Collision 주기(프레임)
                <input
                  type="number"
                  min={1}
                  value={settings.collisionIntervalFrames}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      collisionIntervalFrames: Number(event.target.value) || 1,
                    }))
                  }
                />
              </label>

              <label>
                Logging level
                <select
                  value={settings.loggingLevel}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      loggingLevel: event.target.value as RunnerSettings["loggingLevel"],
                    }))
                  }
                >
                  <option value="silent">silent</option>
                  <option value="error">error</option>
                  <option value="warn">warn</option>
                  <option value="info">info</option>
                  <option value="debug">debug</option>
                </select>
              </label>

              <label>
                미지원 블록 처리
                <select
                  value={settings.unsupportedBlockPolicy}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      unsupportedBlockPolicy: event.target.value as RunnerSettings["unsupportedBlockPolicy"],
                    }))
                  }
                >
                  <option value="abort_script">해당 스크립트 중단 + 경고</option>
                  <option value="noop">noop + 경고</option>
                </select>
              </label>
            </section>
          ) : null}

          <section className="panel debug-panel">
            <h2>디버그</h2>
            <div className="debug-block">
              <h3>스레드 목록</h3>
              <div className="debug-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>id</th>
                      <th>obj</th>
                      <th>pc</th>
                      <th>sleep</th>
                      <th>wait</th>
                      <th>done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.threads.slice(0, 60).map((thread) => (
                      <tr key={thread.id}>
                        <td>{thread.id}</td>
                        <td>{thread.objectId.slice(0, 6)}</td>
                        <td>{thread.pc}</td>
                        <td>{Math.max(0, Math.floor(thread.sleepUntilMs - performance.now()))}</td>
                        <td>{thread.waitingChildren}</td>
                        <td>{thread.isDone ? "Y" : "N"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="debug-block">
              <h3>broadcast 로그</h3>
              <div className="debug-scroll log-list">
                {snapshot.broadcastLogs
                  .slice()
                  .reverse()
                  .slice(0, 80)
                  .map((log, index) => (
                    <div className="log-item" key={`${log.at}-${index}`}>
                      <span>{new Date(log.at).toLocaleTimeString()}</span>
                      <span>{log.messageId || "(empty)"}</span>
                      <span>{log.waiting ? "wait" : "fire"}</span>
                      <span>spawn:{log.spawned}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="debug-block">
              <h3>경고</h3>
              <div className="debug-scroll log-list">
                {snapshot.warnings.slice(-80).map((warning, index) => (
                  <div className="log-item warning" key={`${warning}-${index}`}>
                    {warning}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}