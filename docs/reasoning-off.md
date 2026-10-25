# 解释请求的思考等级

## 与 Pi 原生行为一致

扩展使用与 Pi 会话相同的公开函数：`getSupportedThinkingLevels(model)` 决定可用选项，`clampThinkingLevel(model, preference)` 决定请求采用等级。只操作解释请求，不调用主会话的 `setThinkingLevel()`，也不读取主会话当前思考强度。

配置支持 `off / minimal / low / medium / high / xhigh / max`。设置页只列出所选解释模型可用的等级；跟随当前模型或手动配置了不可用等级时，在下一次请求按 Pi 规则校正，不更改模型、输出预算或配置文件。选择较高等级仍可能增加费用和正文等待时间。

本机两个 Magpie `dfmodel` 的元数据经 Pi 公开函数计算，可用等级均为 `low / high / max`。`off`、`minimal`、`medium`、`xhigh` 都标为不可用；请求普通 off 会采用 low，而不是关闭。示例诊断：

```text
推理偏好: off
请求采用等级: low | Pi 可用等级: low / high / max
推理参数映射: pi-adapter
观测到的推理参数: reasoning_effort=low
```

用户的 `qoder/dfmodel` 实测已确认：即使明确发出 `reasoning_effort=none`，仍返回推理增量和 83 个推理 token，因此该次并未关闭。建议选择原生 low；确实要求无推理时，选择提供 off 且实际执行关闭的模型。无需继续为这条线路盲试其他参数。

## 为什么原来的 off 仍会思考

Pi `1.4.0` 的简单流接口用未设置 `reasoning` 表示 off。旧版扩展直接这样调用，遗漏了 Pi 会话层先进行的能力校正；对 off 不可用的模型，可能省略参数并继承中转默认值。现在先复用 Pi 的校正函数，再将真正采用的 off 转成未设置 reasoning，其他等级按原生名称传给 adapter。

对声明支持 off 但没有相应 wire 映射的兼容接口，adapter 仍可能省略参数。等级列表和请求参数并不等于服务端能力探测。扩展不根据 Magpie、Qoder 或模型别名猜测支持情况。

## 实验性 none：按模型启用

这是单独的 OpenAI Completions 兼容性探测，不属于 Pi 原生等级，不是对 Magpie/上游支持情况的认证。保留旧配置但不自动启用；选择任一原生等级会清除它。

1. `/reload` 加载新代码。
2. 打开 `/permission-explain-settings`，选定解释模型。建议固定到要测试的线路，避免随主模型变化。
3. 进入“高级设置 → 推理偏好 → 实验：发送 none（仅此模型）”。
4. 确认弹窗中的 provider/model 和本地推理元数据。若元数据将关闭或 effort 标为不支持，弹窗会明确告知；继续意味着仅对解释请求做显式兼容性测试，取消保留原配置。保存本身不发起模型请求。
5. 如果同意本次模型费用，在新审批上按解释键；不要用缓存命中做验证。
6. 查看 `/permission-explain-diagnostics`，预期看到：

```text
推理偏好: off
请求采用等级: explicit-none | Pi 可用等级: low / high / max
推理参数映射: reasoning-effort-none
本地推理元数据: thinkingLevelMap.off=null, compat.supportsReasoningEffort=unset
观测到的推理参数: reasoning_effort=none
```

元数据行以实际模型为准。`thinkingLevelMap.off=null` 表示本地声明不支持 off，并非服务端即时探测结果。普通 off 仍遵循该声明；用户主动确认的显式 none 测试允许覆盖它，但不修改共享模型元数据。上一版把该声明作为硬拦截，会在设置时直接失败；现已改为确认提示。

示例配置片段（合并到扩展自己的配置，而不是 Pi 的 models.json）：

```json
{
  "reasoning": "off",
  "reasoningOffOverride": {
    "provider": "magpie",
    "modelId": "qoder/dfmodel",
    "mode": "reasoning-effort-none"
  }
}
```

provider 和 model ID 必须与注册表精确匹配。一次只保存一个覆盖目标；跟随当前模型时，切换到其他 provider/model 后不会继承这个覆盖，而会恢复 Pi 的等级校正及参数映射。诊断中的 `pi-adapter` 可以识别这一状态。选择任一原生等级会清除覆盖。

## 如何解释测试结果

- 请求体含 `reasoning_effort=none`：证明扩展在公开 payload hook 发出了明确关闭请求，不证明 Magpie 最终转发或上游执行。
- 请求失败：可能是参数不支持，也可能是其他请求故障；结合 HTTP 状态和服务端日志判断。扩展不自动移除参数重试，也不切换模型或增加预算。
- 返回推理增量或正的推理 token：本次仍观察到推理，应检查 Magpie 的出站参数和上游参数支持。
- 没有推理增量、报告的推理 token 为 0：与成功关闭相符，但供应商也可能不报告思考；仍需文档、服务端有效配置或受控对照确认。不能只凭速度或 HTTP 200 判断。
- `cache-hit`：没有新请求，不能验证本次路由设置。

Magpie 若强制使用路由最高推理，请求参数可能被覆盖。此时需让该路由尊重请求参数，或为解释建立独立的无推理路由。此扩展不更改 Magpie 配置。

## 隔离和边界

- 只在解释请求的 `onPayload` 中返回带参数的新对象，不改共享模型对象、主会话推理级别、权限插件或认证。
- 非 OpenAI Completions API 仍会在调用前拒绝。`thinkingLevelMap.off=null` 或 `compat.supportsReasoningEffort=false` 只在显式测试确认中告知，不再硬拦截。payload 存在其他思考控制方言或预算时仍停止，不把互相冲突的参数一起发送；adapter 可能将此类 hook 错误归为一般请求失败。
- 覆盖参与缓存身份；启用或清除覆盖不会复用另一种映射的解释结果。
- 默认测试只验证本地映射、作用范围、配置和缓存，不访问真实模型；没有宣称 `qoder/dfmodel` 或其他上游已接受 `none`。

分段耗时说明见 [延迟诊断](latency-diagnostics.md)。
