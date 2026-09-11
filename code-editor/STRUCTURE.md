# 项目目录结构

code-editor/
├── index.html
├── css/
│   └── styles.css                ← 全站样式（含四主题变量 / 组件 / 响应式）
└── js/
    ├── main.js                   ← 引导入口（script type="module"）
    ├── config.js                 ← 常量 / 存储键 / 设置导出键集 / 默认值
    ├── util.js                   ← 通用工具 / 正则安全
    ├── state.js                  ← EditorState 全局状态
    ├── dom.js                    ← DOM 元素引用
    ├── toast.js                  ← Toast 提示
    ├── storage.js                ← localStorage / IndexedDB / 目录句柄
    ├── history.js                ← HistoryManager 撤销/重做
    ├── highlight.js              ← 语法高亮 + Shadow DOM
    ├── folding.js                ← 代码折叠
    ├── line-numbers.js           ← 行号渲染 + 光标 + scrollToCursor
    ├── encoding.js               ← 编码检测 / 解码 / 编码（UTF-8 / BOM / 1252）
    ├── search.js                 ← 查找替换 + 搜索 Worker
    ├── editor-api.js             ← 统一编辑入口（循环依赖解耦）
    ├── editor.js                 ← 编辑器核心（键盘 / 缩进 / 注释 / 粘贴）
    ├── file-io.js                ← 导入 / 下载 / 拖拽 / 后缀联动
    ├── output.js                 ← 输出面板
    ├── java-runner.js            ← Java 编译运行（Piston API）
    ├── ui.js                     ← 主 UI 事件 / 快捷键 / 弹窗
    ├── settings-io.js            ← 设置导出 / 导入（v8.6.0 新增）
    └── （共 20 个 JS 文件）