# Hello '84（`dsh-hello84`）

> 在 DeepSeek Harness（DSH）窗口角落养一台活着的 1984 复古 Macintosh。

**不绑定任何主题**（Shadow DOM 严格样式隔离，自动兼容默认界面、四号船坞及其他皮肤），零原生依赖，Windows / macOS / Linux 开箱即用。

## 核心功能

- **1984 Macintosh 机身与 3 套屏幕模式**：默认经典 1-bit 黑白像素（System 6/7 质感），一键切换 `Classic 1-bit` / `CRT Green` / `CRT Amber`，带首次展开 `hello.` 手写开机仪式与可选 Web Audio 复古提示音（默认静音）。
- **多态活体小 Mac 与边缘吸附**：角落可拖拽的迷你像素小 Mac，拖近屏幕左右边缘自动贴边收起；待机自动轮播 1984 经典屏保（Happy Mac / 飞翔烤面包机 / 像素星海 / 迷你时钟），干活时实时切转手表 / 滚动代码条 / 软驱红灯狂闪 / 待审批 Happy Mac / 出错 Sad Mac（`0F0064`）。
- **InnerLife（内心剧场 & 主动冒泡）**：借鉴 ClaraCore InnerLife 的静默观察与反话痨门禁（`[NO_SHARE]` 哨兵、Token 相似度去重、冷却与候选池上限）；零配置走本地启发，配 Key（默认 `deepseek-flash`）后在任务结束/报错/草稿停顿的空闲窗口自主琢磨并弹出 1-bit 思绪气泡，支持一键「填入主框 / 副脑深聊 / 存便签 / 忽略」。
- **Mini DSH（双模套娃客户端）**：
  - **零配置模式**：实时同步外部 DSH 会话列表与状态，点击切换主会话，终端直接填入或发送到外部输入框。
  - **配 Key 模式**：配置 DeepSeek / 任意 OpenAI 兼容 API，独立旁路对话不污染主上下文；支持一键抓取外部草稿/最近回复进行「润色 / 挑刺 / 翻译 / 总结」，并支持本地工具调用（写 Note Pad、设 Alarm、回填外部草稿）。
- **Note Pad（经典翻页便签）**：多页翻页便签，持久化到 `localStorage`，一键注入外部 DSH 输入框。
- **Floppy Disk（3.5 寸软盘导出）**：一键导出外部当前会话为 Markdown，或渲染成 **1984 Macintosh 窗口风格 PNG 分享长图**（自动脱敏本机路径）。
- **Alarm Clock（复古闹钟）**：番茄钟 / 倒计时 + 外部任务跑完 / 卡审批 / 出错时复古提示音提醒。
- **摸鱼小彩蛋**：内置 1-bit **MacPaint Lite** 像素画板与 **Minesweeper** 扫雷。

## 开发与验证

```bash
npm install
npm run build      # 生成单文件 lib/client.js（内联 CSS）
npm run preview    # 生成离线交互预览 dist/preview.html
npm test           # 运行构建与全部单元测试
```
