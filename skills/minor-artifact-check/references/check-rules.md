# 小版本制品检测规则

## 版本一致性

- 表单/CLI 的 `declaredVersion` 是权威版本。
- `manifest.version`、`package.json.version`、文件名中的版本都必须与它一致。
- 没有 `package.json` 或文件名不含版本时，对应子项标记为 skip，不算失败。
- `previousVersion` 必填；相对上一版本只允许配置中的 `allowedBumps`（默认 minor、patch）。major、预发布、版本倒退都判 fail。

## 必填文件

默认必填：`manifest.json`、`README.md`、`LICENSE`、`CHANGELOG.md`。规则来自配置，不在代码里写死。

## 完整性

- `manifest.files` 必须穷举除 `manifest.json` 之外的所有负载文件。
- 逐项检查存在性、大小和 SHA-256。
- `manifest.json`、目录、`.DS_Store`、`Thumbs.db`、`__MACOSX/**` 豁免“额外文件”检查。
- 默认不允许额外文件；`allowExtraFiles: true` 时额外文件降为 warn。

## 禁用文件

- 路径匹配 `forbiddenPatterns`，默认包含 `*.env`、`*.pem`、`*.key`、`id_rsa*`。
- 点文件必须匹配；使用 `minimatch` 的 `dot: true`。
- 可选内容扫描：私钥头、AWS access key。命中默认 warn，可通过 `contentScanSeverity: fail` 提升为 fail。

## 变更记录

- `CHANGELOG.md` 中必须有一行以 `#` 开头且包含声明版本。
- 兼容 CRLF。

## 状态

- 检查级：pass / warn / fail / skip。
- 运行级：pass / warn / fail / error。
- fail > warn > pass > skip。
