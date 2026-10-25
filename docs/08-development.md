# 08 · 开发、目录与代码规范

## 1. 技术原则

- TypeScript + ESM，使用 Pi 现有扩展加载机制。
- 优先复用 Node 标准库、Pi 公开 API 与 Pi TUI 组件。
- 不引入新的强制生产依赖完成配置、locale、缓存或模型请求。
- TypeScript、测试框架和格式检查器仅作为开发依赖。
- 权限扩展是运行环境前提，但只使用其公开广播，不引用内部模块。
- 可选 rpiv-i18n 使用文档公开的只读快照，不要求安装。

如果源码直接导入其他 Pi 包的类型或组件，必须在未来 package manifest 中明确对应 peer / 开发依赖，不依赖偶然的 node_modules 提升。

## 2. 计划项目结构

以下是实现阶段的目录规划，当前只存在 README 与 docs。

```text
pi-permission-explain/
├── README.md
├── package.json                     # 未来：Pi 扩展入口、peer 与开发脚本
├── tsconfig.json                    # 未来：严格类型检查
├── biome.json                       # 未来：单一格式/lint 约定
├── src/
│   ├── index.ts                     # 薄入口：组装与注册
│   ├── types.ts                     # 少量跨模块契约，不堆所有类型
│   ├── config.ts                    # 校验、按需读取、原子保存
│   ├── permissions.ts               # 公开权限事件适配与范围投影
│   ├── controller.ts                # 状态、去重、取消、生命周期
│   ├── models.ts                    # 注册表模型列表与独立请求
│   ├── prompt.ts                    # 稳定提示词与语言要求
│   ├── locale.ts                    # 本地语言解析与公开偏好桥
│   ├── redaction.ts                 # 有限脱敏及其失败边界
│   ├── cache.ts                     # 有界会话内缓存
│   └── ui/
│       ├── explanation-widget.ts    # 旁挂说明，不抢焦点
│       ├── settings-panel.ts        # 本扩展设置页
│       ├── model-picker.ts          # 可搜索模型选择器
│       └── i18n.ts                  # UI 字典查表与回退
├── locales/
│   ├── en.json                      # 英文基线
│   └── zh-CN.json                   # 简体中文文案
├── tests/
│   ├── fixtures/                    # 无真实秘密的公开事件样例
│   ├── config.test.ts
│   ├── permissions.test.ts
│   ├── controller.test.ts
│   ├── models.test.ts
│   ├── locale.test.ts
│   ├── prompt.test.ts
│   ├── cache.test.ts
│   └── ui-contract.test.ts
└── docs/
    └── 本项目设计文档
```

布局原则是“入口薄、业务集中、适配分层”，不是为每个小函数创建一个文件。模块变得过大时按稳定职责拆分，不提前建立通用插件框架。

## 3. 依赖方向

```text
index → controller + adapters + UI
controller → typed interfaces / pure helpers
permissions → types
models → Pi public model registry
locale → Intl / small environment snapshot / optional public locale snapshot
UI → typed view state + dictionaries
config → node:fs + schema validation helpers
```

- controller 的测试不启动真实 TUI。
- UI 不直接选择 provider、执行请求或重复推导审批状态。
- locale 不读取主对话，不依赖模型。
- prompt 不访问文件系统。
- config 不导入 UI，写失败通过明确结果或异常返回。

## 4. 代码整洁要求

1. 启用 TypeScript strict；外部数据入口使用 `unknown`，逐字段验证。
2. 用判别联合表达状态，避免多个互相矛盾的 boolean。
3. 数据快照优先 `readonly`，异步请求使用明确的 generation / attempt 身份。
4. 每个模块有清楚的公共出口；内部 helper 不全部导出。
5. 避免 `any`、双重强制断言和随意忽略编译错误。
6. 异步任务必须有错误归属，不能出现未处理 rejection。
7. 资源清理幂等，正常结束与异常结束共用可靠的收尾路径。
8. 预算、命令名、sentinel、提示词版本集中定义，避免魔法字符串散落。
9. 使用宿主公开 key parser 与终端宽度函数，不重复实现按键协议和 Unicode 列宽。
10. 不通过多层“万能服务”、隐式全局单例或复杂继承增加理解成本。

函数通常应能在一个屏幕中理解，模块应保持职责单一；不以机械行数限制迫使逻辑碎片化。

## 5. 注释规范

本项目面向中文维护者，设计与关键业务注释可用中文，代码标识与外部协议字段使用稳定英文。

### 应当注释

- 公开函数的输入、输出、异常和副作用。
- 为什么不自动回退主模型。
- 为什么只读公开语言快照且忽略 undefined 默认。
- 为什么缓存包含语言、模型与上下文。
- 为什么不用 sendUserMessage / setModel。
- 为什么不能暂停原审批超时或推断完整命令。
- SDK / 平台兼容分支的版本依据。

### 不应注释

- 重述显而易见的赋值、循环或函数名。
- 没有 issue、边界和退出条件的永久 TODO。
- 已与实现不符的旧行为描述。
- 真实 token、用户命令、私有文件或接口凭据。

推荐公共函数使用短 TSDoc；复杂分支的注释回答“为什么”，而不是逐行翻译代码。

## 6. 本地化开发约定

- 所有扩展 UI 文案经统一的 `t(key, fallback)` 或等价薄封装获取。
- `en.json` 是回退基线，新 key 先加入基线。
- locale 字典 key 与配置字段、业务判别值分离。
- 文案在渲染时解析，不在模块初始化时固化语言。
- 命令、路径、模型 ID、配置键、sentinel 和解析用错误码不翻译。
- 模型目标语言由 `locale.ts` 输出，不由是否存在 UI 字典决定。

## 7. 建议开发工具链

实现阶段可选择：

- TypeScript：类型检查。
- Vitest：离线单元与集成测试。
- Biome：格式和基础静态检查，避免同时维护多套互相冲突的 formatter。

未来约定脚本：

```text
npm run check     # 类型检查
npm run lint      # 格式与静态规则
npm test          # 默认离线测试
```

这些脚本当前尚不存在，不应在只有文档时声称已运行通过。

## 8. 开发和发布流程

1. 按 [实施路线](09-roadmap-evidence.md) 完成契约测试与最小骨架。
2. 使用假模型验证 UI、配置、按键与取消，不产生模型费用。
3. 在隔离的 Pi 测试环境中完成真实权限审批验收，不覆盖用户认证或权限配置。
4. 用户同意后进行有限真实模型烟测。
5. 发布 manifest 声明 `type: module` 与 `pi.extensions` 入口。
6. `files` 只包含必要源码、locales、文档和许可；禁止打包密钥、日志、缓存。
7. 用 `npm pack --dry-run` 检查清单，不把本地加载成功当作发布打包正确。
8. 根据已测试版本声明兼容范围；不能仅凭接口名称相同就承诺所有 Pi 版本兼容。

项目许可证在发布前明确决定，本次不擅自指定。

## 9. 变更检查单

- 需求编号、配置字段和默认值是否同步更新？
- 有没有意外调用主模型切换、权限裁决或新增模型请求？
- 有没有在普通按键路径加入磁盘、网络或 locale 重解析？
- 语言 / 模型切换后缓存是否失效？
- 新增 UI 文案是否有英文基线？
- 注释是否解释了新增边界，而非掩盖复杂实现？
- 是否补上失败与清理测试，而不只测成功？
- 文档是否区分“已实现 / 已验证 / 仍待验收”？
