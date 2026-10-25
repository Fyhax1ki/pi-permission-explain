# Pi Permission Explain

为 Pi 权限审批提供按需命令解释：看得懂就照常审批，看不懂时按 **Alt+E**，完成后在 Pi 自身的通知区域查看结果。解释模型独立配置；不配置时使用触发时的当前模型。

**解释不是批准，也不是安全保证。** 扩展不执行或改写命令，不批准或拒绝请求，不切换主模型，不向主会话写入消息。

当前版本：`0.1.0`，初版。已有实现、离线验证和用户提供的真实请求诊断；完整终端/模型兼容性验收仍有待办，显式 none 仅是实验，不保证服务端关闭思考。

npm 包名：`@fyhax1ki/pi-permission-explain`。使用个人作用域避免与同名包冲突；GitHub 仓库及项目目录仍为 `pi-permission-explain`。

## 运行环境

- Node `>=22.19.0`；本次验证使用 Windows / Node `24.21.0`。
- `@earendil-works/pi-coding-agent`、`pi-ai`、`pi-tui`：`1.4.0`。
- 宿主中已启用 `@gotgenes/pi-permission-system`：`40.3.0`。
- 可选：`@juicesharp/rpiv-i18n` 的公开语言快照，不要求安装。

这些版本是接口核查和离线测试基线，不表示已经通过真实 TUI 兼容性验收。不依赖或修改权限插件的内部模块。

## 使用

发布到 npm 后，可在 Pi 中安装：

```powershell
pi install npm:@fyhax1ki/pi-permission-explain
```

在已配置权限插件的 Pi 环境中，从项目根目录临时加载此扩展：

```powershell
pi -e ".\src\index.ts"
```

扩展通过 Pi 的 TypeScript 加载器运行，不需要构建 JS。命令使用相对路径，项目目录重命名不影响加载。

1. 输入 `/permission-explain-settings` 打开本扩展设置，不是 Pi 核心 `/settings`。
2. 选择解释模型、语言、快捷键；可搜索注册表中的模型名、ID 和 provider。模型 ID 中的 `/` 会原样保存。
3. 出现可支持的 shell 权限审批后，按 `Alt+E`。Pi 状态栏显示生成状态，完成后通过 `ctx.ui.notify()` 在 Pi 通知区域显示解释：正文使用当前主题的强调色，标题加粗，不再沿用普通通知的暗淡文字。不使用审批旁的 widget，不修改权限插件的 TUI。
4. 审批照常允许或拒绝；结束审批后取消未完成的解释并清理状态。同一审批生成中或完成后再按键不会重复请求，失败后可显式重试。已完成的通知按 Pi 标准通知行为保留或被后续状态提示替换，不随审批清空，也不进入模型对话历史。

**按解释键即可能产生数据外发及模型费用。** 可见命令、必要权限事实和有限目录信息经尽力脱敏后发送给显示的模型；不发送对话历史、项目文件、工具定义或认证对象。正则脱敏不保证发现所有秘密。虚拟模型由 Pi 路由，显示名称不能保证实际接收方或价格。

非审批状态、未启用扩展或上下文不支持时不消费解释键；RPC / print / JSON 不安装终端输入监听。若 IDE 或终端截获 Alt+E，请在设置中换键。

## 配置

文件：`<getAgentDir()>/permission-explain.json`，默认 `~/.pi/agent/permission-explain.json`，遵循 `PI_CODING_AGENT_DIR`。只支持用户级配置，不读取仓库覆盖，也不修改 Pi 的模型、认证或权限配置。

```json
{
  "enabled": true,
  "shortcut": "alt+e",
  "explanationModel": null,
  "language": "auto",
  "reasoning": "off",
  "reasoningOffOverride": null,
  "maxOutputTokens": 384,
  "timeoutMs": 20000,
  "maxInputChars": 12000,
  "cache": {
    "enabled": true,
    "maxEntries": 16,
    "ttlMs": 300000,
    "maxBytes": 262144
  }
}
```

固定模型的 `explanationModel` 为 `{ "provider": "注册ID", "modelId": "原始模型ID" }`。固定模型不存在、未认证或调用失败时**不会回退主模型或其他供应商**。

- 文件缺失时采用默认值，不为补默认值而创建文件。
- 设置先校验、同目录临时文件原子替换、再更新内存；保存失败保留旧值。
- 手动编辑在打开设置或解释触发时按修改时间重载，不启动 watcher。改键后先打开设置，或用旧键触发一次；手动重新启用一个已停用的扩展需要打开设置或重载会话。
- 无效配置保留上一份有效值；没有有效值时停用解释。设置页重置无效文件需要显式确认，不会静默丢弃固定模型引用。
- 模型、语言和预算按请求快照生效，不会中途重发进行中的解释。
- `maxInputChars` 包括系统说明及完整 JSON 事实，超过上限不发送、不截断。很小的预算可能容不下基础说明。

全部字段和限制见 [配置设计](docs/03-configuration.md)。实现细节与设计差异见 [实现说明](docs/implementation.md)。

## 多语言与费用边界

`auto` 顺序：本扩展显式配置优先；自动模式读取可选 rpiv-i18n 公开偏好，再依次检查 `LC_ALL`、`LC_MESSAGES`、`LANGUAGE`、`LANG`、Node `Intl`，最终回退英文。Windows 没有 LANG 时仍使用 Intl。

UI 提供英文和简体中文。繁体、日文等解释目标保持原语言标签；缺少对应 UI 字典时仅 UI 回退英文。检测和语言切换不调用模型、不自动翻译。

推理设置复用 Pi 的 `getSupportedThinkingLevels()` 和 `clampThinkingLevel()`，只列出解释模型支持的原生等级。配置接受 `off / minimal / low / medium / high / xhigh / max`；每次请求按所选模型校正偏好，再交给 adapter 转换参数，不读取或修改主会话思考等级。诊断分别显示保存的偏好、请求采用等级和 Pi 可用等级。例如本机 `qoder/dfmodel` 只提供 `low / high / max`，普通 `off` 会与 Pi 一样采用 `low`，并不是完全关闭。部分旧式推理模型在很小的输出预算下会拒绝请求或无正文，可由用户提高预算，扩展不会自动加预算或续写。取消也不能保证服务端停止计费。

OpenAI Completions 兼容性探测保留为 **实验：发送 none（仅此模型）**，不是原生思考等级或关闭保证。它不默认启用，不自动试请求，也不在重载时擅自清除已有配置；选择任一原生等级可清除覆盖。用户对 `qoder/dfmodel` 的实测在发出 `none` 后仍收到推理，不建议继续把它当关闭方式。操作与诊断见 [关闭推理](docs/reasoning-off.md)。

## 排查解释缓慢

重载扩展后，进行一次你愿意承担费用的解释，再输入：

```text
/permission-explain-diagnostics
```

该命令本身不请求模型。它显示最近一次解释的本地准备、请求体就绪、响应头、首次推理/正文增量、生成和通知调用耗时，以及实际观测到的推理参数。仅在内存中保留一条记录，不包含命令、密钥、请求体、响应头原文或输出正文。

固定模型和当前模型使用同一条请求流程，没有额外等待或自动重试。`reasoning: off` 是偏好，模型不支持时按 Pi 规则校正；即使本地采用 off，部分兼容接口仍可能省略参数而继承上游默认值，不能单凭设置名证明关闭。诊断可先定位慢在哪个阶段；要进一步分清 Magpie 和它的上游供应商，需要服务端记录或受控的同模型对照，不能只凭模型名称下结论。详情见 [延迟诊断](docs/latency-diagnostics.md)。

## 已知限制

- 只解释公开的可见命令或命令单元，不保证完整命令链；不读取私有 evidence、审计日志或脚本补齐上下文。
- 转发请求不使用父会话目录冒充子会话执行目录；未知 shell / PowerShell / 不可靠别名 / 只有路径的请求不猜测执行语义。
- 不暂停原审批超时，不伪造原审批按键。Alt+E、IME、焦点和普通/全屏布局仍需真实终端验收。
- 输出由 Pi 通知组件按终端宽度排版；文本仍有字符上限，达到上限或输出预算会标注可能不完整。
- 缓存仅在内存中，受条目数、TTL、估算字节数限制；任一缓存预算为 0 即禁用。缓存不是新的安全评估，路由模型不跨审批复用。
- 输出与命令不由本扩展记录到磁盘，不保证宿主/供应商自身的日志、遥测或费用汇总行为。

## 开发与验证

在允许下载依赖的环境中执行：

```text
npm install --ignore-scripts
npm run check
npm run lint
npm test
npm pack --dry-run --ignore-scripts
```

默认测试离线，使用假模型和隔离配置目录，不需要密钥或模型费用。测试包含真实 Pi 加载器、真实 Input/SelectList 组件和在 transport 前停止的 provider payload 检查，但这些不替代实际审批 UI 或真实模型验收。

本次网络策略禁止 npm 下载，开发验证复用了机器中已安装的依赖，工作区 `node_modules` 为本机链接，不应复制或发布。开发工具采用 TypeScript + Node 内置测试 + ESLint，未新增强制生产依赖。未生成依赖锁文件；所有直接依赖版本已固定。

当前验证与待验收清单见 [验证记录](docs/validation.md)。许可证目前为 `UNLICENSED`，尚未授予开源许可；公开 npm 发布不等于授予开源使用或再分发许可。

## 手动发布 npm

在项目根目录执行，所有 npm 网络操作显式指定官方源；无需修改全局 registry：

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm run check
npm run lint
npm test
npm pack --dry-run --ignore-scripts --registry=https://registry.npmjs.org/ --cache .npm-cache --logs-dir .npm-logs
npm publish --access public --registry=https://registry.npmjs.org/
npm view @fyhax1ki/pi-permission-explain@0.1.0 version --registry=https://registry.npmjs.org/
```

包内只包含 manifest、源码、字典和文档，不包含本机依赖链接、测试临时文件或用户配置。发布时应登录 npm 用户 `fyhax1ki`，或使用获授权发布该作用域包的账号。作用域包使用 `--access public` 公开发布。按 npm 提示完成认证或双因素验证。同一版本不可重复发布，后续发布前需提升版本号。`publishConfig` 也固定为官方 registry，但不会代替账号认证。

## 文档来源

原始文档读取自 `C:\Users\panda\VscodeProjects\work\pi-permission-explain`，该目录未修改。原始设计保存在 [DESIGN.md](DESIGN.md) 和 `docs/01-*.md` 至 `docs/09-*.md`，其中“尚未实现”等描述是历史设计阶段状态；当前实现状态以本 README、实现说明及验证记录为准。
