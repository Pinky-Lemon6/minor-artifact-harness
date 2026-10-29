# 小版本制品检测 Harness 设计

- 日期：2026-10-29
- 状态：待确认
- 任务：小版本制品检测
- 子任务：Harness 工具开发 / Harness-Skill 设计 / 流程配置 / 表单设计
- 目标读者：第一次接触 Harness 开发、希望通过一个可运行项目把全流程走一遍的开发者

## 1. 背景

“小版本制品检测”目前只有任务名和四个子任务，没有内部需求文档、既有代码或平台说明。因此这份设计不试图复刻某个内部系统，而是定义一个**可运行的学习沙盒**：

> 用一个小版本发布制品（zip + manifest）作为输入，开发一套迷你 Harness，完成检测工具、Skill、流程配置和表单四层，并把版本管理放到 GitHub 上。

学完后，换到公司内部 Harness 平台时，需要替换的是工具接口、Skill 格式、配置 schema 和表单组件；四层的职责、调用关系、开发顺序和调试方法不变。

## 2. 目标与非目标

### 2.1 目标

1. 能用自己的话解释 Harness 是什么，以及工具、Skill、配置、表单四层各自解决什么问题。
2. 从零实现一个可运行的迷你 Harness：Agent 循环、工具注册与调用、Skill 加载、配置合并、HTTP 表单。
3. 完成“小版本制品检测”的五项检查，并能用一个命令或一个网页表单跑出报告。
4. 做到“改配置不改代码”“改 Skill 不改代码”，亲眼看到配置和 Skill 对行为的影响。
5. 用 GitHub 远端仓库管理整个过程：初始化、提交、分支、至少一次 PR、CI 跑测试。
6. 留下可复用的学习文档和一套可以迁移到内部平台的骨架。

### 2.2 非目标

- 不做生产级平台：不做登录、权限、多租户、数据库、部署、审计。
- 不依赖真实大模型：默认用脚本化 MockModel 离线跑通；真实模型适配器作为可选扩展。
- 不接入真实制品仓库、CI/CD 或制品扫描服务。
- 不追求检测规则的完整性或安全性；规则是示例，重点是 Harness 结构。
- 不做通用 Agent 框架，不为其他任务提供插件市场。

### 2.3 失败标准（anti-goals）

即使代码能跑，以下情况也算这次学习失败：

- 只会点“运行”，说不清一次检测中模型、工具、Skill、配置各自做了什么。
- 所有规则硬编码在代码里，配置只是摆设。
- Skill 只是给模型看的一段提示词，没有加载、选择、工具权限这些机制。
- 表单只是把 CLI 包了一层，看不到运行轨迹和失败证据。
- 代码量很大，但关键机制被框架或抽象遮住。

## 3. 约束

- 工作目录为空，尚未初始化 git。
- 运行环境：Node.js 26、npm 11；Python 3.10 没有 pip；Java 8 / Gradle 4.10.3 偏旧。
- 没有可用的模型 API Key；不能假设能调用外部大模型。
- 没有 `gh` CLI；GitHub 账户已在 OpenChamber 中配置，但命令行侧尚未验证。
- 网络可用，npm 可安装依赖。
- 文档和 UI 使用中文；代码标识符使用英文。
- 学习优先：每个里程碑都要有可运行结果、可读的轨迹和一个小练习。

## 4. 方案选择

### A. 从零写一个迷你 Harness（已选）

用 Node.js + TypeScript 自己实现 Agent 循环、工具注册、Skill 加载、配置和 HTTP 表单；模型层做成可插拔，默认用脚本化 MockModel。

- 优点：每个零件都看得见；能把四个子任务完整摸一遍；不依赖模型 Key。
- 代价：骨架代码要自己写；MockModel 不能验证 Skill 的语义效果，只能验证加载、注入和权限。
- 适合：以学习全流程为目标。

### B. 基于现成 Agent 框架

用 LangGraph、OpenAI Agents SDK 或 Vercel AI SDK，把循环和工具调用交给框架。

- 优点：出活快，能快速看到 Agent 效果。
- 代价：关键机制被框架遮住；需要模型 Key；学到的更多是框架用法。
- 不适合：当前目标是理解 Harness 本身。

### C. 先做确定性检测流水线，再包 Agent 层

先把五项检查、配置和表单做成普通后端应用，最后补 Skill/Agent。

- 优点：最快看到可运行结果。
- 代价：上下文、工具选择、循环这些 Harness 核心会学得浅。
- 不适合：当前目标是学习 Harness 开发，而不是做检测工具。

**选择：A。** 同时保留 C 的一个优点：同一套工具既支持“固定流程模式”，也支持“Agent 模式”，用来对比确定性流水线和 Agent 编排的差别。

## 5. 沙盒场景：小版本制品检测

### 5.1 输入

- 一个制品 zip，例如 `demo-app-1.5.0.zip`。
- 声明版本，例如 `1.5.0`。
- 上一版本，例如 `1.4.2`。
- 检测策略：必填文件、禁用文件模式、允许的版本变化等。

### 5.2 制品结构

```text
demo-app-1.5.0.zip
├── manifest.json
├── README.md
├── LICENSE
├── CHANGELOG.md
├── package.json          # 可选
└── dist/
    └── app.js
```

`manifest.json` 示例：

```json
{
  "name": "demo-app",
  "version": "1.5.0",
  "files": [
    { "path": "README.md", "sha256": "…", "size": 1234 },
    { "path": "LICENSE", "sha256": "…", "size": 2345 },
    { "path": "CHANGELOG.md", "sha256": "…", "size": 3456 },
    { "path": "package.json", "sha256": "…", "size": 4567 },
    { "path": "dist/app.js", "sha256": "…", "size": 5678 }
  ],
  "changelog": "CHANGELOG.md"
}
```

`manifest.json` 本身不需要列进 `files`，并在完整性检查中豁免。除 `manifest.json`、目录和 OS 垃圾文件（`.DS_Store`、`Thumbs.db`、`__MACOSX/**`）之外，`files` 必须穷举制品中的所有负载文件；否则该文件会被判为“额外文件”。

### 5.3 五项检查

| 检查 | 内容 | 默认 |
|---|---|---|
| 版本一致性 | 声明版本 = manifest 版本 = package.json 版本；文件名中的版本（如能解析）一致；相对上一版本是 minor 或 patch | 必检 |
| 必填文件 | 配置中的必填文件全部存在 | 必检 |
| 完整性 | manifest 中每个文件存在、大小和 SHA-256 一致；默认不允许 manifest 之外的额外文件 | 必检 |
| 禁用文件 | 文件路径不匹配禁用模式（如 `*.env`、`*.pem`、`*.key`、`id_rsa*`）；可选内容扫描（私钥头、云访问密钥） | 必检（内容扫描默认关闭） |
| 变更记录 | `CHANGELOG.md` 中存在声明版本的标题行 | 必检 |

### 5.4 状态与判定契约

**检查级状态**

| 状态 | 含义 |
|---|---|
| `pass` | 检查通过 |
| `fail` | 检查发现确定的问题 |
| `warn` | 检查发现风险或无法完全验证，但不构成确定失败 |
| `skip` | 该检查/子项本次不适用，原因写在 evidence 中 |

五项检查默认都是必检项，**始终执行**；表单不能关闭整项检查，只能调整子项（文件名版本校验、内容扫描）。`skip` 只用于子项不适用（例如没有 `package.json`、文件名不含版本、没有上一版本可比），不用于“用户不想跑”。

**子项严重级别**

- 版本一致性：声明版本与 manifest/package.json/文件名不一致 → `fail`；无法解析文件名版本 → 子项 `skip`；缺少上一版本 → `fail`（无法验证小版本）。
- 完整性：manifest 列出的文件缺失、大小或哈希不符 → `fail`；额外文件 → `fail`。
- 禁用文件：路径命中禁用模式 → `fail`；内容扫描命中默认 → `warn`，可通过 `checks.contentScanSeverity: fail` 提升为 `fail`。
- 变更记录：找不到版本标题 → `fail`。
- 检查级状态取子项中最严重的状态（fail > warn > pass > skip）。

**整体状态**

| 整体 | 条件 |
|---|---|
| `fail` | 任一必检检查为 `fail` |
| `warn` | 没有 `fail`，但存在 `warn`；或必检检查未全部完成（`incomplete: true`）；或达到 maxSteps |
| `pass` | 所有必检检查为 `pass`，可选项没有 `warn`/`fail` |
| `error` | Harness 级错误：配置非法、制品无法读取、模型/计划异常、报告写入失败等 |

`error` 不是检查级状态，只出现在运行级 `report.status` 和表单徽章中。检查结果仍尽量保留，便于排查。

**未完成与报告兜底**

- 模型在还有必检项未执行时返回 `final`，Harness 拒绝该 final，追加一条 `missing required checks: ...` 的观察结果并继续循环。
- 达到 `maxSteps` 时，Harness 按固定顺序补跑缺失的必检项，写一份 `status: "warn"`、`incomplete: true`、`reason: "max_steps"` 的部分报告。
- 无论模型是否调用 `report.write`，Harness 在运行结束时都确保 `report.json` / `report.md` 存在；缺失时用已收集的检查结果补写，并记录 `report.fallback: true`。

### 5.5 输出

- 终端摘要。
- `runs/<runId>/report.json`：结构化结果。
- `runs/<runId>/report.md`：可读报告。
- `runs/<runId>/prompt.md`：本次实际发给模型的 system + user 消息（用于学习）。
- `runs/<runId>/trace.jsonl`：每一步模型响应、工具调用、工具结果和耗时。
- 网页表单中的结果面板与轨迹时间线。

## 6. 总体架构

```text
┌────────────────────────────── 表单 / CLI ──────────────────────────────┐
│  输入：制品、版本、策略、模式（agent / fixed）                          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                              Harness                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ 配置加载     │  │ Skill 加载/选择│  │ 上下文/提示词 │  │ 循环/流程执行 │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  └──────┬──────┘  │
│                                                              │         │
│  ┌──────────────────────────── 工具注册表 ───────────────────▼──────┐  │
│  │ artifact.open / artifact.manifest / checks.* / report.write      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
        ┌────────▼────────┐                 ┌────────▼────────┐
        │   MockModel     │                 │ OpenAICompatModel│
        │  脚本化计划      │                 │ 可选，真实模型    │
        └─────────────────┘                 └─────────────────┘
```

### 6.1 两种运行模式

- **Agent 模式**：Harness 把 Skill 元数据、已加载的 Skill、工具列表和任务交给模型；模型决定调用哪个工具；Harness 执行并回填结果；循环直到模型给出最终答复或达到步数上限。
- **固定流程模式**：Harness 按配置中的 `flow.stages` 依次调用工具，不经过模型。用于对比“确定性流水线”和“Agent 编排”，也用于 CI 中稳定复现。

两种模式共用同一套工具、同一套配置和同一套报告结构。

## 7. 四层设计

### 7.1 Harness 工具

工具是 Harness 的“手”：每个工具都有名称、说明、参数 schema、执行函数和权限。模型只能看到并调用当前允许的工具。

| 工具 | 作用 | 主要参数 | 返回 |
|---|---|---|---|
| `skill.load` | 按名称加载 Skill 正文并激活其工具集 | `name` | Skill 元数据、正文、附带文件索引、激活的工具列表 |
| `skill.read` | 读取已加载 Skill 目录内的参考文件或模板 | `name`、`path` | 文件内容（限制在 Skill 目录内） |
| `artifact.open` | 安全解压制品到本次运行的工作目录 | `source`（fixture/upload）、`fixture` | 文件列表、制品 SHA-256、大小 |
| `artifact.manifest` | 读取并校验 `manifest.json` | 无 | manifest 对象、校验问题 |
| `checks.version` | 版本一致性检查 | 无（从 `ctx.inputs` 取版本） | 检查结果 |
| `checks.required_files` | 必填文件检查 | 无（从生效配置取） | 检查结果 |
| `checks.integrity` | 文件存在性、大小、哈希检查 | 无（从 manifest 和生效配置取） | 检查结果 |
| `checks.forbidden` | 禁用文件模式与可选内容扫描 | 无（从生效配置取） | 检查结果 |
| `checks.changelog` | 变更记录检查 | 无（从生效配置和 `ctx.inputs` 取） | 检查结果 |
| `report.write` | 写 JSON/Markdown 报告 | 无（格式从生效配置取） | 报告路径 |

工具约定：

```ts
type ToolDefinition<Args> = {
  name: string;
  description: string;
  parameters: JsonSchema;          // 发给模型的参数说明
  schema: ZodType<Args>;           // 运行时校验
  execute(args: Args, ctx: RunContext): Promise<ToolResult>;
};
```

- 参数校验失败、工具不存在、工具未授权、执行异常，都转成结构化的错误观察结果返回给模型，而不是让进程崩溃。
- 工具只做确定性操作，不调用外部网络；默认 5 秒超时。
- 解压必须防路径穿越、绝对路径、符号链接、解压炸弹；上传大小上限 10 MB，解压后总大小上限 50 MB，文件数上限 2000。
- 工具不把密钥、绝对路径等敏感信息写进报告；轨迹中保留相对路径即可。

**参数与策略权限（裁决）**

- 工具参数只承载本次运行的输入（制品来源、声明版本、上一版本），不承载策略。
- 必填文件、禁用模式、允许的版本变化、是否扫描内容、是否允许额外文件等策略，只能来自生效配置（默认值 < `config/default.yaml` < `config/local.yaml` < 本次运行覆盖）。
- 模型和固定流程都不能通过工具参数放宽策略；工具从 `ctx.config` 读取策略。这样“改配置不改代码”的演示成立，Agent 也不能把检查改松。
- 固定流程与 Agent 模式走同一套工具注册表和授权：`flow.stages` 中的工具必须存在；`harness.toolAllowlist` 非空时必须包含它；配置校验阶段就报错。
- `harness.toolAllowlist` 非空时必须包含所有必检工具，否则配置非法，避免 Agent 模式无法完成必检项。

### 7.2 Harness-Skill

Skill 是 Harness 的“作业指导书”，采用 `SKILL.md` + YAML frontmatter 的形式：

```markdown
---
name: minor-artifact-check
description: 检测小版本发布制品，检查版本一致性、必填文件、完整性、禁用文件和变更记录。当任务要求检查小版本/补丁版本制品时使用。
version: 1
tools:
  - artifact.open
  - artifact.manifest
  - checks.version
  - checks.required_files
  - checks.integrity
  - checks.forbidden
  - checks.changelog
  - report.write
---

# 小版本制品检测流程

## 何时使用
…

## 输入
…

## 步骤
1. 调用 `artifact.open` 解压制品，确认文件列表。
2. 调用 `artifact.manifest` 读取 manifest。
3. 依次调用五项检查；不要跳过必检项。
4. 汇总结果，调用 `report.write` 写报告。
5. 用一段话给出结论，并列出失败项的修复建议。

## 判定规则
…

## 报告格式
…
```

机制设计：

- **渐进披露（默认 `auto`）**：系统提示词只放 Skill 的 `name`、`description` 和附带文件索引；模型必须调用 `skill.load`，Harness 才注入正文并激活其工具集。即使只有一个 Skill，也走这一步，保证 `skill.load` 在 trace 中可见。
- **预加载（`preload`）**：配置 `skillSelection: "preload"` 时，启动即加载 `activeSkills` 的正文和工具；系统提示词不要求 `skill.load`，用于对比上下文占用和工具可见性。
- **附带文件**：`skill.load` 返回 `references/`、`assets/` 的文件索引；模型用 `skill.read` 按需读取，路径限制在该 Skill 目录内，禁止 `..` 和绝对路径。`report.write` 默认使用 `assets/report-template.md` 渲染 Markdown，模板缺失时回退到内置模板。
- **工具权限**：Skill 的 `tools` 列表与配置的 `harness.toolAllowlist` 取交集；不在交集内的工具即使模型点名也会被拒绝。
- **选择策略**：`activeSkills` 非空时只暴露这些 Skill 的元数据；为空时暴露全部 Skill 的元数据。多 Skill 的语义选择留给真实模型或后续版本；v1 不做自动语义匹配。
- **可验证性**：每次运行输出 `prompt.md`，可以直接看到 Skill 正文是否进入提示词；`trace.jsonl` 记录 `skill.load` / `skill.read` 的参数和返回；M3 的验收要求 trace 中出现 `skill.load`。

### 7.3 流程配置

配置决定“这次怎么跑”，不决定“检测逻辑是什么”。检测逻辑在工具和 Skill 里，配置只做策略和编排。

```yaml
harness:
  maxSteps: 16
  skillDirs: [skills]
  activeSkills: [minor-artifact-check]
  skillSelection: auto        # auto | preload
  toolAllowlist: []           # 空表示不额外限制；非空时必须包含所有必检工具，并与 Skill 工具集取交集

model:
  adapter: mock               # mock | openai-compat
  mock:
    planFile: fixtures/plans/agent-full-check.json
  openaiCompat:
    baseUrl: https://api.example.com/v1
    apiKeyEnv: OPENAI_API_KEY
    model: your-model
    temperature: 0

flow:
  mode: agent                 # agent | fixed
  stages:                     # fixed 模式使用
    - tool: artifact.open
    - tool: artifact.manifest
    - tool: checks.version
    - tool: checks.required_files
    - tool: checks.integrity
    - tool: checks.forbidden
    - tool: checks.changelog
    - tool: report.write

checks:
  requiredFiles: [manifest.json, README.md, LICENSE, CHANGELOG.md]
  forbiddenPatterns: ["*.env", "*.pem", "*.key", "id_rsa*"]
  scanContent: false
  contentScanSeverity: warn   # warn | fail
  allowedBumps: [minor, patch]
  changelogFile: CHANGELOG.md
  allowExtraFiles: false

report:
  outputDir: runs
  formats: [json, markdown]
  template: skills/minor-artifact-check/assets/report-template.md

runs:
  retainArtifacts: true       # 运行结束后保留 runs/<id>/artifact.zip

server:
  host: 127.0.0.1
  port: 4317
```

配置优先级（后者覆盖前者）：

1. 代码内默认值
2. `config/default.yaml`
3. `config/local.yaml`（gitignore，个人覆盖）
4. 表单/CLI 的本次运行覆盖

加载后用 Zod 校验，错误信息要指出具体字段和期望值。每次运行把“生效配置”写入 `runs/<runId>/config.json`，便于复现。

### 7.4 表单

表单是给不写代码的人用的入口，也是观察 Harness 的窗口。单页，两栏，窄屏堆叠。

**左侧：检测输入**

- 制品来源：上传 zip / 选择示例制品（good、bad-version、bad-hash、forbidden、missing-file）。
- 声明版本、上一版本。
- 运行模式：Agent / 固定流程。
- Skill 选择：按需加载 / 预加载。
- 五项检查始终执行，不提供整项开关；只提供可选子项：文件名版本校验、内容扫描，以及允许的版本变化（minor / patch）。
- “开始检测”按钮；运行中显示步骤状态。

**右侧：检测结果**

- 总体状态徽章：通过 / 警告 / 不通过 / 出错。
- 摘要：通过数、失败数、耗时、制品哈希。
- 检查结果表：检查项、状态、摘要、证据（可展开）。
- 报告下载：JSON / Markdown。
- 轨迹面板：按时间线展示 `skill.load`、工具调用、观察结果、模型最终答复；点击可看原始 JSON。
- 最近运行列表：时间、制品、状态，可回看。

**流程配置区**

- 折叠面板，编辑本次运行的覆盖项：最大步数、必填文件、禁用模式、允许的版本变化、内容扫描开关。
- “应用为本次运行”后展示生效配置预览；“恢复默认”清空覆盖。
- v1 只做本次运行覆盖，不写回 `config/default.yaml`，避免表单误改仓库配置。

**状态与错误**

- 空状态：说明“上传制品或选一个示例”。
- 运行中：禁用按钮，显示当前阶段。
- 校验错误：字段级提示。
- Harness 错误：显示错误码和可读信息，保留轨迹。
- 报告过大：表格分页或只显示前 N 条证据。

**视觉方向**

检测台/控制台风格：中性浅色背景、一个主强调色（蓝绿）、状态色（绿/琥珀/红）、版本号和哈希用等宽字体、卡片式分区、清晰的层级和留白。具体视觉由 designer 在实现阶段细化，但结构、字段和状态以上述为准。

### 7.5 运行历史与读取 API

- 历史从 `runs/` 目录派生，不使用数据库；服务重启后仍可查看。
- `GET /api/runs`：列出 `runs/*/report.json` 的摘要（runId、时间、制品、状态、模式），按时间倒序，默认 20 条。
- `GET /api/runs/:id`：返回 `report.json`。
- `GET /api/runs/:id/trace`：返回解析后的 `trace.jsonl` 数组。
- `GET /api/runs/:id/report.md` / `report.json`：下载报告。
- `POST /api/inspect`：创建运行；上传的 zip 存在 `runs/<id>/artifact.zip`，是否保留由 `runs.retainArtifacts` 决定。
- runId 只允许 `[A-Za-z0-9_-]`，所有路径拼接前做白名单校验，防目录穿越。
- CLI 运行和网页运行写同一个 `runs/`，所以 CLI 产生的记录也会出现在网页历史里。

## 8. 运行时

### 8.1 Agent 循环

```text
1. 创建 runId、工作目录、trace。
2. 加载并合并配置；校验；写入 runs/<runId>/config.json。
3. 加载 Skill 元数据；按配置决定预加载或等待 skill.load。
4. 组装 system prompt：Harness 约定 + 可用 Skill 元数据 + 已加载 Skill 正文 + 工具列表 + 输出协议。
5. messages = [system, user(task, inputs)]；写入 prompt.md。
6. 循环最多 maxSteps 次：
   a. model.complete(messages, tools) → tool_call | final。
   b. 记录 trace。
   c. final → 检查必检项是否都执行过；缺项则拒绝 final，追加“missing required checks: …”观察并继续；齐全则结束。
   d. tool_call → 校验授权与参数 → 执行 → 记录观察结果 → 追加到 messages。
7. 达到 maxSteps：按固定顺序补跑缺失的必检项，写 `status: "warn"`、`incomplete: true`、`reason: "max_steps"` 的部分报告。
8. 无论模型是否调用 report.write，结束时确保报告存在；缺失时用已收集的检查结果补写，记录 `report.fallback: true`。
9. 返回最终答复和报告路径。
```

模型响应协议（内部统一格式）：

```ts
type ModelResponse =
  | { type: "tool_call"; tool: string; args: unknown; thought?: string }
  | { type: "final"; content: string };
```

- `MockModel` 读取计划文件，按顺序返回预设的 `tool_call` / `final`，并可断言上一条观察结果，保证测试确定性。
- `OpenAICompatModel` 把内部协议映射到 OpenAI 风格的 `tools` / `tool_calls`；没有原生工具调用能力的模型走 JSON 文本解析作为降级。
- 真实模型适配器是可选里程碑；没有 Key 时不影响主线。

**MockModel 计划（裁决）**

- 使用参数化计划：步骤里的 `${declaredVersion}`、`${previousVersion}`、`${fixture}` 等占位符从 `ctx.inputs` 解析。
- 计划文件：
  - `agent-full-check.json`：`skill.load` → `artifact.open` → `artifact.manifest` → 五项检查 → `report.write` → `final`。同一份计划可跑好/坏制品，结论由工具结果决定。
  - `agent-preloaded.json`：不调用 `skill.load`，用于 `preload` 对比。
  - `agent-missing-required.json`：故意漏掉一项必检，验证 Harness 拒绝 final 并补跑。
  - `agent-denied-tool.json`：调用未授权工具，验证错误观察。
- 计划耗尽：视为模型错误，写 `status: "error"`、`reason: "mock_plan_exhausted"` 的报告，保留 trace。
- 计划断言失败（期望的观察结果与实际不符）：写 `status: "error"`、`reason: "plan_assertion_failed"`，测试据此定位。
- 配置不会关闭整项必检，因此不存在“计划期望的检查被配置关掉”的情况；可选子项由检查内部返回 `skip` / `warn`。

### 8.2 固定流程

按 `flow.stages` 顺序执行；工具从 `ctx.inputs` 取本次运行输入，从 `ctx.config` 取策略。每一步都写 trace；最后 `report.write` 生成报告。没有模型调用，结果可复现。

固定流程也走工具注册表和授权，但**不加载 Skill**：`flow.stages` 中的工具必须存在；`harness.toolAllowlist` 非空时必须包含它；配置校验阶段就报错。Skill 的 `tools` 列表在固定模式下不参与，这是两种模式的明确差异。配置校验还要求 `flow.stages` 覆盖所有必检工具。

### 8.3 轨迹与提示词

- `trace.jsonl` 每行一个事件：`step`、`type`、`tool`、`args`、`result`、`durationMs`、`error`。
- `prompt.md` 保存 system + user 消息原文；不保存 API Key。
- 这两个文件是学习 Harness 最重要的证据：能直接看到“Skill 有没有进去”“工具描述长什么样”“模型看到了什么”。

## 9. 目录结构

```text
minor-artifact-harness/
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore
├── .github/
│   └── workflows/ci.yml
├── config/
│   ├── default.yaml
│   └── local.yaml.example
├── docs/
│   ├── superpowers/specs/2026-10-29-minor-artifact-harness-design.md
│   └── learning/
│       ├── 01-harness-loop.md
│       ├── 02-tools.md
│       ├── 03-skills.md
│       ├── 04-config-and-flow.md
│       └── 05-form-and-report.md
├── fixtures/
│   ├── good/
│   ├── bad-version/
│   ├── bad-hash/
│   ├── forbidden/
│   ├── missing-file/
│   ├── plans/
│   └── make-fixtures.ts
├── skills/
│   └── minor-artifact-check/
│       ├── SKILL.md
│       ├── references/check-rules.md
│       └── assets/report-template.md
├── src/
│   ├── cli.ts
│   ├── harness/
│   │   ├── types.ts
│   │   ├── loop.ts
│   │   ├── flow.ts
│   │   ├── context.ts
│   │   ├── prompt.ts
│   │   └── trace.ts
│   ├── models/
│   │   ├── mock.ts
│   │   └── openai-compat.ts
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── artifact.ts
│   │   ├── checks.ts
│   │   ├── report.ts
│   │   └── skill.ts
│   ├── skills/
│   │   ├── loader.ts
│   │   └── selector.ts
│   ├── config/
│   │   ├── schema.ts
│   │   └── load.ts
│   ├── server/
│   │   ├── server.ts
│   │   └── routes.ts
│   └── util/
│       ├── zip.ts
│       ├── hash.ts
│       └── errors.ts
├── web/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── tests/
│   ├── config.test.ts
│   ├── skills.test.ts
│   ├── tools.test.ts
│   ├── harness.test.ts
│   └── server.test.ts
└── runs/                     # gitignore，运行产物
```

## 10. 技术选型

| 选择 | 理由 |
|---|---|
| Node.js 26 + TypeScript | 环境现成；Node 26 可直接运行可擦除语法的 TS，省掉构建步骤；前后端同语言 |
| `fflate` | 纯 JS 的 zip 读写，体积小，便于测试中生成制品 |
| `yaml` | 配置和 SKILL.md frontmatter 解析 |
| `zod` | 配置和工具参数校验；Zod 4 可生成 JSON Schema |
| `semver` | 版本比较和 diff，避免手写边界错误 |
| Node 内置 `http` + 原生 HTML/CSS/JS | 不引入 Web 框架，聚焦 Harness；表单不需要构建链 |
| Node 内置 `node:test` | 零额外测试框架，离线可跑 |
| `typescript`（dev） | 只做 `tsc --noEmit` 类型检查 |

如果实现时发现 Node 原生 TS 类型擦除有限制（例如某些语法不支持），回退到 `tsx` 作为运行器，其他设计不变。

## 11. 学习与开发里程碑

每个里程碑都产出一个可运行版本、一篇 1–2 页的讲解、一个小练习和一次 git 提交。默认由我实现代码并逐段讲解，你负责运行、提问、做练习和提交；如果你想自己写关键部分，告诉我，我改成结对模式。

| 里程碑 | 交付 | 学到的概念 | 验证方式 |
|---|---|---|---|
| M0 仓库与文档 | git 初始化、README、目录骨架、CI、设计文档 | 仓库结构、提交规范、远端流程 | `git log` 有第一条提交；CI 能跑 |
| M1 Harness 骨架 | 类型、配置加载、工具注册表、MockModel、循环、CLI、trace | Agent 循环、上下文、工具协议、最大步数 | `npm run demo` 跑通一个 echo 工具和脚本化计划 |
| M2 检测工具 | 安全解压、manifest、五项检查、报告写入、fixtures、单测 | 工具设计、参数校验、确定性检查、错误处理 | 好/坏制品分别得到 pass/fail；`npm test` 通过 |
| M3 Skill 机制 | SKILL.md、frontmatter 解析、按需加载、工具权限、prompt.md | Skill 设计、渐进披露、提示词组装、权限交集 | trace 中出现 `skill.load`；prompt.md 含 Skill 正文；越权工具被拒绝 |
| M4 配置与流程 | 配置 schema、优先级、固定流程、Agent/固定对比 | 配置设计、策略与逻辑分离、两种编排 | 改配置得到不同结果；同一制品两种模式报告一致 |
| M5 表单与报告 | HTTP 服务、上传、表单、结果面板、轨迹时间线、运行历史 | 表单设计、API 集成、状态与错误、可观察性 | 浏览器上传好坏制品，看到报告和轨迹 |
| M6 GitHub 与收尾 | 远端仓库、分支、至少一次 PR、CI 绿、README 截图、复盘 | 分支/PR/CI、版本管理、复盘 | 远端能看到完整历史；CI 通过；你能讲清四层 |

规模判断：这是一个**项目级**的学习任务，不是一次小改动。AI 写代码和文档很快，主要时间花在你阅读、运行、做练习和打通 GitHub 访问上。按每次 1–2 小时的节奏，预计 2–4 个专注日；如果 GitHub 账户/仓库权限需要等待，时间会更长。

## 12. 测试与验收

### 12.1 自动化测试

- 配置：默认值、覆盖顺序、非法字段报错；`toolAllowlist` 缺少必检工具时报错；`flow.stages` 缺少必检工具时报错。
- Skill：frontmatter 解析、缺字段报错、按需加载、预加载、工具交集、prompt 注入；`skill.read` 读取 references/assets、路径穿越被拒绝；报告模板回退。
- 工具：好/坏制品的五项检查；完整性额外文件豁免（manifest.json、目录、OS 垃圾）；版本契约（声明 / manifest / package.json / 文件名 / semver diff / 缺少上一版本）；zip 路径穿越、超大文件、缺失 manifest；哈希不匹配；禁用文件；内容扫描的 warn/fail 严重级别；changelog 缺失。
- 状态：检查级 pass/fail/warn/skip 的聚合；error 运行级状态；maxSteps 部分报告；final 缺必检项被拒绝；报告兜底。
- Harness：MockModel 正常结束、计划耗尽、计划断言失败、工具报错后继续、未授权工具被拒绝。
- 固定流程：阶段顺序、参数默认值、授权校验、报告生成；Agent/固定同一制品结论一致。
- 服务：`POST /api/inspect` 返回结构、错误输入、报告下载、路径穿越防护；`GET /api/runs` 从目录派生、重启后仍可读、CLI 运行可见。

### 12.2 手工验收

1. `npm test` 全绿，且离线可跑。
2. `npm run inspect -- --fixture good --version 1.5.0 --previous 1.4.2` 输出 `pass`。
3. 坏制品输出 `fail`，失败项与预期一致。
4. `npm run dev` 后打开表单，上传好坏制品，能看到结果、证据和轨迹。
5. 修改 `config/default.yaml` 的必填文件，不改代码，结果变化。
6. 修改 `SKILL.md` 的步骤或工具列表，`prompt.md` 和 trace 变化；越权工具被拒绝。
7. 同一个制品分别用 Agent 和固定流程跑，报告结论一致。
8. GitHub 远端有完整提交历史，至少一个 PR，CI 绿。

## 13. GitHub 版本管理

- 仓库名建议：`minor-artifact-harness`（个人账号或公司组织待定）。
- 初始化：`main` 分支，提交 M0 的 README、设计文档、`.gitignore`、CI。
- 提交规范：Conventional Commits，例如 `feat(harness): add tool registry`、`test(checks): cover bad hash`、`docs(learning): add skill notes`。
- 分支：每个里程碑一个 `feat/mN-...` 分支；能创建 PR 时走 PR 自查后合并，不能时本地合并后推送，保证 `main` 始终可运行。
- 至少走通一次完整 PR：分支 → 提交 → PR → CI → 合并，作为版本管理练习。
- 标签：M5 完成后打 `v0.1.0`。
- CI：GitHub Actions，`npm ci` → `npm run typecheck` → `npm test`。
- `runs/`、`config/local.yaml`、`node_modules/` 加入 `.gitignore`；示例制品和生成脚本入库。

当前环境没有 `gh` CLI，SSH Key 也未绑定 GitHub。仓库创建和账户绑定建议在 OpenChamber 的 Git 面板完成；命令行推送使用 OpenChamber 提供的凭据助手或你已有的 PAT。若远端暂时打不通，先在本地完成里程碑提交，最后统一推送，不阻塞学习。

## 14. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 没有真实模型 Key | 只能验证 Skill 的加载和注入，不能验证语义效果 | 默认 MockModel；保留 OpenAI 兼容适配器；用 `prompt.md` 和 trace 观察机制；你有内部端点时再接入 |
| 检测规则是虚构的 | 与公司内部规则不一致 | 规则全部放配置和工具；换规则不改骨架；把“五项检查”当作示例 |
| 范围膨胀 | 学不完、做不完 | 严格按 M0–M6；非目标清单；每个里程碑可运行即可 |
| GitHub 权限/网络 | 无法推送或建 PR | OpenChamber Git 面板、PAT、或先本地提交后补推；不阻塞代码 |
| Node 原生 TS 限制 | 某些语法不能直接跑 | 使用可擦除语法；必要时改用 `tsx` |
| 表单吸引过多时间 | Harness 核心没学透 | 表单先做结构和状态，视觉最后由 designer 细化；M5 之前不做复杂 UI |

## 15. 我做的决定（你可以逐条否决）

1. 仓库名用 `minor-artifact-harness`，技术栈用 Node 26 + TypeScript。
2. 默认 MockModel，真实模型适配器可选；不把模型 Key 作为前置条件。
3. 同一套工具支持 Agent 模式和固定流程模式，用来对比两种编排。
4. Skill 采用 `SKILL.md` + YAML frontmatter，支持按需加载和预加载。
5. 表单用原生 HTML/CSS/JS，不引入 React 或构建链；v1 只做本次运行覆盖，不写回默认配置。
6. 检测规则是示例，重点是四层结构；以后换内部规则只换工具和 Skill。
7. 学习文档用中文，代码标识符用英文；每个里程碑配一个小练习。
8. 五项检查始终执行，必检项由 Harness 强制执行；`skip` 只用于不适用子项；运行级增加 `error` 状态。
9. 策略只来自配置，工具参数只承载运行输入；模型和固定流程都不能放宽策略。
10. Skill 默认渐进披露（`auto` 必须经过 `skill.load`），`preload` 仅用于对比；`skill.read` 读取 `references/` 和 `assets/`，报告使用模板。
11. MockModel 使用参数化计划，覆盖正常、漏检、越权、计划耗尽等场景；报告有兜底。
12. 运行历史从 `runs/` 目录派生，不使用数据库；固定流程也走注册表和授权。

## 16. 待你确认

1. **GitHub 账号与仓库**：用哪个 GitHub 用户名/组织？仓库名是否用 `minor-artifact-harness`？公开还是私有？
2. **动手程度**：默认我写代码、你运行和做练习；还是你想自己写关键模块（例如工具注册表和 Skill 加载器），我在旁边讲解和 review？
3. **检测场景**：五项检查（版本、必填文件、完整性、禁用文件、变更记录）是否符合你对“小版本制品检测”的直觉？如果你们内部实际检测的是别的东西，告诉我关键词，我替换沙盒规则。

这三个问题不阻塞我继续完善设计；你确认后，我进入开发计划并开始 M0。

## 17. 评审后裁决（我的决定）

独立评审提出的实现层问题，已被我在正文中裁决。这里留一份索引，方便你快速否决或调整：

| # | 问题 | 裁决 |
|---|---|---|
| 1 | 状态语义 | 检查级 `pass/fail/warn/skip`；运行级 `pass/warn/fail/error`；整体规则见 §5.4；maxSteps 写 `warn` 部分报告；模型缺必检项时拒绝 final；报告有兜底 |
| 2 | 什么算额外文件 | `manifest.json`、目录、OS 垃圾文件豁免；`manifest.files` 必须穷举其余负载文件；示例 manifest 已补全 |
| 3 | 版本检查契约 | 以表单/CLI 的 `declaredVersion` 为准；缺 `previousVersion` 判 `fail`；major / 预发布默认 `fail`；没有 `package.json` 或文件名不可解析时子项 `skip`；版本不一致判 `fail` |
| 4 | 参数优先级 | 策略只来自生效配置；工具参数只承载运行输入；模型不能放宽策略；固定流程共享同一授权路径 |
| 5 | auto vs preload | `auto` 只暴露元数据，必须调用 `skill.load`；`preload` 启动即加载；M3 验收要求 trace 出现 `skill.load` |
| 6 | references/assets | `skill.load` 返回文件索引；`skill.read` 按需读取；`report.write` 使用报告模板 |
| 7 | MockModel 计划 | 参数化计划；覆盖 full / preloaded / missing-required / denied-tool；计划耗尽或断言失败写 `error` 报告 |
| 8 | 固定流程授权 | 走同一注册表和 `toolAllowlist`；不加载 Skill；配置校验要求 `flow.stages` 覆盖必检工具 |
| 9 | 运行历史 | 从 `runs/` 派生，无数据库；提供列表/详情/轨迹/报告接口；上传保留可配置；runId 白名单防穿越 |
