# 04 · 配置与流程

## 这一层解决什么问题

配置决定“这次怎么跑”，不决定“检测逻辑是什么”。检测逻辑在工具和 Skill 里；配置只做策略和编排。这样同一套代码可以跑不同的规则，而 Agent 不能把检查改松。

四层优先级：

```text
代码默认值
  < config/default.yaml
  < config/local.yaml（gitignore，个人覆盖）
  < 表单/CLI 的本次运行覆盖
```

数组是“替换”，不是“合并”。`allowedBumps: [patch]` 会整体替换掉默认的 `[minor, patch]`。

## 代码地图

| 文件 | 作用 |
|---|---|
| `src/config/schema.ts` | 类型、zod schema、默认值、深合并 |
| `src/config/load.ts` | 读取 YAML、拒绝未知 section、按优先级合并 |
| `src/config/policy.ts` | 校验 fixed 流程、allowlist、Skill 是否覆盖必检工具 |
| `src/harness/flow.ts` | 固定流程：按 `flow.stages` 顺序执行工具 |
| `src/harness/loop.ts` | Agent 模式：必检项强制执行、maxSteps 补跑 |
| `config/default.yaml` | 默认配置 |

## 两种模式

**Agent 模式**：模型决定调用顺序；Harness 在 `final` 前检查必检项，缺项就拒绝 final 并继续循环；达到 `maxSteps` 时按固定顺序补跑缺失检查。

**固定流程模式**：按 `flow.stages` 顺序执行，不经过模型。配置校验要求 stages 覆盖 `artifact.open`、`artifact.manifest`、五项检查和 `report.write`。

两种模式共用同一套工具、策略和报告结构。用同一个 good 制品跑两种模式，检查结果应该一致。

## 策略不能由模型放宽

- 工具参数只承载运行输入（制品来源、版本），不承载策略；
- 必填文件、禁用模式、允许的版本变化、内容扫描等都从 `ctx.config` 读取；
- `harness.toolAllowlist` 非空时，必须包含所有必检工具，否则配置非法；
- Skill 的 `tools` 与 allowlist 取交集。

这样“改配置不改代码”的演示才成立，Agent 也不能通过传参把检查改松。

## 小练习

1. 把 `allowedBumps` 改成 `[patch]`，用 `declaredVersion: 1.6.0` 跑 good 制品，观察版本检查失败。
2. 把 `maxSteps` 改成 `2`，用 `agent-open-only.json` 计划跑一次，观察 Harness 自动补跑 manifest 和五项检查，报告为 `warn` + `incomplete`。
3. 把 `toolAllowlist` 改成 `[artifact.open]`，运行 `npm run inspect`，看配置校验如何拒绝。
4. 把 `mode` 切到固定流程，对比 Agent 模式的报告和 trace 差异。

## 检查问题

- 为什么 fixed 模式不加载 Skill？这是设计选择还是限制？
- `required_check_unavailable` 在什么情况下出现？
- 如果 `local.yaml` 和表单覆盖同时存在，谁生效？
- 为什么数组要替换而不是合并？
