/* global window, document, fetch, FileReader, Intl, performance */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const RUN_STATUS_LABEL = {
    idle: "待检测",
    running: "检测中",
    pass: "通过",
    warn: "警告",
    fail: "不通过",
    error: "出错",
  };

  const CHECK_STATUS_LABEL = {
    pass: "通过",
    fail: "失败",
    warn: "警告",
    skip: "跳过",
  };

  const MODE_LABEL = {
    agent: "Agent 自主",
    fixed: "固定流程",
  };

  const TRACE_TYPE_LABEL = {
    prompt: "提示词",
    model: "模型响应",
    tool_call: "工具调用",
    observation: "观察结果",
    enforced: "HARNESS 干预",
    final: "最终答复",
    error: "错误",
  };

  const FIXTURE_HINTS = {
    good: "基准制品：版本、文件、哈希与变更记录均一致。",
    "bad-version": "manifest 仍写着 1.4.0，而声明版本是 1.5.0。",
    "bad-hash": "dist/app.js 的内容哈希与 manifest 不一致。",
    forbidden: "包含 .env 与 config/prod.key，路径命中禁用模式。",
    "missing-file": "manifest 列出了 LICENSE，但压缩包中没有这个文件。",
  };

  const REASON_LABEL = {
    max_steps: "达到最大步数，已补跑缺失检查",
    mock_plan_exhausted: "Mock 计划耗尽",
    plan_assertion_failed: "Mock 计划断言失败",
    model_error: "模型调用失败",
    required_check_unavailable: "必检工具不可用",
  };

  const VERDICT_COPY = {
    pass: {
      eyebrow: "INSPECTION PASSED",
      title: "制品通过检测",
      icon: "✓",
    },
    warn: {
      eyebrow: "INSPECTION WARNING",
      title: "检测完成，存在风险",
      icon: "!",
    },
    fail: {
      eyebrow: "INSPECTION FAILED",
      title: "制品未通过检测",
      icon: "×",
    },
    error: {
      eyebrow: "HARNESS ERROR",
      title: "检测运行出错",
      icon: "×",
    },
  };

  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const DEFAULT_RUN_NOTE = "五项检查始终执行，不提供整体开关。";
  const BUSY_RUN_NOTE = "正在执行检测，请保持页面打开。";

  /* ---------------------------------------------------------------------- */
  /* Elements                                                                */
  /* ---------------------------------------------------------------------- */

  const inspectForm = $("inspect-form");
  const artifactInput = $("artifact-file");
  const dropzone = $("dropzone");
  const fileName = $("file-name");
  const fileMeta = $("file-meta");
  const artifactError = $("artifact-error");
  const fixtureSelect = $("fixture-select");
  const fixtureHint = $("fixture-hint");
  const declaredInput = $("declared-version");
  const previousInput = $("previous-version");
  const declaredError = $("declared-version-error");
  const previousError = $("previous-version-error");
  const modeSelect = $("mode");
  const skillSelect = $("skill-selection");
  const skillCatalog = $("skill-catalog");
  const runButton = $("run-button");
  const runButtonLabel = runButton.querySelector(".button-label");
  const runNote = $("run-note");
  const runClock = $("run-clock");
  const sourceTabs = Array.from(document.querySelectorAll(".source-tab"));
  const uploadPanel = $("upload-panel");
  const fixturePanel = $("fixture-panel");

  const resultPanel = $("result-panel");
  const statusBadge = $("status-badge");
  const statusText = statusBadge.querySelector(".status-text");
  const resultAlert = $("result-alert");
  const emptyState = $("empty-state");
  const runningState = $("running-state");
  const runningTitle = $("running-title");
  const runningLabel = $("running-label");
  const runningElapsed = $("running-elapsed");
  const errorState = $("error-state");
  const errorMessage = $("error-message");
  const errorHint = $("error-hint");
  const reportView = $("report-view");

  const verdict = $("verdict");
  const verdictIcon = $("verdict-icon");
  const verdictEyebrow = $("verdict-eyebrow");
  const verdictTitle = $("verdict-title");
  const verdictNote = $("verdict-note");
  const reportMeta = $("report-meta");
  const reportStats = $("report-stats");
  const artifactStrip = $("artifact-strip");
  const checksBody = $("checks-body");
  const reportJsonLink = $("report-json-link");
  const reportMdLink = $("report-md-link");
  const configHashNote = $("config-hash-note");

  const tracePanel = $("trace-panel");
  const traceCount = $("trace-count");
  const traceNote = $("trace-note");

  const runsList = $("runs-list");
  const runsCount = $("runs-count");
  const refreshRuns = $("refresh-runs");

  const configState = $("config-state");
  const configMaxSteps = $("config-max-steps");
  const configRequiredFiles = $("config-required-files");
  const configForbiddenPatterns = $("config-forbidden-patterns");
  const configScanContent = $("config-scan-content");
  const configFilenameVersion = $("config-filename-version");
  const configStatus = $("config-status");
  const configPreview = $("config-preview");
  const applyConfig = $("apply-config");
  const resetConfig = $("reset-config");

  const state = {
    source: "fixture",
    overrides: null,
    config: null,
    activeRunId: null,
    lastTrace: [],
    busy: false,
    openingRun: false,
    loadingRuns: false,
    clockTimer: null,
  };

  /* ---------------------------------------------------------------------- */
  /* Small helpers                                                           */
  /* ---------------------------------------------------------------------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    node.replaceChildren();
  }

  function setText(node, value) {
    node.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatShortTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "—";
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatFullTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "—";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value < 1000) return `${Math.round(value)} ms`;
    if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
    return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "—";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function shortHash(value, length = 12) {
    if (!value) return "—";
    const text = String(value);
    return text.length > length ? `${text.slice(0, length)}…` : text;
  }

  function shortRunId(runId) {
    if (!runId) return "—";
    const parts = String(runId).split("-");
    return parts.length > 1 ? `#${parts[parts.length - 1]}` : `#${String(runId).slice(-6)}`;
  }

  function reasonText(reason) {
    if (!reason) return "";
    return REASON_LABEL[reason] ? `${REASON_LABEL[reason]}（${reason}）` : String(reason);
  }

  function readableError(error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
      return `无法连接到本地服务，请确认服务仍在运行。\n${raw}`;
    }
    const known = [
      [/request body too large/i, "请求体超过 12 MB 上限，请更换更小的制品。"],
      [/declaredVersion and previousVersion are required/i, "声明版本和上一版本不能为空。"],
      [/fixture or artifactBase64 is required/i, "请选择一个示例制品，或上传 ZIP 文件。"],
      [/declaredVersion is required/i, "声明版本不能为空。"],
      [/previousVersion is required/i, "上一版本不能为空。"],
      [/fixture is required/i, "请选择一个示例制品。"],
      [/uploadPath is required/i, "上传文件没有成功保存，请重试。"],
      [/skill (misses|not found)/i, "Skill 配置不完整，请检查服务端 Skill 目录。"],
    ];
    for (const [pattern, message] of known) {
      if (pattern.test(raw)) {
        return raw === message ? message : `${message}\n${raw}`;
      }
    }
    return raw || "未知错误";
  }

  function parseList(value) {
    return Array.from(
      new Set(
        String(value || "")
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const message =
        data && typeof data.error === "string"
          ? data.error
          : text || `请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (text && data === null) throw new Error("服务端返回了无法解析的响应。");
    return data;
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error("无法读取所选文件，请重新选择。"));
      reader.readAsDataURL(file);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Status & view switching                                                 */
  /* ---------------------------------------------------------------------- */

  function setStatus(status, label) {
    const normalized = RUN_STATUS_LABEL[status] ? status : "error";
    statusBadge.dataset.status = normalized;
    statusText.textContent = label || RUN_STATUS_LABEL[normalized];
    resultPanel.dataset.state = normalized;
  }

  function setResultState(name) {
    emptyState.hidden = name !== "empty";
    runningState.hidden = name !== "running";
    errorState.hidden = name !== "error";
    reportView.hidden = name !== "report";
  }

  function setTraceNote(text) {
    traceNote.hidden = !text;
    traceNote.textContent = text || "";
  }

  function showAlert(tone, title, message) {
    clear(resultAlert);
    resultAlert.dataset.tone = tone;
    resultAlert.append(
      el("span", "alert-title", title),
      el("span", "alert-message", message),
    );
    const close = el("button", "alert-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭提示");
    close.addEventListener("click", hideAlert);
    resultAlert.append(close);
    resultAlert.hidden = false;
  }

  function hideAlert() {
    resultAlert.hidden = true;
    clear(resultAlert);
  }

  function setBusy(busy) {
    state.busy = busy;
    runButton.disabled = busy;
    runButton.dataset.busy = String(busy);
    runButton.setAttribute("aria-busy", String(busy));
    runButtonLabel.textContent = busy ? "检测中…" : "开始检测";
    runNote.textContent = busy ? BUSY_RUN_NOTE : DEFAULT_RUN_NOTE;
    if (busy) {
      startClock();
    } else {
      stopClock();
    }
  }

  function startClock() {
    stopClock();
    const started = performance.now();
    runClock.hidden = false;
    runClock.textContent = "0.0s";
    runningElapsed.textContent = "已用时 0.0s";
    state.clockTimer = window.setInterval(() => {
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      runClock.textContent = `${seconds}s`;
      runningElapsed.textContent = `已用时 ${seconds}s`;
    }, 100);
  }

  function stopClock() {
    if (state.clockTimer !== null) {
      window.clearInterval(state.clockTimer);
      state.clockTimer = null;
    }
    runClock.hidden = true;
  }

  function resetRunningCopy() {
    runningTitle.textContent = "正在执行五项检查";
    runningLabel.textContent = "读取 ZIP、核对 manifest、计算哈希并汇总报告。";
  }

  function showLoadingRun() {
    runningTitle.textContent = "正在载入运行记录";
    runningLabel.textContent = "读取报告与轨迹，请稍候。";
    setStatus("running", "载入中");
    setResultState("running");
    setTraceNote(state.lastTrace.length ? "上一次运行的轨迹" : null);
  }

  /* ---------------------------------------------------------------------- */
  /* Form source & validation                                                */
  /* ---------------------------------------------------------------------- */

  function setSource(mode, options = {}) {
    state.source = mode === "upload" ? "upload" : "fixture";
    for (const tab of sourceTabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset.source === state.source));
    }
    uploadPanel.hidden = state.source !== "upload";
    fixturePanel.hidden = state.source !== "fixture";
    if (state.source === "fixture" && options.clearFile) {
      artifactInput.value = "";
      resetFileLabel();
    }
  }

  function resetFileLabel() {
    dropzone.dataset.hasFile = "false";
    fileName.textContent = "选择或拖入 .zip 制品";
    fileMeta.textContent = "单文件，约 8 MB 以内";
    artifactInput.removeAttribute("aria-invalid");
    artifactError.hidden = true;
  }

  function updateFileLabel(file) {
    dropzone.dataset.hasFile = "true";
    fileName.textContent = file.name;
    fileMeta.textContent = `ZIP · ${formatBytes(file.size)}`;
    artifactError.hidden = true;
    artifactInput.removeAttribute("aria-invalid");
  }

  function setFieldError(input, errorNode, message) {
    errorNode.textContent = message;
    errorNode.hidden = false;
    if (input) input.setAttribute("aria-invalid", "true");
  }

  function clearFieldErrors() {
    artifactError.hidden = true;
    artifactInput.removeAttribute("aria-invalid");
    declaredError.hidden = true;
    previousError.hidden = true;
    declaredInput.removeAttribute("aria-invalid");
    previousInput.removeAttribute("aria-invalid");
  }

  function validateAndCollect() {
    clearFieldErrors();
    const file = artifactInput.files && artifactInput.files[0] ? artifactInput.files[0] : null;
    const declaredVersion = declaredInput.value.trim();
    const previousVersion = previousInput.value.trim();
    let firstInvalid = null;

    if (!file && state.source === "upload") {
      setFieldError(artifactInput, artifactError, "请选择一个 ZIP 文件。");
      firstInvalid = firstInvalid || artifactInput;
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setFieldError(
        artifactInput,
        artifactError,
        "文件超过约 8 MB 的上传上限，请选择更小的 ZIP。",
      );
      firstInvalid = firstInvalid || artifactInput;
    }
    if (!declaredVersion) {
      setFieldError(declaredInput, declaredError, "请填写声明版本。");
      firstInvalid = firstInvalid || declaredInput;
    }
    if (!previousVersion) {
      setFieldError(previousInput, previousError, "请填写上一版本。");
      firstInvalid = firstInvalid || previousInput;
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }
    return { file, declaredVersion, previousVersion };
  }

  /* ---------------------------------------------------------------------- */
  /* Report rendering                                                        */
  /* ---------------------------------------------------------------------- */

  function renderMetaItem(label, value, title) {
    const item = el("div", "meta-item");
    item.append(el("dt", null, label));
    const dd = el("dd", "mono", value === undefined || value === null || value === "" ? "—" : value);
    if (title) dd.title = title;
    item.append(dd);
    return item;
  }

  function renderReport(report) {
    if (!report || typeof report !== "object") return;
    const status = VERDICT_COPY[report.status] ? report.status : "error";
    const copy = VERDICT_COPY[status];
    const summary = report.summary && typeof report.summary === "object" ? report.summary : {};
    const passed = Number(summary.passed) || 0;
    const failed = Number(summary.failed) || 0;
    const warnings = Number(summary.warnings) || 0;
    const skipped = Number(summary.skipped) || 0;
    const duration = formatDuration(summary.durationMs);
    const checkCount = Array.isArray(report.checks) ? report.checks.length : 0;

    state.activeRunId = report.runId || state.activeRunId;
    verdict.dataset.status = status;
    verdictIcon.textContent = copy.icon;
    verdictEyebrow.textContent = copy.eyebrow;
    verdictTitle.textContent = copy.title;

    let note = "";
    if (status === "pass") {
      note = `${checkCount} 项检查全部通过 · 用时 ${duration}`;
    } else if (status === "warn") {
      note =
        warnings > 0
          ? `${warnings} 项警告 · ${passed} 项通过 · 用时 ${duration}`
          : `${passed} 项通过 · 用时 ${duration}`;
      if (report.incomplete) {
        note += ` · 必检项未全部完成${report.reason ? `（${reasonText(report.reason)}）` : ""}`;
      }
    } else if (status === "fail") {
      note = `${failed} 项检查未通过 · 用时 ${duration}`;
    } else {
      note = `${reasonText(report.reason) || "运行过程中发生 Harness 级错误，检查结果可能不完整"} · 用时 ${duration}`;
    }
    if (report.incomplete && status !== "warn") note += " · 必检项未全部完成";
    if (report.fallback) note += " · 报告由兜底流程补写";
    verdictNote.textContent = note;

    clear(reportMeta);
    const skill = report.skill && typeof report.skill === "object" ? report.skill : null;
    const versions = report.versions && typeof report.versions === "object" ? report.versions : {};
    reportMeta.append(
      renderMetaItem("运行 ID", report.runId || "—"),
      renderMetaItem("模式", MODE_LABEL[report.mode] || report.mode || "—"),
      renderMetaItem("Skill", skill ? `${skill.name} v${skill.version}` : "未加载"),
      renderMetaItem("用时", duration),
      renderMetaItem("声明版本", versions.declared || "—"),
      renderMetaItem("上一版本", versions.previous || "—"),
      renderMetaItem("完成时间", formatFullTime(report.finishedAt)),
      renderMetaItem("配置指纹", shortHash(report.configHash, 14), report.configHash || ""),
    );

    clear(reportStats);
    const stats = [
      { label: "通过", value: passed, status: "pass" },
      { label: "失败", value: failed, status: "fail" },
      { label: "警告", value: warnings, status: "warn" },
      { label: "跳过", value: skipped, status: "skip" },
    ];
    for (const stat of stats) {
      const card = el("div", "stat");
      if (stat.status === "pass" || stat.value > 0) card.dataset.status = stat.status;
      card.append(
        el("span", "stat-value", stat.value),
        el("span", "stat-label", stat.label),
      );
      reportStats.append(card);
    }

    renderArtifact(report.artifact);
    renderChecks(report.checks);

    const safeRunId = encodeURIComponent(report.runId || "");
    if (report.runId) {
      reportJsonLink.href = `/api/runs/${safeRunId}/report.json`;
      reportMdLink.href = `/api/runs/${safeRunId}/report.md`;
      reportJsonLink.download = `${report.runId}-report.json`;
      reportMdLink.download = `${report.runId}-report.md`;
    } else {
      reportJsonLink.removeAttribute("href");
      reportMdLink.removeAttribute("href");
    }
    configHashNote.textContent = report.configHash
      ? `配置指纹 ${shortHash(report.configHash, 20)}`
      : "配置指纹 —";
    configHashNote.title = report.configHash || "";

    setStatus(status);
    setTraceNote(null);
  }

  function renderArtifact(artifact) {
    clear(artifactStrip);
    const id = el("div", "artifact-id");
    id.append(el("span", "artifact-label", "ARTIFACT"));
    if (!artifact || typeof artifact !== "object") {
      id.append(el("span", "artifact-name", "未读取到制品"), el("span", "artifact-hash", "sha256 —"));
      artifactStrip.append(id, el("span", "artifact-size", "—"));
      return;
    }
    const name = el("span", "artifact-name", artifact.filename || "未知制品");
    const hash = el("span", "artifact-hash", `sha256 ${shortHash(artifact.sha256, 18)}`);
    hash.title = artifact.sha256 || "";
    id.append(name, hash);
    artifactStrip.append(id, el("span", "artifact-size", formatBytes(artifact.size)));
  }

  function renderChecks(checks) {
    clear(checksBody);
    if (!Array.isArray(checks) || checks.length === 0) {
      const row = el("tr");
      const cell = el("td", "checks-empty-cell", "报告中没有检查结果。");
      cell.colSpan = 4;
      row.append(cell);
      checksBody.append(row);
      return;
    }

    checks.forEach((check, index) => {
      const status = CHECK_STATUS_LABEL[check.status] ? check.status : "skip";
      const row = el("tr", "check-row");
      row.dataset.status = status;

      const nameCell = el("td");
      nameCell.append(el("span", "check-name", check.title || check.id || "未命名检查"));
      const detail = el("div", "check-detail");
      if (check.id) detail.append(el("span", "check-id", check.id));
      if (check.required) detail.append(el("span", "check-required", "必检"));
      nameCell.append(detail);

      const statusCell = el("td");
      const pill = el("span", "check-pill", CHECK_STATUS_LABEL[status]);
      pill.dataset.status = status;
      statusCell.append(pill);

      const summaryCell = el("td");
      summaryCell.append(el("div", "check-summary", check.summary || "—"));

      const evidenceId = `evidence-${index}`;
      const hasEvidence =
        check.evidence !== undefined &&
        check.evidence !== null &&
        !(typeof check.evidence === "object" && Object.keys(check.evidence).length === 0);

      const evidenceCell = el("td", "align-right");
      const button = el("button", "evidence-button");
      button.type = "button";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", evidenceId);
      const buttonLabel = el("span", "evidence-toggle-label", hasEvidence ? "展开" : "无证据");
      const chevron = el("span", "chevron", hasEvidence ? "+" : "");
      button.append(buttonLabel, chevron);
      if (!hasEvidence) button.disabled = true;
      evidenceCell.append(button);

      const evidenceRow = el("tr", "evidence-row");
      evidenceRow.id = evidenceId;
      evidenceRow.hidden = true;
      const evidenceCellWide = el("td");
      evidenceCellWide.colSpan = 4;
      evidenceCellWide.append(el("div", "evidence-label", "原始证据 / EVIDENCE"));
      const pre = el("pre");
      try {
        pre.textContent =
          typeof check.evidence === "string"
            ? check.evidence
            : JSON.stringify(check.evidence ?? null, null, 2);
      } catch {
        pre.textContent = String(check.evidence);
      }
      evidenceCellWide.append(pre);
      evidenceRow.append(evidenceCellWide);

      if (hasEvidence) {
        button.addEventListener("click", () => {
          const expanded = button.getAttribute("aria-expanded") === "true";
          button.setAttribute("aria-expanded", String(!expanded));
          evidenceRow.hidden = expanded;
          buttonLabel.textContent = expanded ? "展开" : "收起";
          chevron.textContent = expanded ? "+" : "−";
        });
      }

      row.append(nameCell, statusCell, summaryCell, evidenceCell);
      checksBody.append(row, evidenceRow);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Trace rendering                                                         */
  /* ---------------------------------------------------------------------- */

  function traceSummary(event) {
    const type = event.type || "";
    const result = event.result;
    if (type === "prompt") return "已组装 system 与 user 提示词。";
    if (type === "model") {
      if (result && result.type === "tool_call") {
        return `模型决定调用 ${result.tool || "工具"}。`;
      }
      if (result && result.type === "final") return "模型返回最终答复。";
      return "模型返回响应。";
    }
    if (type === "tool_call") return `调用工具 ${event.tool || "—"}。`;
    if (type === "observation") {
      if (result && typeof result.summary === "string" && result.summary) {
        return `观察结果：${result.summary}`;
      }
      return "工具返回观察结果。";
    }
    if (type === "enforced") {
      if (result && typeof result.message === "string" && result.message) return result.message;
      if (result && result.report === "fallback") return "报告由 Harness 兜底写入。";
      if (event.tool) return `Harness 补跑 ${event.tool}。`;
      return "Harness 介入运行流程。";
    }
    if (type === "final") {
      if (result && typeof result.final === "string" && result.final) {
        return `最终答复：${result.final}`;
      }
      if (result && result.status) {
        return `运行结束，状态 ${RUN_STATUS_LABEL[result.status] || result.status}。`;
      }
      return "运行结束。";
    }
    if (type === "error") {
      return event.error || (result && result.error) || "运行发生错误。";
    }
    return "轨迹事件。";
  }

  function buildTraceItem(event, index) {
    const type = TRACE_TYPE_LABEL[event.type] ? event.type : "event";
    const item = el("li", "trace-item");
    item.dataset.type = type;
    item.style.setProperty("--i", String(index));

    const marker = el("span", "trace-marker");
    marker.setAttribute("aria-hidden", "true");

    const content = el("div", "trace-content");
    const head = el("div", "trace-row-head");
    head.append(el("span", "trace-type", TRACE_TYPE_LABEL[event.type] || event.type || "事件"));
    if (event.tool) head.append(el("span", "trace-tool", event.tool));

    const result = event.result;
    if (result && typeof result.ok === "boolean") {
      const flag = el("span", "trace-flag", result.ok ? "成功" : "失败");
      flag.dataset.tone = result.ok ? "pass" : "fail";
      head.append(flag);
    }
    head.append(el("span", "trace-step", `STEP ${pad(Number(event.step) || 0)}`));
    if (typeof event.durationMs === "number") {
      head.append(el("span", "trace-duration", formatDuration(event.durationMs)));
    }

    content.append(head);
    content.append(el("p", "trace-summary", traceSummary(event)));

    if (type === "tool_call" && event.args !== undefined) {
      let argsText = "";
      try {
        argsText = typeof event.args === "string" ? event.args : JSON.stringify(event.args);
      } catch {
        argsText = String(event.args);
      }
      if (argsText && argsText !== "{}") {
        content.append(
          el("p", "trace-args", argsText.length > 160 ? `${argsText.slice(0, 160)}…` : argsText),
        );
      }
    }

    const thought =
      (event.thought && String(event.thought)) ||
      (result && typeof result.thought === "string" ? result.thought : "");
    if (thought) content.append(el("p", "trace-thought", thought));

    const raw = el("details", "trace-raw");
    raw.append(el("summary", null, "查看原始 JSON"));
    const pre = el("pre");
    try {
      pre.textContent = JSON.stringify(event, null, 2);
    } catch {
      pre.textContent = String(event);
    }
    raw.append(pre);
    content.append(raw);

    item.append(marker, content);
    return item;
  }

  function renderTrace(events) {
    const list = Array.isArray(events) ? events : [];
    state.lastTrace = list;
    traceCount.textContent = `${list.length} 条记录`;
    clear(tracePanel);
    if (list.length === 0) {
      const empty = el("div", "trace-empty");
      empty.append(
        el("span", "trace-empty-line"),
        el("p", null, "这次运行没有产生轨迹事件。"),
      );
      tracePanel.append(empty);
      return;
    }
    const timeline = el("ol", "timeline");
    list.forEach((event, index) => timeline.append(buildTraceItem(event, index)));
    tracePanel.append(timeline);
  }

  function showTraceMessage(message) {
    traceCount.textContent = "—";
    clear(tracePanel);
    const empty = el("div", "trace-empty");
    empty.append(el("span", "trace-empty-line"), el("p", null, message));
    tracePanel.append(empty);
  }

  /* ---------------------------------------------------------------------- */
  /* Runs                                                                    */
  /* ---------------------------------------------------------------------- */

  function updateSelectedRun() {
    for (const item of runsList.querySelectorAll(".run-item")) {
      if (item.dataset.runId === state.activeRunId) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    }
  }

  function renderRuns(runs) {
    const list = Array.isArray(runs) ? runs : [];
    runsCount.textContent = `${list.length} 条`;
    clear(runsList);

    if (list.length === 0) {
      runsList.append(el("p", "runs-empty", "还没有运行记录。完成一次检测后会出现在这里。"));
      return;
    }

    for (const run of list) {
      const button = el("button", "run-item");
      button.type = "button";
      button.dataset.runId = run.runId || "";
      if (run.runId && run.runId === state.activeRunId) button.setAttribute("aria-current", "true");

      const dot = el("span", "run-dot");
      dot.dataset.status = run.status || "error";
      dot.setAttribute("aria-hidden", "true");

      const main = el("span", "run-main");
      main.append(
        el("span", "run-artifact", run.artifact || "(none)"),
        el(
          "span",
          "run-meta",
          `${formatShortTime(run.startedAt)} · ${MODE_LABEL[run.mode] || run.mode || "—"}`,
        ),
      );

      const tail = el("span", "run-tail");
      const statusLabel = el("span", "run-status-text", RUN_STATUS_LABEL[run.status] || run.status || "—");
      statusLabel.dataset.status = run.status || "error";
      tail.append(statusLabel, el("span", "run-id", shortRunId(run.runId)));

      button.append(dot, main, tail);
      button.addEventListener("click", () => openRun(run.runId));
      runsList.append(button);
    }
  }

  async function loadRuns() {
    if (state.loadingRuns) return;
    state.loadingRuns = true;
    refreshRuns.disabled = true;
    runsList.setAttribute("aria-busy", "true");
    try {
      const data = await fetchJson("/api/runs");
      renderRuns(data && Array.isArray(data.runs) ? data.runs : []);
    } catch (error) {
      runsCount.textContent = "—";
      clear(runsList);
      runsList.append(
        el("p", "runs-empty", `无法读取运行历史：${readableError(error)}`),
      );
    } finally {
      state.loadingRuns = false;
      refreshRuns.disabled = false;
      runsList.removeAttribute("aria-busy");
    }
  }

  async function openRun(runId) {
    if (!runId || state.busy || state.openingRun) return;
    state.openingRun = true;
    runButton.disabled = true;
    showLoadingRun();
    hideAlert();
    runsList.setAttribute("aria-busy", "true");

    try {
      const data = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
      const report = data && data.report ? data.report : data;
      if (!report || typeof report !== "object") {
        throw new Error("这条运行记录没有可读取的报告。");
      }
      const trace = data && Array.isArray(data.trace) ? data.trace : [];
      state.activeRunId = report.runId || runId;
      renderReport(report);
      renderTrace(trace);
      setStatus(report.status);
      setResultState("report");
      setTraceNote(null);
      updateSelectedRun();
    } catch (error) {
      setStatus("error");
      setResultState("error");
      errorMessage.textContent = readableError(error);
      errorHint.textContent = state.lastTrace.length
        ? "上一次运行的轨迹保留在下方，可用于对照排查。"
        : "这条运行记录可能已被清理，或报告无法解析。";
      setTraceNote(state.lastTrace.length ? "上一次运行的轨迹" : null);
    } finally {
      state.openingRun = false;
      runButton.disabled = state.busy;
      runsList.removeAttribute("aria-busy");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Inspect                                                                 */
  /* ---------------------------------------------------------------------- */

  async function handleSubmit(event) {
    event.preventDefault();
    if (state.busy || state.openingRun) return;

    const collected = validateAndCollect();
    if (!collected) return;

    const { file, declaredVersion, previousVersion } = collected;

    hideAlert();
    resetRunningCopy();
    setStatus("running");
    setResultState("running");
    setBusy(true);
    setTraceNote(state.lastTrace.length ? "上一次运行的轨迹" : null);

    try {
      let payload;
      if (file) {
        runningLabel.textContent = "正在读取上传的 ZIP，随后执行五项检查。";
        const artifactBase64 = await readFileAsBase64(file);
        payload = {
          artifactBase64,
          artifactFilename: file.name,
          declaredVersion,
          previousVersion,
          mode: modeSelect.value,
          skillSelection: skillSelect.value,
        };
      } else {
        payload = {
          fixture: fixtureSelect.value,
          declaredVersion,
          previousVersion,
          mode: modeSelect.value,
          skillSelection: skillSelect.value,
        };
      }
      if (state.overrides) payload.overrides = state.overrides;

      const result = await fetchJson("/api/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!result || !result.report) throw new Error("服务端没有返回检测报告。");

      state.activeRunId = result.runId || result.report.runId || null;
      renderReport(result.report);
      setStatus(result.report.status);
      setResultState("report");
      setTraceNote(null);
      showTraceMessage("正在读取本次运行的轨迹…");

      try {
        const traceData = await fetchJson(
          `/api/runs/${encodeURIComponent(result.runId || result.report.runId)}/trace`,
        );
        renderTrace(traceData && Array.isArray(traceData.trace) ? traceData.trace : []);
      } catch (error) {
        if (state.lastTrace.length > 0) {
          renderTrace(state.lastTrace);
          setTraceNote("上一次运行的轨迹");
        } else {
          showTraceMessage(`轨迹读取失败：${readableError(error)}`);
        }
        showAlert("warning", "报告已生成，轨迹读取失败", readableError(error));
      }

      loadRuns();
    } catch (error) {
      setStatus("error");
      setResultState("error");
      errorMessage.textContent = readableError(error);
      errorHint.textContent = state.lastTrace.length
        ? "上一次运行的轨迹保留在下方，可用于排查。"
        : "请检查输入或服务端日志后重试。";
      setTraceNote(state.lastTrace.length ? "上一次运行的轨迹" : null);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Config overrides                                                        */
  /* ---------------------------------------------------------------------- */

  function setConfigStatus(message, tone) {
    configStatus.textContent = message;
    if (tone) configStatus.dataset.tone = tone;
    else delete configStatus.dataset.tone;
  }

  function fillConfigFields(config) {
    if (!config || typeof config !== "object") return;
    const harness = config.harness || {};
    const checks = config.checks || {};
    const flow = config.flow || {};

    if (Number.isInteger(harness.maxSteps)) configMaxSteps.value = String(harness.maxSteps);
    if (Array.isArray(checks.requiredFiles)) {
      configRequiredFiles.value = checks.requiredFiles.join(", ");
    }
    if (Array.isArray(checks.forbiddenPatterns)) {
      configForbiddenPatterns.value = checks.forbiddenPatterns.join(", ");
    }
    if (Array.isArray(checks.allowedBumps)) {
      for (const input of document.querySelectorAll('input[name="allowedBumps"]')) {
        input.checked = checks.allowedBumps.includes(input.value);
      }
    }
    if (typeof checks.scanContent === "boolean") {
      configScanContent.checked = checks.scanContent;
    }
    if (typeof checks.checkFilenameVersion === "boolean") {
      configFilenameVersion.checked = checks.checkFilenameVersion;
    }
    if (harness.skillSelection === "auto" || harness.skillSelection === "preload") {
      skillSelect.value = harness.skillSelection;
    }
    if (flow.mode === "agent" || flow.mode === "fixed") {
      modeSelect.value = flow.mode;
    }
  }

  function renderSkillCatalog(data) {
    const skills = data && Array.isArray(data.skills) ? data.skills : [];
    const config = data && data.config ? data.config : {};
    const active = Array.isArray(config.harness && config.harness.activeSkills)
      ? config.harness.activeSkills
      : [];

    clear(skillCatalog);
    skillCatalog.append(el("span", "mini-dot"));
    if (skills.length === 0) {
      skillCatalog.append(
        el("span", null, "未发现 Skill 目录，Agent 将直接使用可用工具。"),
      );
      return;
    }

    skillCatalog.append(el("span", null, "已装 Skill"));
    for (const skill of skills) {
      const isActive = active.includes(skill.name);
      const chip = el(
        "span",
        "skill-chip",
        `${skill.name} v${skill.version}`,
      );
      chip.dataset.active = String(isActive);
      chip.title = `${skill.description || ""}${isActive ? "（已启用）" : ""}`;
      skillCatalog.append(chip);
    }
  }

  async function loadConfig() {
    try {
      const data = await fetchJson("/api/config");
      state.config = data && data.config ? data.config : null;
      if (!state.config) throw new Error("响应中缺少 config。");
      fillConfigFields(state.config);
      renderSkillCatalog(data);
      if (!state.overrides) {
        const maxSteps = state.config.harness && state.config.harness.maxSteps;
        setConfigStatus(
          `使用服务端默认配置${Number.isInteger(maxSteps) ? ` · 最大步数 ${maxSteps}` : ""}，尚未应用覆盖。`,
        );
      }
    } catch (error) {
      clear(skillCatalog);
      skillCatalog.append(el("span", "mini-dot"));
      skillCatalog.append(el("span", null, "Skill 目录未加载，仍可使用页面默认设置。"));
      setConfigStatus(`无法读取服务端配置：${readableError(error)}`, "error");
    }
  }

  function renderPreview(overrides) {
    clear(configPreview);
    const chips = [
      ["最大步数", overrides.harness.maxSteps],
      ["必填文件", `${overrides.checks.requiredFiles.length} 项`],
      ["禁用模式", `${overrides.checks.forbiddenPatterns.length} 项`],
      [
        "版本变化",
        overrides.checks.allowedBumps.length
          ? overrides.checks.allowedBumps.join(" / ")
          : "无",
      ],
      ["内容扫描", overrides.checks.scanContent ? "开" : "关"],
      ["文件名版本", overrides.checks.checkFilenameVersion ? "开" : "关"],
    ];
    for (const [label, value] of chips) {
      configPreview.append(el("span", "preview-chip", `${label} ${value}`));
    }
    configPreview.hidden = false;
  }

  function applyConfigOverrides() {
    const maxSteps = Number(configMaxSteps.value);
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
      setConfigStatus("最大步数需为 1–100 的整数。", "error");
      configMaxSteps.focus();
      return;
    }

    const requiredFiles = parseList(configRequiredFiles.value);
    const forbiddenPatterns = parseList(configForbiddenPatterns.value);
    const allowedBumps = Array.from(
      document.querySelectorAll('input[name="allowedBumps"]:checked'),
    ).map((input) => input.value);

    const overrides = {
      harness: { maxSteps },
      checks: {
        requiredFiles,
        forbiddenPatterns,
        allowedBumps,
        scanContent: configScanContent.checked,
        checkFilenameVersion: configFilenameVersion.checked,
      },
    };
    state.overrides = overrides;
    configState.textContent = "已应用";
    configState.dataset.applied = "true";
    setConfigStatus("覆盖已应用，将随下一次检测发送，不会写入配置文件。", "applied");
    renderPreview(overrides);
  }

  function resetConfigOverrides() {
    state.overrides = null;
    configState.textContent = "未应用";
    configState.dataset.applied = "false";
    clear(configPreview);
    configPreview.hidden = true;
    if (state.config) {
      fillConfigFields(state.config);
      const maxSteps = state.config.harness && state.config.harness.maxSteps;
      setConfigStatus(
        `已恢复服务端默认配置${Number.isInteger(maxSteps) ? ` · 最大步数 ${maxSteps}` : ""}。`,
      );
    } else {
      setConfigStatus("已清除覆盖，使用服务端默认配置。");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Events & init                                                           */
  /* ---------------------------------------------------------------------- */

  sourceTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (state.source === tab.dataset.source) return;
      setSource(tab.dataset.source, { clearFile: tab.dataset.source === "fixture" });
    });
  });

  artifactInput.addEventListener("change", () => {
    const file = artifactInput.files && artifactInput.files[0] ? artifactInput.files[0] : null;
    if (!file) {
      resetFileLabel();
      return;
    }
    setSource("upload", { clearFile: false });
    updateFileLabel(file);
  });

  fixtureSelect.addEventListener("change", () => {
    fixtureHint.textContent = FIXTURE_HINTS[fixtureSelect.value] || "";
  });

  inspectForm.addEventListener("submit", handleSubmit);
  refreshRuns.addEventListener("click", loadRuns);
  applyConfig.addEventListener("click", applyConfigOverrides);
  resetConfig.addEventListener("click", resetConfigOverrides);

  // Enter inside the override panel should apply the overrides, not submit a run.
  for (const field of [configMaxSteps, configRequiredFiles, configForbiddenPatterns]) {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyConfigOverrides();
      }
    });
  }

  $("endpoint").textContent = window.location.host || "127.0.0.1:4317";
  artifactInput.setAttribute("aria-describedby", "artifact-error file-meta");
  fixtureHint.textContent = FIXTURE_HINTS[fixtureSelect.value] || "";
  setSource("fixture", { clearFile: false });

  loadConfig();
  loadRuns();
})();
