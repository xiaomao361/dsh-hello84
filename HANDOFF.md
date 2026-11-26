# Handoff：`dsh-hello84`（Hello '84）

> 来源会话：[1126｜探索｜DSH 主题插件回顾](conversation://36ad82da-fb3f-4cba-aa0b-8888b51f6949)
> 目标目录：`/Volumes/E61/zhouwei/projects/dsh-hello84`
> 参考实现：同目录下的 [dsh-afterwave-style](/Volumes/E61/zhouwei/projects/dsh-afterwave-style)（DSH Web 插件注入、构建、离线预览与测试体系）

---

## 1. 产品定位

**Hello '84（`dsh-hello84`）** 是一个面向 DeepSeek Harness（DSH）的**独立悬浮挂件插件**（**不绑定任何主题**，自动兼容默认界面、四号船坞及其他皮肤，Windows / macOS / Linux 零原生依赖开箱即用）。

核心概念：**在 DSH 窗口角落养一台活着的 1984 复古 Macintosh**——
- **零配置模式（不填 Key 即可玩、即有用）**：实时映射外部宿主 DSH 状态，内置 1-bit 复古桌面与实用小应用，直接遥控外部 DSH 会话、暂存跨会话片段、导出 Markdown / 复古截屏卡片、任务完结提醒、以及摸鱼小彩蛋。
- **配 Key 模式（填 DeepSeek / OpenAI 兼容 API Key）**：小 Mac 内的 **Mini DSH** 进化为**独立运行的旁路副脑（Sidecar Agent）**，不污染外部主会话上下文，可速问/翻译/润色外部草稿/审稿挑刺，并可调用小 Mac 桌面工具（写便签、定闹钟、往外部输入框填草稿等）。

---

## 2. 已确认的视觉与产品决策

1. **项目名 / npm 包名**：`dsh-hello84`（展示名：`Hello '84` / `你好 84`）。
2. **屏幕视觉风格**：
   - 以 **经典 1-bit 黑白像素 Mac（System 6/7 质感）** 为默认主视觉（米白 CRT 机身边框、经典顶栏 ` File Edit View Special`、可拖动像素窗口、1-bit 抖动纹理、轻微扫描线、可选复古点击/软盘提示音，默认静音或可一键开关）。
   - 内置 **3 套屏幕模式切换**：`Classic 1-bit（经典黑白）` / `CRT Green（荧光绿屏）` / `CRT Amber（琥珀屏）`。
   - **开机仪式**：首次展开显示致敬初代 Mac 的手写体 `hello.` 欢迎画面（可跳过/关闭）。
3. **挂件形态**：
   - **迷你待机态**：角落可拖拽的迷你像素小 Mac，支持拖到屏幕边缘自动吸附收起（不挡聊天区与发送按钮）。
   - **活体状态反馈**：实时跟随外部宿主 DSH 状态切换屏幕表情/动画——待机屏保、思考转手表/沙漏、调用工具时软盘灯闪烁、待审批时 **Happy Mac 弹窗 + 提示音**、出错时切 **Sad Mac 哭脸**。
4. **第一版 MVP 桌面应用（全部包含）**：
   - **Mini DSH（双模套娃客户端）**：
     - *零配置模式*：同步外部宿主 DSH 所有会话列表与运行/待审批状态，点击直接切换外部主会话；支持在复古终端里输入内容直接发送/填入外部宿主 DSH。
     - *配 Key 模式*：支持配置 Base URL / API Key / Model（默认指向 DeepSeek API，兼容任意 OpenAI 协议）；支持独立旁路对话，提供一键抓取外部输入框草稿或最近一条回复进行「润色 / 挑刺 / 翻译 / 总结」，并开放小 Mac 本地工具调用（写 Note Pad、设 Alarm、回填外部草稿）。
   - **Note Pad（经典翻页便签）**：多页翻页便签，持久化到 `localStorage`，支持跨会话存片段/草稿，一键将当前页注入外部 DSH 输入框。
   - **Floppy Disk（3.5 寸软盘导出）**：一键将外部当前会话导出为 Markdown，或渲染成一张 **复古 Macintosh 窗口风格 PNG 分享长图**（自动脱敏常见本机路径）。
   - **Alarm Clock（复古闹钟）**：番茄钟 / 倒计时，以及「外部任务跑完 / 卡审批时叮我一声」（内置 Web Audio 合成复古提示音，不依赖系统通知权限）。
   - **摸鱼小彩蛋**：内置轻量 1-bit **像素画板（MacPaint Lite）** 与 **扫雷（Minesweeper）**，等外部 AI 跑长任务时解闷。

---

## 3. 技术架构约束与参考

1. **宿主集成方式**（参考 `dsh-afterwave-style`）：
   - `package.json` 声明 `dsh.bundle.patch: "./cordis.patch.yml"` 与 `dsh.client`（`platform: "web"`，注入 `@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-chat`）。
   - 客户端入口通过 `window.__ModuleLoader__.load({ id: 'dsh-hello84', factory(require) { ... } })` 注册，**不侵入宿主全局主题 CSS**，所有样式使用独立前缀（如 `.h84-*`）与 Shadow DOM / 严格作用域隔离，保证不破坏任意第三方主题。
   - 复用 DSH 宿主能力：`uiWorkspace.openSession(id)` 切会话、订阅会话列表/状态 hook（参考 `dsh-afterwave-style/src/runtime.js`）、读取/填充外部输入框及导出已加载消息（参考 `dsh-afterwave-style/src/chat-tools.js` 与 `exporter.js`）。
2. **配 Key 模式的 CORS 处理**：
   - 浏览器直连部分 OpenAI 兼容接口可能遇到 CORS。优先确认 DSH Cordis 服务端是否可挂轻量代理路由（仅用 Node 原生 `fetch`，零三方依赖，保证 Windows 无痛安装）；若宿主未暴露标准路由，支持浏览器直连 + 明确错误提示，并允许用户填写自定义代理地址。
3. **构建、测试与离线预览**：
   - 使用 `esbuild` 打包单文件 `lib/client.js`（内联 CSS，零运行时外链资源）。
   - 提供 `npm run preview` 生成 `dist/preview.html`（内置模拟宿主 DSH 环境与多会话状态），无需启动真实 DSH 即可完整体验与截图验收。
   - 提供 `npm test`（`node --test` + `jsdom`）覆盖核心状态机、双模 Mini DSH、Note Pad、软盘导出与扫雷逻辑。

---

## 4. 下一步建议（在新会话中直接执行）

1. 初始化 `/Volumes/E61/zhouwei/projects/dsh-hello84`（`git init`、`package.json`、`cordis.patch.yml`、`scripts/build.mjs`、`scripts/preview.mjs`）。
2. 先搭起 **1984 Macintosh 机身外壳 + 1-bit 桌面窗口管理器 + 3 套屏幕模式 + 迷你待机/贴边收起态**，跑通 `dist/preview.html` 视觉验收。
3. 依次接入 **Mini DSH（零配置宿主遥控 + 配 Key 副脑）**、**Note Pad**、**Floppy Disk（MD + 复古 PNG 卡片）**、**Alarm Clock**、**MacPaint Lite & 扫雷**。
4. 补齐 `npm test` 单测、`README.md` 与 `dsh-market` / `awesome-dsh-plugin` 提交资料。
