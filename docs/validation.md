# 验证记录与人工验收

## 本次环境

- 日期：2026-10-25。
- 平台：Windows；Node `24.21.0`。
- Pi coding-agent / ai / tui：`1.4.0`。
- 权限插件公开事件基线：`40.3.0`，只读核对其公开契约和投影源码，没有运行时导入内部模块。
- TypeScript `5.9.3`，ESLint `9.39.2`，typescript-eslint `8.54.0`。

## 自动验证

运行入口：`npm run check`、`npm run lint`、`npm test`、`npm pack --dry-run --ignore-scripts`。

| 检查 | 结果 |
| --- | --- |
| TypeScript strict 类型检查 | 通过 |
| ESLint | 通过，无错误/警告 |
| 默认离线测试 | 67 个通过，0 失败、0 跳过 |
| Pi 真实加载器及 JSON 字典加载 | 离线通过 |
| npm 打包清单 | 38 个文件，仅源码、字典、文档和 manifest |
| Markdown 本地链接 | 15 个文档、27 个本地链接均有效 |

受文件系统策略限制，打包检查使用 `--cache .npm-cache --logs-dir .npm-logs` 将 npm 临时文件限制在工作区；未生成发布 tarball。源码目录与真实 Pi 用户配置之间没有写入操作。

离线测试覆盖配置默认值/非法配置/保存失败/Windows 原子替换，shell/path/转发事件，语言优先级，输入脱敏与预算，缓存限制，去重/取消/超时/迟到结果，固定与动态模型，无 fallback，真实 Pi 加载器和 Input/SelectList，以及不进入传输层的 provider payload 适配。

测试使用隔离的临时目录和虚构命令/凭据占位符，不访问真实模型服务，不读取用户认证，不更改用户实际 Pi 配置。100 次只审批不解释场景断言解释调用数为 0。

`tests/extension.test.ts` 使用 Pi 公开加载器实际加载源码/JSON 字典，并验证事件订阅、raw 输入安装、模式降级及清理；它不是实际终端审批测试。

`tests/settings.test.ts` 使用真实 Input/SelectList 组件输入搜索条件，验证固定模型保存且主模型不变；它不是人工视觉或焦点验收。

`tests/provider-adapters.test.ts` 使用 Pi 公开 adapter，传入虚构 API key 和禁止网络的 fetch，并在 onPayload 主动停止；验证的是请求参数，不是供应商接受度或输出质量。

通知版新增断言：不调用 setWidget、不弹出聚焦对话框、进行中不发部分正文通知、完成仅通知一次、已完成通知不因 decision 撤回，且不再显示四段已移除文案。诊断测试覆盖分段计时、URL 凭据/路径剥离、推理字段白名单、取消后的迟到事件及缓存命中不伪造网络计时。OpenAI 兼容中转的 off 参数省略行为已用真实 adapter 离线复现。

强调色通知验证：先清理模型控制序列，再添加主题 accent 和加粗标题；清除外层 faint、还原样式、在真实 Text 组件中按窄屏/多行宽度换行；主题读取或着色失败时保留纯文本 info 通知。真实 Pi 加载器的完成通知也断言主题样式已应用。具体终端与用户主题的可读性仍待人工确认。

显式 none 新增断言：配置缺省兼容及严格校验、设置确认/取消、provider/model 精确绑定、主模型及 payload 不可变、其他模型和 low 不继承覆盖、API/其他思考方言冲突拒绝、缓存隔离，以及真实 Completions adapter 的 `reasoning_effort=none` 下发。回归测试覆盖 `thinkingLevelMap.off=null` 时仍能经确认保存并发送显式 none，`supportsReasoningEffort=false` 不再阻止主动测试，普通 off 不被改变；元数据诊断只输出白名单标签。仅验证本地行为，未发送在线探测。

原生等级新增验证：配置支持 Pi 的七种等级；直接复用 Pi 公开函数处理不可用等级；真实设置页只列 low/high/max 而非伪 off，可清除已有 none 实验；真实 adapter 的 off → low、high/max 参数下发；诊断区分偏好、采用等级和可用等级。真实 Pi 加载器测试也通过，不依赖其不能正确别名解析的 schema 子路径。

## 尚未执行：真实 TUI

按原设计 [07-testing.md](07-testing.md) 逐项验收，至少包括：

- Windows 目标终端的普通与全屏模式，审批聚焦时 Alt+E 到达 raw listener。
- y / s / n / r、Enter、Esc、Ctrl+O、拒绝理由和中文 IME 原行为不变。
- 原审批超时仍按原规则处理，解释不能暂停该计时。
- 窄屏、resize、主题、中文/组合字符、多行说明和长模型名称。
- 两个真实排队审批、父子相同命令、转发请求、重载和退出不残留监听或进行中状态。
- 解释完成后出现在 Pi 通知区域，而不是权限扩展的 TUI；通知版仍待真实终端确认。

## 真实模型和性能：部分诊断已提供

用户提供的 Magpie 诊断中，`qoder-cn/dfmodel` 的 off 请求省略推理参数，耗时约 12.24 秒；low 请求明确发送 `reasoning_effort=low`，耗时约 40.18 秒。更换到 `qoder/dfmodel` 后，low 请求约 2.95 秒。用户另反馈前一供应商直接在 Pi 中调用也慢。这支持排查线路差异，但输入和模型选择方式不同，不构成严格性能基准，也不能证明 `none` 被 Magpie 或上游支持。

后续 `2026-10-25T09:52:30.581Z` 的 qoder/dfmodel 请求已观测到 `reasoning_effort=none`，但仍返回推理增量和 83 个推理 token，不能视为成功关闭。只读核对本机模型元数据并调用 Pi 公开函数得到可用等级 low/high/max，普通 off 被校正为 low。此次后续代码验证仍为离线，没有另发付费请求。

完整真实模型烟测仍须由用户先选定模型并同意费用，建议分别验证只读命令、删除参数、未知脚本及至少两种语言；记录 usage，不自动保存命令全文。固定模型失败不得出现第二个 fallback 请求。新增显式 none 的线上验收步骤见 README 中的关闭推理入口。

尚未测量真实 TUI 初始化/键盘/堆内存开销、真实取消延迟及不同语言 token 差值。测试用例耗时不是这些产品性能指标，不能互相替代。

当前不应声称“所有终端已兼容”“推理始终完全关闭”“取消零计费”或“已完成正式发布验收”。
