# 09 · 实施路线、决策与核查依据

## 1. 实施状态

当前仅完成分析与项目文档。没有源码、扩展安装、TUI 实测或真实模型调用结果。

文档描述的是下一阶段可执行的开发契约，不是功能已经上线的说明。

## 2. 分阶段实施

### P0：接口契约与风险验证

- 固定 Pi / 权限插件版本，建立公开事件 fixture。
- 验证 bash 命令审批、bash 路径审批和转发请求的 value / request 区别。
- 证明只能解释公开可见内容，不依赖完整工具输入或私有字段。
- 在真实终端验证 Alt+E 编码及审批组件聚焦时的输入监听。
- 验证 widget 与原审批共存，以及原审批超时不被误改。

退出条件：接入不需要修改权限插件、不需要私有 hook，核心边界可被测试复现。

### P1：离线交互骨架

- 建立清晰源码目录和严格类型检查。
- 实现配置、事件适配、状态控制器与 widget。
- 使用假模型验证请求状态、重复按键、取消、队列与重载清理。
- 原审批不受影响，不产生真实模型费用。

退出条件：离线测试通过，原始输入处理无未处理异常。

### P2：模型设置与独立请求

- TUI 列出 Pi 注册表模型并搜索选择。
- 固定模型 / 跟随当前模型两种策略。
- 原子保存配置，保存失败不改变内存状态。
- 接入 `streamSimple`，无工具、无主会话切换、无自动 fallback。
- 加入预算、超时、有限脱敏和会话缓存。

退出条件：模型 / 费用策略测试通过，默认不开启付费烟测。

### P3：多语言

- 实现显式语言覆盖、本地环境 / Intl 解析和可选公开偏好桥。
- 建立英文、简体中文 UI 字典。
- 提示词明确目标语言，保留命令与程序标识。
- 语言进入缓存 key，变更只影响后续请求。

退出条件：Windows 无 LANG、繁体、C/POSIX、SDK 缺失 / undefined 等矩阵通过。

### P4：验收与发布准备

- 普通 / 全屏 TUI、Windows / 目标终端、IME 与按键冲突验收。
- 目标版本的真实权限队列、转发与超时验收。
- 用户授权后真实模型与多语言烟测。
- 性能、内存释放、日志与数据外发审查。
- manifest、locales 发布清单和兼容性声明。

退出条件：满足 [测试与验收](07-testing.md) 的发布门槛。

## 3. 关键设计决策

| 编号 | 决策 | 原因 |
| --- | --- | --- |
| ADR-01 | 按需而非自动解释 | 无需解释的审批额外模型请求为 0 |
| ADR-02 | 快捷键 + widget | 不改原菜单，不增加每次必经步骤 |
| ADR-03 | 不接入 authorizerChain | 不需要裁决权限，不前置阻塞原审批 |
| ADR-04 | 默认 Alt+E，可修改 | 两键、易记；不是系统级无冲突保证 |
| ADR-05 | 解释模型与主模型分离 | 可使用更便宜模型且无主会话切换竞态 |
| ADR-06 | 固定模型失败不回退 | 避免意外使用昂贵模型或不同数据接收方 |
| ADR-07 | 本地 locale + 同请求语言约束 | 不增加语言识别或翻译请求 |
| ADR-08 | UI 字典与目标解释语言分层 | UI 缺翻译不应改变模型输出目标 |
| ADR-09 | 不补齐未公开 evidence | 避免并发错配、隐私扩大与私有接口依赖 |
| ADR-10 | 会话缓存与 UI-only 输出 | 避免持久化敏感命令和主上下文膨胀 |

## 4. 本机核查基线

| 组件 | 版本 / 结果 |
| --- | --- |
| Pi coding agent | 1.4.0 |
| Pi permission system | 40.3.0 |
| 可选 rpiv-i18n | 2.15.0 |
| 检查用 Node | v24.21.0 |
| 平台 | win32 |
| Intl 默认语言 | zh-CN |
| 已查语言环境变量 | LANG / LC_ALL / LC_MESSAGES / LANGUAGE 均未设置 |

这些事实来自本机包元数据、公开文档、源码与只读 Node 检查。它们不等于已经完成扩展运行验收。

## 5. 接口依据

### Pi

安装目录基准：

```text
C:/Users/panda/scoop/persist/nodejs-lts/bin/node_modules/@earendil-works/pi-coding-agent/
```

| 文档 / 源文件 | 核查内容 |
| --- | --- |
| `docs/extensions.md` | 扩展生命周期、模型调用、事件总线和 UI |
| `docs/tui.md` | widget、设置列表、自定义 UI、键盘与鼠标模式 |
| `docs/keybindings.md` | 默认键位、组合键表示、用户覆盖 |
| `docs/models.md` | 自定义模型、注册表来源及认证可用性 |
| `docs/settings.md` | 主模型设置、model cycling、TUI 模式 |
| `dist/core/extensions/types.d.ts` | `onTerminalInput`、`setWidget`、ctx.model 与 modelRegistry |
| `dist/core/extensions/runner.js` | ctx.model 动态 getter、普通 shortcut 诊断 |
| `dist/core/model-registry.d.ts` | getAvailable / getAll / find / refresh / streamSimple |
| `dist/modes/interactive/interactive-mode.js` | 输入监听绑定、widget 与审批 editor slot 的关系 |
| `node_modules/@earendil-works/pi-tui/dist/tui.js` | raw input listener 先于聚焦组件处理 |
| `examples/extensions/qna.ts` | 独立模型请求及取消的参考 |
| `examples/extensions/preset.ts` | 自带选择 UI 的参考；本项目不采用其切换主模型行为 |

本次未发现公开 `registerSettings` 接口，所以设置页由本扩展提供，不假设可注入核心 `/settings`。

### 权限扩展

安装目录基准：

```text
C:/Users/panda/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system/
```

| 文档 / 源文件 | 核查内容 |
| --- | --- |
| `README.md` | 核心不调用 LLM，模型解释属于下游扩展 |
| `docs/cross-extension-api.md` | ready / ui_prompt / decision 的公开契约 |
| `src/service/permission-events.ts` | requestId、surface、value 与 request facts |
| `src/service/permission-ui-prompt.ts` | 顶层 value 投影与完整 evidence 未广播 |
| `src/authority/local-user-authorizer.ts` | 排队后实际展示时发出 ui_prompt |
| `src/handlers/gates/tool.ts` | 普通 bash gate 的命令值来源 |
| `src/handlers/gates/bash-path.ts` | bash 路径审批的顶层 command 与路径事实 |
| `src/handlers/gates/bash-external-directory.ts` | 外部路径审批的命令与目录事实 |
| `src/tool-input/tool-preview-formatter.ts` | 普通命令显示值可能是被拦单元 |
| `src/presentation/prompt-payload.ts` | annotations 是数据槽，不等于可用注入接口 |
| `src/presentation/dialog-renderer.ts` | 当前原审批渲染未提供注解注册能力 |

这些内部源码仅作为本次分析依据，不允许项目运行时导入或修改。

### 可选语言偏好扩展

安装目录基准：

```text
C:/Users/panda/.pi/agent/npm/node_modules/@juicesharp/rpiv-i18n/
```

核查了 `README.md`、`docs/sdk-reference.md`、`docs/integration-guide.md`、`i18n.ts` 与 `index.ts`。

可复用的是文档公开的 `Symbol.for("rpiv-i18n")` 只读快照。其 undefined 默认不应屏蔽本项目 Windows Intl 兜底。

## 6. 未确认与限制登记

| 风险 | 当前状态 | 处理 |
| --- | --- | --- |
| Alt+E 被终端 / IDE 截获 | 未实测 | 首次真实 TUI 验收，允许改键 |
| 其他扩展用户覆盖占用 Alt+E | 不能全量确认 | 已查默认无冲突；受保护配置不绕过 |
| web-search 用户快捷键覆盖 | `agent/web-search.json` 被策略拒绝读取 | 保留不确定性，不声称全局无冲突 |
| 完整命令链上下文 | 公开事件不保证提供 | 只解释可见内容并标记范围 |
| 转发子会话 cwd | 广播不保证提供 | 明确未知，不用父 cwd 冒充 |
| 暂停原审批超时 | 没有公开暂停接口 | 保留原语义，不做私有 patch |
| 虚拟模型路由目标与费用 | 由 Pi 现有路由决定 | 标记路由，建议固定成本用户选具体模型；首版不跨审批缓存 |
| 推理完全关闭 | 依 provider 能力 | 按公开选项验证，省略 reasoning 不等于关闭，不保证零推理 token |
| 输出语言完全正确 | 依模型能力 | 提示约束、人工烟测，不自动翻译 |
| 侧向请求计入 Pi 原生费用总计 | 未承诺 | 可显示本扩展 usage，不假造统计 |
| 新旧版本兼容 | 尚未运行测试 | 固定基线，发布前验证并注明 |

## 7. 文档阶段验收

本次文档交付需要完成：

- 文件存在，阅读入口清晰。
- 本地 Markdown 链接全部能解析到文档。
- JSON 示例语法有效，默认值在文档之间一致。
- 已确认接口与待验证行为分开说明。
- 没有创建源码、配置文件、认证或安装副作用。
- 多语言开销结论不使用未经测量的具体性能数字。

后续实现不得把这些文档校验误当作软件已经通过运行测试。

## 8. 本次文档检查记录

- 已逐份阅读 README 与 9 份专题文档，核对范围、配置、语言、模型费用策略及接口限制。
- 本地检查脚本验证 10 个 Markdown 文件、17 个本地链接、3 段 JSON 示例及所有代码围栏，未发现断链、JSON 语法错误或未闭合围栏。
- 目标项目目录只有 Markdown 文档，没有源码、扩展配置、认证文件或安装产物。
- 未运行扩展单元测试、真实 TUI 或模型请求测试，因为实现代码尚未创建。
