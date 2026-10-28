# Contributing

欢迎提交可复现的问题与改进建议。请只提供脱敏或合成数据，不要上传私人笔记、真实订阅凭据、个人导出或访问令牌。

1. 使用 Node.js 22 或更新版本。
2. 执行 `npm ci --ignore-scripts --registry=https://registry.npmjs.org`。
3. 为行为变化添加能说明真实场景的 `node:test` 测试，运行 `npm test`。
4. 更新 CLI 帮助与 README；新支持的上游格式请附官方参考和合成夹具。

保持只读、离线与确定性输出。复用成熟格式解析器；不要引入遥测、自动上传、自动修改源文件或隐式网络请求。依赖更新应包含锁文件并说明必要性。

Pull requests and issues in Chinese or English are welcome. This independent project does not speak for its upstream ecosystems.
