# 项目目录结构
code-editor/
├── index.html
├── css/
│   └── styles.css                ← 直接复制 v7.7.0 的 <style> 内容
└── js/
    ├── main.js                   ← 引导入口（script type="module"）
    ├── config.js                 ← 常量 / 存储键 / 默认值
    ├── util.js                   ← 通用工具 / 正则安全
    ├── state.js                  ← EditorState 全局状态
    ├── dom.js                    ← DOM 元素引用
    ├── toast.js                  ← Toast 提示
    ├── storage.js                ← localStorage / IndexedDB / 目录句柄
    ├── history.js                ← HistoryManager 撤销/重做
    ├── highlight.js              ← 语法高亮 + Shadow DOM
    ├── folding.js                ← 代码折叠
    ├── line-numbers.js           ← 行号渲染 + 光标 + scrollToCursor
    ├── encoding.js               ← 编码检测 / 解码 / 编码（GB18030 Worker）
    ├── search.js                 ← 查找替换 + 搜索 Worker
    ├── editor-api.js             ← 统一编辑入口（循环依赖解耦）
    ├── editor.js                 ← 编辑器核心（键盘 / 缩进 / 注释 / 粘贴）
    ├── file-io.js                ← 导入 / 下载 / 拖拽
    ├── output.js                 ← 输出面板
    ├── java-runner.js            ← Java 编译运行
    ├── ui.js                     ← 主 UI 事件 / 快捷键 / 弹窗
    └── （共 19 个 JS 文件）