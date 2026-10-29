---
name: minor-artifact-check
description: 检测小版本发布制品，检查版本一致性、必填文件、完整性、禁用文件和变更记录。当任务要求检查小版本或补丁版本制品时使用。
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

当任务要求检查一个小版本或补丁版本的发布制品（zip + manifest）时使用。

## 输入

- 制品 zip
- 声明版本
- 上一版本
- 当前生效的检测策略（来自配置）

## 步骤

1. 调用 `artifact.open` 解压制品，确认文件列表。
2. 调用 `artifact.manifest` 读取并校验 `manifest.json`。
3. 依次调用五项检查：`checks.version`、`checks.required_files`、`checks.integrity`、`checks.forbidden`、`checks.changelog`。
4. 汇总结果，调用 `report.write` 写 JSON/Markdown 报告。
5. 用一段话给出结论，并列出失败项的修复建议。

不要跳过必检项。如果某个检查失败，仍然继续执行其余检查，最后统一报告。

## 判定规则

- 任一必检项失败，整体为 fail。
- 只有警告或检查未全部完成，整体为 warn。
- 所有必检项通过，整体为 pass。
- 工具执行失败或 Harness 级错误，整体为 error。

## 报告格式

报告必须包含：结论、每项检查的状态与摘要、失败项的证据、下一步修复建议。

需要更细的规则时，读取 `references/check-rules.md`。
