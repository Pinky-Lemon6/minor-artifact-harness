# 复盘：从零跑通一个 Harness

## 做成了什么

- 一个可运行的迷你 Harness：Agent 循环、工具注册表、Skill 加载、配置分层、HTTP 表单、报告与轨迹。
- 两种编排：Agent 模式与固定流程模式，共用同一套工具、策略和报告结构。
- 五项检测：版本一致性、必填文件、完整性、禁用文件、变更记录。
- 离线可跑：默认 MockModel，不依赖模型 API Key；`npm test` 45 个测试。
- 可观察：每次运行留下 `prompt.md`、`trace.jsonl`、`report.json`、`report.md`。
- 可回看：网页历史从 `runs/` 目录派生，刷新/重启后仍在。

## 四层各自学到了什么

| 层 | 关键问题 | 关键代码 |
|---|---|---|
| Harness 循环 | 模型怎么被约束、工具结果怎么回填、什么时候停 | `src/harness/loop.ts`、`src/harness/prompt.ts` |
| 工具 | 怎么把自然语言判断落到确定性代码，怎么防越权和路径穿越 | `src/tools/registry.ts`、`src/tools/artifact.ts`、`src/util/zip.ts` |
| Skill | 怎么把领域步骤写成可加载、可授权、可验证的作业指导书 | `src/skills/loader.ts`、`src/tools/skill.ts`、`skills/minor-artifact-check/` |
| 配置/表单 | 怎么让策略可改、让 Agent 不能放宽、让人能看见证据 | `src/config/`、`src/server/`、`web/` |

## 已知限制

- 默认只用 MockModel；真实模型适配器未实现，Skill 的语义效果还没有在真实模型上验证。
- 检测规则是沙盒规则，不代表公司内部真实规则；它们全部集中在配置和工具里，替换成本低。
- 没有登录、权限、多租户、数据库、部署；服务只绑 `127.0.0.1`。
- 内容扫描是尽力而为，不是安全扫描器。
- 结果写入文件系统；并发运行没有锁，适合单用户学习。

## 与 POC / 框架选型的关系

从零实现是选型基线。看框架时，用同一套验收标准逐项比较：

| 维度 | 要问的问题 | 本沙盒的答案 |
|---|---|---|
| 工具注册与校验 | 工具怎么注册、参数怎么校验、错误怎么回填 | `ToolRegistry` + zod + 结构化 `ToolResult` |
| Skill 加载/选择/权限 | 是否有渐进披露、工具交集、附带文件 | `SKILL.md` + `skill.load` / `skill.read` |
| 配置层级与复现 | 是否支持默认/本地/本次覆盖，是否记录生效配置 | 四级合并 + `config.json` + `configHash` |
| 表单/API 集成 | 前端怎么触发运行、怎么拿结果和轨迹 | `POST /api/inspect` + `/api/runs/:id/trace` |
| 轨迹与可观测性 | 能否看到 prompt、模型响应、工具调用、观察 | `prompt.md` + `trace.jsonl` |
| 离线测试与 Mock | 没有模型 Key 时能否跑测试 | `MockModel` + 45 个离线测试 |
| 技术栈匹配 | 与团队现有语言/部署/权限体系是否匹配 | Node 26 + TypeScript，单进程 |

建议 POC 时用同一份制品、同一套五项检查，分别用“本沙盒”和候选框架实现，记录：接入时间、代码量、Skill 机制差异、可观测性、调试成本。可把结果写到 `docs/framework-evaluation.md`。

## 迁移到真实任务时先问什么

1. 你们内部的 Harness 把“工具”叫什么？注册方式、参数 schema、权限模型是什么？
2. Skill 的格式和加载机制是什么？是否支持 references/assets、工具白名单、版本？
3. “流程配置”是 YAML/JSON、可视化编排，还是代码？表单提交后配置存在哪？
4. 真实“小版本制品检测”的规则是什么？制品从哪来（制品库、CI、本地）？失败后怎么反馈？
5. 有没有可用的模型端点？是否支持原生 tool calling？
6. 运行记录、审计、权限、并发有什么要求？

## 下一步

- 把 `docs/learning/` 五篇按顺序读一遍，每篇至少做一个小练习。
- 如果拿得到模型端点，实现 `src/models/openai-compat.ts`，用同一份 Skill 对比 MockModel 的行为。
- 拿内部 Harness 文档做一次映射：工具接口、Skill 格式、配置 schema、表单组件，哪些能直接复用，哪些要重写。
- 用上面的七维表做 POC 记录，再决定正式实现基于哪个框架。
