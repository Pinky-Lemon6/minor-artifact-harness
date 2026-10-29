# 01 · Harness 循环

## 这一层解决什么问题

模型本身只会“读文本、出文本”。Harness 的循环负责：

1. 把任务、Skill、工具说明组装成模型能读的 prompt；
2. 让模型选择“调用工具”还是“给出最终答复”；
3. 执行工具，把结果作为观察写回对话；
4. 重复，直到模型完成、达到步数上限，或出错；
5. 把每一步写进 `trace.jsonl`，把 prompt 写进 `prompt.md`。

这层是 Harness 的心脏。工具、Skill、配置、表单都围绕它工作。

## 代码地图

| 文件 | 作用 |
|---|---|
| `src/harness/loop.ts` | Agent 循环、必检项强制执行、maxSteps |
| `src/harness/prompt.ts` | system/user prompt 组装，写 `prompt.md` |
| `src/harness/context.ts` | 一次运行的上下文：runId、工作目录、已加载 Skill、激活工具 |
| `src/harness/report.ts` | 把检查结果汇总成 `Report` |
| `src/models/mock.ts` | 脚本化模型：按计划返回 tool_call / final |
| `src/cli.ts` | `demo` / `inspect` / `serve` 入口 |

## 一次运行发生了什么

```text
RunInputs
  → loadConfig + validatePolicy
  → createRunContext（runDir、trace、activeToolNames）
  → buildSystemPrompt / buildUserPrompt → prompt.md
  → MockModel.complete()
      → tool_call → ToolRegistry.execute → observation → 写回 messages
      → final → 检查必检项 → 接受或继续
  → buildReport + ensureReport → report.json / report.md
```

`trace.jsonl` 每行是一个事件：`prompt`、`model`、`tool_call`、`observation`、`enforced`、`final`。网页的“运行轨迹”就是把它按时间线渲染出来。

## 小练习

1. 打开 `config/default.yaml`，把 `maxSteps` 改成 `2`，然后运行：

   ```bash
   npm run inspect -- --fixture good --version 1.5.0 --previous 1.4.2
   ```

   观察报告是否变成 `warn`、`reason` 是否为 `max_steps`，以及 `runs/<id>/trace.jsonl` 里是否出现 `enforced`。

2. 把 `fixtures/plans/agent-full-check.json` 里的 `checks.forbidden` 临时删掉，再跑一次，观察“missing required checks”的观察结果。

3. 打开 `runs/<id>/prompt.md`，找到工具说明和输出协议，对照 `trace.jsonl` 看模型实际收到了什么。

## 检查问题

- 为什么默认用 MockModel，而不是直接接真实模型？
- `report.incomplete` 和 `report.status` 分别表示什么？
- `trace.jsonl` 和 `prompt.md` 各自适合排查什么问题？
- 如果模型一直不调用某个必检工具，Harness 会怎么做？
