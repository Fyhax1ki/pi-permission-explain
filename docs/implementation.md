# 实现说明

## 实现结构

| 模块 | 职责 |
| --- | --- |
| `src/index.ts` | Pi 生命周期、公开事件订阅、raw 输入、设置与诊断命令 |
| `src/runtime.ts` | 按触发时配置准备独立请求，组装模型、语言和缓存身份 |
| `src/controller.ts` | 同步去重、请求身份、取消、超时、迟到结果隔离 |
| `src/permissions.ts` | `unknown` 边界校验、命令/路径投影、转发身份 |
| `src/config.ts` | 严格校验、按需重载、串行原子保存、上次有效值 |
| `src/models.ts` | 注册表选择、无工具流请求、独立预算和错误分类 |
| `src/reasoning.ts` | 按 provider/model 显式启用的 off 请求映射及冲突检查 |
| `src/prompt.ts` / `src/redaction.ts` | 最小 JSON 上下文、语言约束、有限脱敏 |
| `src/locale.ts` | 环境/Intl 解析、可选公开语言桥 |
| `src/cache.ts` | SHA-256 身份、会话内 LRU、惰性 TTL 和字节限制 |
| `src/keys.ts` | 严格组合键校验、Pi 按键匹配、粘贴和 release 排除 |
| `src/diagnostics.ts` | 单条会话内计时记录、脱敏模型元数据、推理参数观测 |
| `src/ui/` / `locales/` | Pi 通知与状态栏、设置页、搜索选择器和中英文文案 |

## 与设计的具体落地

- 工具链建议并非运行协议：采用 Node 内置测试而非 Vitest、ESLint 而非建议的 Biome，便于在本机受限网络下复用已安装工具。类型检查保持 strict，不引入生产工具依赖。
- 按键协议识别和终端列宽使用 Pi TUI API，不自行解析 Kitty 协议或 CJK 宽度。
- 配置快捷键采用 Pi KeyId 的严格子集：必须包含 ctrl / alt / super，禁止重复修饰符、裸键和单独 shift+字母。未调用 `registerShortcut()`，避免非审批状态下编辑器吃键。
- 支持公开显示面为 bash、请求明确为 bash 的命令/路径审批，以及公开 `invokedToolName` 能证明的 bash 别名。无法证明 shell 语义时宁可不发请求。
- 设置页使用宿主真实 Input / SelectList 组件，本地过滤整个可用聊天模型快照。每次打开模型页重新读取注册表，不额外请求模型元数据，不按价格排序。
- 系统 locale 在会话初始化和关闭设置时刷新；已有 rpiv-i18n 偏好在需要解析时读取，不导入扩展入口、不修改全局语言。
- 根据后续用户要求，已取消原设计的旁挂 widget 以及四段固定告知文案。生成时只更新 Pi 状态栏，完成时使用 Pi 的 `ctx.ui.notify()`，既不修改权限插件代码，也不修改其 TUI。通知内容不写主会话消息。
- 流请求继续用于计时与取消，但不逐 token 刷新通知；没有渲染节流 timer。连续相同状态不重复设置，单次完成仅发一次通知。
- 模型文本按普通文本显示，不渲染可执行动作；控制序列和 bidi 控制字符被清除。字符保留上限 16384，换行排版交给 Pi 通知组件。
- 完成通知在清理模型文本后，使用当前 `ctx.ui.theme` 的 accent 强调色及加粗标题。仅由扩展生成可信样式，并清除 Pi 普通通知外层可能带来的 faint；不将正常解释改成 warning/error，不改变审批颜色。主题不可用时退回纯文本通知。
- 请求失败仅暴露稳定错误码的本地化文案，不显示 SDK 错误正文、响应体或配置原文。

## 推理及预算适配

Pi `1.4.0` 的 `SimpleStreamOptions.reasoning` 不接受字符串 `off`。现复用 Pi 会话层使用的 `getSupportedThinkingLevels()` / `clampThinkingLevel()`：设置只列解释模型支持的等级，每次请求先校正保存的偏好，再将本地实际采用的 off 转成 undefined，其余等级原样传给简单流接口。不会读取或修改主模型思考级别。旧版直接将 off 转为 undefined，遗漏了会话层的校正；例如 `qoder/dfmodel` 的 off 应先校正为 low，而不是直接省略参数。

离线 payload 测试覆盖：

- Anthropic：off 构造 `thinking: { type: "disabled" }`，low 走该 adapter 的推理配置。
- OpenAI Responses：示例支持模型的 off 构造 `reasoning.effort: "none"`，low 为 `"low"`。
- Google Gemini：示例支持模型的 off 构造 `thinkingBudget: 0`，low 使用 adapter 预算。
- OpenAI Completions 兼容中转：在支持 reasoning effort 但没有 `thinkingLevelMap.off` 的示例中，off 不发 `reasoning_effort`；有受支持的 `off: "none"` 映射时才发出 `none`。不能给未知供应商盲目添加这个映射。
- 本机 dfmodel 等级元数据的离线复现：可用等级为 low/high/max，普通 off 请求采用 low 并发送 `reasoning_effort=low`；high/max 正常映射。非推理模型只提供 off。设置可将旧的 none 实验切回原生等级并清除覆盖，主会话不变。

另提供默认不启用的 `reasoningOffOverride`，用户在设置中确认后，针对一个 provider/model 的解释 payload 显式写入 `reasoning_effort=none`。不会改共享模型的 `thinkingLevelMap` 或主会话设置。覆盖仅用于 OpenAI Completions；其他思考方言/预算冲突会停止请求。`thinkingLevelMap.off=null` 或 `compat.supportsReasoningEffort=false` 属于本地兼容性声明，确认页显示其值和覆盖提示，允许用户主动测试，不再在确认前硬拦截。切换到其他模型不应用这个覆盖。诊断区分 `pi-adapter` 和 `reasoning-effort-none`，同时展示白名单元数据值；缓存摘要包含生效的覆盖及 compat。真实 adapter 离线测试验证参数下发，不证明供应商支持。操作见 [关闭推理](reasoning-off.md)。

这不是对所有模型或兼容供应商的推理关闭保证。强制推理、`thinkingLevelMap.off: null`、Copilot、未知 provider 或 Pi 路由仍有差异。这些边界保留在文档和诊断中，不再重复占用审批区域。

none 覆盖现在标为独立实验项，非原生关闭等级。已有覆盖不在重载时静默迁移；用户选择任一原生等级后清除它。诊断同时记录保存的偏好、本地采用等级、Pi 可用等级和请求参数；缓存身份包含校正后的等级。

Pi 某些 adapter 会在 `maxTokens` 上增加 thinking budget。本扩展在公开 `onPayload` 回调中再次限制已知 API 的 `max_tokens`、`max_completion_tokens`、`max_output_tokens`、Google `maxOutputTokens`、Bedrock `maxTokens` 字段。不通过增加总预算满足推理最低值；旧式 Anthropic 推理最小值与小预算不兼容时可能请求失败。未知自定义 adapter 是否遵守预算由该 provider 实现决定。

扩展可控制的 `maxRetries` 为 0，不建立自己的重试或 fallback。Pi 的虚拟模型路由和供应商自身行为不属于扩展控制的重试预算，不能声称一次 streamSimple 必定只有一个底层 HTTP 请求。

## 缓存及生命周期

- key 摘要覆盖 provider、model ID、API/endpoint、语言、提示词版本、请求选项、发送事实、目录和会话 generation。原命令不明文存于 key。
- 转发来源 session ID 缺失时加入该 requestId，不跨未知子会话复用。
- 虚拟模型不生成跨审批缓存 key。具体模型返回了不同 provider/model 身份时也不写入选定模型的缓存。
- 缓存 bytes 按 key 和 result JSON 的 UTF-8 字节数估算，不声称等于整个 JS 堆占用；另有输出文本上限和条目上限。
- TTL 惰性清理，不续期；配置缩短 TTL 会影响已有条目。失败、空白输出、取消和迟到响应不缓存。
- 每次触发在配置 IO 前进入 loading 状态，防止重复按键穿过异步重载窗口。请求对象身份包含请求快照及 attempt，session generation 由生命周期递增。
- 当前 decision、主请求 abort、会话切换/树导航/退出/重载会清理相关工作和状态栏；非当前 decision 不影响当前状态。已发送的 Pi 通知不撤回，服从宿主通知的保留/替换行为。
- 等待流时与 AbortSignal 竞速，避免供应商不响应取消而阻塞控制器；迟到事件丢弃。供应商若违约继续运行，其内部资源和计费不能由本扩展保证终止。
- 诊断只保留最近一次请求的标量计时、结果类别及必要模型元数据，不保留命令或输出。会话重建时清空；缓存命中不会伪装成一次新的网络测量。

## 发布边界

初版为 `0.1.0`，按用户要求移除 manifest 的 private 发布禁用项，加入 Pi 包发现关键词及 npm 官方源 publishConfig；npm 发布仍由用户手动执行。许可证保持 `UNLICENSED`，不擅自授予开源许可。原始设计的 P0/P4 中完整终端、审批队列和真实模型矩阵仍待验收；离线可运行不等于全面兼容保证。发布命令见 README。
