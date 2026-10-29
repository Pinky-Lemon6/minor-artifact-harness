# 05 · 表单与报告

## 这一层解决什么问题

表单是给不写代码的人用的入口，也是观察 Harness 的窗口。报告和轨迹把一次运行变成可检查的证据：不是“模型说通过了”，而是每一项检查的证据、每一步工具调用都能回看。

## 代码地图

| 文件 | 作用 |
|---|---|
| `src/server/server.ts` | 创建 HTTP 服务 |
| `src/server/routes.ts` | `/api/inspect`、`/api/config`、`/api/runs`、报告下载、静态文件 |
| `src/server/runStore.ts` | 从 `runs/` 目录派生历史，runId 白名单 |
| `src/tools/report.ts` | 写 `report.json` / `report.md`，模板回退 |
| `src/harness/report.ts` | 汇总 `Report`（状态、摘要、证据、configHash） |
| `web/index.html` | 表单结构（固定 ID） |
| `web/app.js` | 提交、渲染结果、轨迹、历史、配置覆盖 |
| `web/styles.css` | 检测台风格、响应式布局 |

## 一次请求发生了什么

```text
浏览器提交
  → POST /api/inspect
  → 合并 overrides，构造 RunInputs
  → executeRun：创建 runs/<id>/，跑 Agent/fixed
  → report.json + report.md + trace.jsonl + prompt.md
  → 返回 { runId, status, report }
  → 前端再 GET /api/runs/:id/trace 渲染时间线
```

`GET /api/runs` 直接读 `runs/*/report.json`，所以刷新页面、重启服务后历史还在；CLI 产生的运行也会出现在网页历史里。

## 状态与错误

- 运行级：`pass / warn / fail / error`。
- 检查级：`pass / fail / warn / skip`。
- `error` 只用于 Harness 级故障：配置非法、制品无法读取、模型/计划异常等。
- 表单会保留上次的 trace；服务停掉时显示错误状态，不会把旧结果清空。

## 小练习

1. 用示例制品 good 跑一次，展开“完整性”的证据，找到 `manifest.json` 和 `dist/app.js` 的哈希。
2. 上传 `fixtures/build/bad-hash.zip`（Agent 模式），观察“完整性”失败、整体 `fail`、报告下载。
3. 在流程配置覆盖里把 `maxSteps` 设为 `2`，再跑一次，观察报告变成 `warn`、`reason: max_steps`，并能在轨迹里看到 `enforced`。
4. 刷新页面，从“最近运行”里点回刚才的运行，确认报告和轨迹都能重新加载。
5. 停掉服务再点“开始检测”，确认错误状态和旧 trace 都还在。

## 检查问题

- 运行历史存在哪里？为什么不需要数据库？
- 报告为什么同时有 JSON 和 Markdown 两种格式？
- 如果 `report.write` 没有被模型调用，报告还会存在吗？
- 表单的“配置覆盖”为什么不写回 `config/default.yaml`？
- 服务端如何防止 `runId` 目录穿越？
