# 02 · Harness 工具

## 这一层解决什么问题

工具是 Harness 的“手”。模型自己不能读 zip、算哈希、读 manifest；它只能请求调用工具。工具把不确定的自然语言判断，落到确定性的代码上。

一个好的工具要有：

- 明确的名称和描述（模型靠它选择工具）；
- 参数 schema（运行时校验，防止模型乱传）；
- 结构化的返回（`ok`、`summary`、`data`、`error`）；
- 明确的权限（不在 allowlist 里的工具不能被调用）；
- 超时和错误兜底（工具失败不能让整个进程崩溃）。

## 代码地图

| 文件 | 作用 |
|---|---|
| `src/tools/registry.ts` | 注册、授权、参数校验、5 秒超时、错误归一 |
| `src/tools/artifact.ts` | `artifact.open` / `artifact.manifest`，安全解压 |
| `src/util/zip.ts` | `yauzl` 读取 zip，拒绝路径穿越、绝对路径、symlink、超限 |
| `src/util/hash.ts` | SHA-256 |
| `src/tools/checks.ts` | 五项检查与对应工具 |
| `src/tools/report.ts` | `report.write` |
| `src/tools/index.ts` | `createRegistry()` 把所有工具装进注册表 |

## 一次运行发生了什么

以 `checks.integrity` 为例：

1. 模型返回 `{"type":"tool_call","tool":"checks.integrity","args":{}}`。
2. `ToolRegistry.execute` 检查工具存在、在 `activeToolNames` 里、参数通过 zod。
3. 调用 `checkIntegrity(ctx)`：遍历 `manifest.files`，比对存在性、大小、SHA-256；再扫描额外文件。
4. 返回 `{ ok: true, summary: "integrity fail: sha256 mismatch ...", data: CheckResult }`。
5. 结果写入 `ctx.checkResults`，并作为 observation 回到模型；同时写进 `trace.jsonl`。

注意：`ok` 表示“工具执行成功”，不表示“检查通过”。检查的结论在 `data.status` 里（`pass/fail/warn/skip`）。

## 小练习

1. 在 `config/default.yaml` 的 `checks.requiredFiles` 里加一个不存在的文件，运行 good 制品，观察“必填文件”检查失败。
2. 在 `forbiddenPatterns` 里加 `*.log`，在 `fixtures/make-fixtures.ts` 里给 good 制品加一个 `debug.log`，观察禁用文件检查。
3. 打开 `fixtures/plans/agent-full-check.json`，把 `checks.integrity` 移到 `checks.version` 前面，观察 trace 顺序变化、结论是否不变。
4. 尝试在 `artifact.open` 里传 `fixture: "../etc/passwd"`，看工具如何拒绝。

## 检查问题

- 为什么策略（必填文件、禁用模式）只能来自配置，不能由模型在工具参数里放宽？
- `ok: false` 和 `status: "fail"` 的区别是什么？
- 如果一个工具没有在 `activeToolNames` 里，模型点名调用会发生什么？
- 为什么解压前要限制 entry 数量和解压后大小？
