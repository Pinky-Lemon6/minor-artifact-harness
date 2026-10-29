# 03 · Harness-Skill

## 这一层解决什么问题

Skill 是 Harness 的“作业指导书”。工具告诉模型“能做什么”，Skill 告诉模型“什么时候做、按什么步骤做、怎么判断、报告怎么写”。

一个 Skill 不是一段随便的提示词，它至少有：

- 元数据：`name`、`description`、`version`、`tools`；
- 正文：适用场景、输入、步骤、判定规则、报告格式；
- 可选附带文件：`references/` 放详细规则，`assets/` 放模板；
- 工具权限：Skill 只能激活它声明的工具，并与全局 allowlist 取交集。

## 代码地图

| 文件 | 作用 |
|---|---|
| `skills/minor-artifact-check/SKILL.md` | 本项目的 Skill 定义 |
| `skills/minor-artifact-check/references/check-rules.md` | 五项检查的详细规则 |
| `skills/minor-artifact-check/assets/report-template.md` | 报告模板 |
| `src/skills/loader.ts` | 解析 frontmatter、加载正文和文件索引 |
| `src/tools/skill.ts` | `skill.load` / `skill.read` |
| `src/harness/prompt.ts` | 把 Skill 元数据、正文、工具描述组装进 prompt |
| `src/harness/context.ts` | `auto` 与 `preload` 两种加载策略 |

## 渐进披露

默认 `skillSelection: auto`：

1. system prompt 只列出 Skill 的 `name` 和 `description`；
2. 模型调用 `skill.load({name:"minor-artifact-check"})`；
3. Harness 把正文和文件索引注入 prompt，并激活 Skill 的工具；
4. 模型再调用 `checks.*` 和 `report.write`。

`preload` 会在启动时直接加载 `activeSkills` 的正文和工具，用来对比“上下文占用”和“工具可见性”。两种模式都能跑，但 trace 里 `auto` 会多一个 `skill.load` 步骤。

`references/` 和 `assets/` 不是装饰：`skill.load` 返回文件索引，模型需要细节时用 `skill.read` 按需读取；`report.write` 使用 `assets/report-template.md` 渲染 Markdown。

## 小练习

1. 把 `SKILL.md` 的步骤 3 改成“先跑完整性，再跑版本”，运行 good 制品，对比 `prompt.md` 和 trace。MockModel 不会真的改变计划，但你会看到 Skill 正文已经进入 prompt；换成真实模型后，步骤顺序会影响行为。
2. 在 `SKILL.md` 的 `tools` 列表里删掉 `checks.forbidden`，运行一次。`validatePolicy` 会拒绝缺少必检工具的 Skill（这是 Harness 的策略校验，不是模型的选择）。
3. 用 `skill.read` 读取 `references/check-rules.md`：在 prompt 或 trace 里找到这次读取。
4. 把 `skillSelection` 改成 `preload`，对比 prompt 长度和 trace 中是否还有 `skill.load`。

## 检查问题

- 为什么不把所有 Skill 的正文一次性塞进 system prompt？
- Skill 的 `tools` 列表和 `harness.toolAllowlist` 是什么关系？
- `skill.load` 和 `skill.read` 为什么要分成两个工具？
- 如果 Skill 正文和 Harness 的输出协议冲突，谁优先？
