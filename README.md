# minor-artifact-harness

一个用于学习 Harness 开发的小版本制品检测沙盒：从零实现 Harness 循环、工具、Skill、配置和表单，并用脚本化 MockModel 离线跑通。

## 快速开始

```bash
npm install
npm test          # 45 个离线测试
npm run typecheck
npm run demo      # 跑一个脚本化 Agent 演示
npm run dev       # 启动检测表单：http://127.0.0.1:4317
```

命令行检测：

```bash
npm run inspect -- --fixture good --version 1.5.0 --previous 1.4.2
npm run inspect -- --fixture bad-hash --version 1.5.0 --previous 1.4.2 --mode fixed
```

## 它包含什么

- **Harness 循环**：prompt 组装、MockModel、工具调用、观察回填、maxSteps、必检项强制执行。
- **工具**：安全 zip 读取、manifest、五项检查、报告写入、`skill.load` / `skill.read`。
- **Skill**：`SKILL.md` + frontmatter、渐进披露、预加载、工具权限交集、references/assets。
- **配置**：YAML 四级覆盖、策略不可被模型放宽、Agent / 固定流程两种编排。
- **表单**：上传或示例制品、结果/证据/轨迹、运行历史、本次运行配置覆盖。

每次运行会写入 `runs/<runId>/`：

- `report.json` / `report.md`
- `trace.jsonl`
- `prompt.md`
- `config.json`（生效配置）
- `artifact.zip`（上传制品，可配置保留）

## 文档

- 设计文档：`docs/superpowers/specs/2026-10-29-minor-artifact-harness-design.md`
- 实现计划：`docs/superpowers/plans/2026-10-29-minor-artifact-harness.md`
- 学习指南：
  - `docs/learning/01-harness-loop.md`
  - `docs/learning/02-tools.md`
  - `docs/learning/03-skills.md`
  - `docs/learning/04-config-and-flow.md`
  - `docs/learning/05-form-and-report.md`
- 复盘与框架选型清单：`docs/retrospective.md`

## 技术栈

Node.js 26、TypeScript（原生类型擦除，无构建步骤）、`zod`、`yaml`、`semver`、`minimatch`、`yauzl`；`yazl` / `fflate` 生成测试制品；`node:test`；`node:http`。

## 远程仓库

https://github.com/Pinky-Lemon6/minor-artifact-harness

## 说明

检测规则是学习沙盒的示例，不代表任何公司内部规则。规则集中在 `config/`、`src/tools/checks.ts` 和 `skills/`，替换成本低。默认不接真实模型，因此 Skill 的语义效果需要在接入真实模型后另行验证。
