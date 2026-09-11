/**
 * ============================================================================
 * config.js — 常量、默认值、语言与编码定义
 * ============================================================================
 *
 * 集中管理应用常量与默认值，无 DOM 依赖、无副作用。
 *
 * 【v8.6.1 更新】
 *   - APP_VERSION 更新为 '8.6.1'（此前误留为 '8.6.0'，导致控制台
 *     启动日志与实际版本号不符，且导出设置文件的 _meta.appVersion
 *     写入错误版本号）
 *
 * 【v8.6.0 更新】
 *   - 新增 SETTINGS_EXPORTABLE_KEYS：设置导出 / 导入的键全集，
 *     与 STORAGE_KEYS 相邻维护，避免将来新增键时漏导出
 * ============================================================================
 */

export const CONFIG = Object.freeze({
    APP_VERSION: '8.6.1',

    // ---- 大文件阈值 ----
    LARGE_FILE_THRESHOLD: 300 * 1024,
    ABSOLUTE_FILE_SIZE_LIMIT: 2 * 1024 * 1024,
    MAX_PASTE_SIZE: 1.5 * 1024 * 1024,

    // ---- 历史记录 ----
    MAX_HISTORY: 200,
    LARGE_FILE_MAX_HISTORY: 30,

    // ---- 自动保存延迟 ----
    AUTOSAVE_DELAY_NORMAL: 800,
    AUTOSAVE_DELAY_LARGE_FILE: 2000,
    AUTOSAVE_LOCAL_STORAGE_MAX_LENGTH: 500000,

    // ---- 搜索 ----
    SEARCH_TIMEOUT_MS: 200,
    SEARCH_TIMEOUT_GRACE_MS: 100,

    // ---- 匹配计数防抖 ----
    MATCH_COUNT_DEBOUNCE_MS: 150,

    // ---- Java 运行 ----
    JAVA_RUN_TIMEOUT_MS: 30000,

    // ---- Toast ----
    TOAST_DURATION_MS: 2500,

    // ---- 自定义文件后缀 ----
    FILE_EXTENSION_MAX_LENGTH: 12,
    FILE_EXTENSION_HISTORY_MAX: 20,

    // ---- 设置导出 / 导入 ----
    SETTINGS_FILE_MAX_SIZE: 5 * 1024 * 1024,
    SETTINGS_RELOAD_DELAY_MS: 1500
});

export const STORAGE_KEYS = Object.freeze({
    CODE_CACHE: 'editor-code-cache-v6',
    THEME: 'editor-theme-v6',
    INDENT: 'editor-indent-v6',
    FONT_SIZE: 'editor-font-size-v6',
    LANGUAGE: 'editor-language-v6',
    WRAP_ENABLED: 'editor-wrap-enabled-v6',
    REPLACE_FIND: 'editor-replace-find-v6',
    REPLACE_WITH: 'editor-replace-with-v6',
    REPLACE_CASE_SENSITIVE: 'editor-replace-case-sensitive-v6',
    REPLACE_WHOLE_WORD: 'editor-replace-whole-word-v6',
    REPLACE_USE_REGEX: 'editor-replace-use-regex-v6',
    REPLACE_MODAL_POSITION: 'editor-replace-modal-position-v6',
    REPLACE_MODAL_SIZE: 'editor-replace-modal-size-v6',
    HIGHLIGHT_ENABLED: 'editor-highlight-enabled-v6',
    DIRTY_FLAG: 'editor-dirty-flag',
    FOLDED_RANGES: 'editor-folded-ranges-v6',
    STDIN_CACHE: 'editor-stdin-cache-v6',
    ENCODING: 'editor-encoding-v7',
    JAVA_VERSION: 'editor-java-version-v7',
    LAST_DOWNLOAD_FILENAME: 'editor-last-download-filename',
    REPLACE_FIND_MANUAL_HEIGHT: 'replace-find-manual-height',
    REPLACE_WITH_MANUAL_HEIGHT: 'replace-with-manual-height',
    FILE_EXTENSION: 'editor-file-extension-v8',
    FILE_EXTENSION_HISTORY: 'editor-file-extension-history-v8',
    LANGUAGE_EXTENSION_MAP: 'editor-language-extension-map-v9'
});

/**
 * v8.6.0 新增：设置导出 / 导入的键全集。
 *
 * 有意排除的键（不属于"设置"，不应被导出或覆盖）：
 *   · CODE_CACHE     —— 编辑器代码内容，由自动保存机制独立管理
 *   · DIRTY_FLAG     —— 运行时脏标记，页面重启后即清
 *   · FILE_EXTENSION —— v8.4.1 历史遗留键，仅在初始化时迁移后清理
 *
 * 新增持久化键时，请同步追加到本列表，并在 settings-io.js 的
 * SETTINGS_VALUE_VALIDATORS 中补充相应校验规则（未定义校验的键
 * 宽松放行，但显式校验更安全）。
 */
export const SETTINGS_EXPORTABLE_KEYS = Object.freeze([
    STORAGE_KEYS.THEME,
    STORAGE_KEYS.INDENT,
    STORAGE_KEYS.FONT_SIZE,
    STORAGE_KEYS.LANGUAGE,
    STORAGE_KEYS.WRAP_ENABLED,
    STORAGE_KEYS.HIGHLIGHT_ENABLED,
    STORAGE_KEYS.ENCODING,
    STORAGE_KEYS.JAVA_VERSION,
    STORAGE_KEYS.FOLDED_RANGES,
    STORAGE_KEYS.STDIN_CACHE,
    STORAGE_KEYS.REPLACE_FIND,
    STORAGE_KEYS.REPLACE_WITH,
    STORAGE_KEYS.REPLACE_CASE_SENSITIVE,
    STORAGE_KEYS.REPLACE_WHOLE_WORD,
    STORAGE_KEYS.REPLACE_USE_REGEX,
    STORAGE_KEYS.REPLACE_MODAL_POSITION,
    STORAGE_KEYS.REPLACE_MODAL_SIZE,
    STORAGE_KEYS.REPLACE_FIND_MANUAL_HEIGHT,
    STORAGE_KEYS.REPLACE_WITH_MANUAL_HEIGHT,
    STORAGE_KEYS.LAST_DOWNLOAD_FILENAME,
    STORAGE_KEYS.FILE_EXTENSION_HISTORY,
    STORAGE_KEYS.LANGUAGE_EXTENSION_MAP
]);

export const INDEXED_DB = Object.freeze({
    NAME: 'editor-autosave-db',
    STORE_NAME: 'code-store',
    KEY: 'latest-code',
    VERSION: 1
});

export const DIR_HANDLE_DB = Object.freeze({
    NAME: 'code-editor-fs',
    STORE_NAME: 'handles',
    KEY: 'save-directory',
    VERSION: 1
});

export const LANGUAGE_DISPLAY_NAMES = Object.freeze({
    js: 'JavaScript',
    html: 'HTML',
    css: 'CSS',
    python: 'Python',
    java: 'Java',
    txt: 'Plain Text'
});

export const LANGUAGE_EXTENSIONS = Object.freeze({
    js: 'js',
    html: 'html',
    css: 'css',
    python: 'py',
    java: 'java',
    txt: 'txt'
});

export const AUTO_EXTENSION_BY_LANGUAGE = Object.freeze({
    js: 'js',
    html: 'html',
    css: 'css',
    python: 'py',
    java: 'java',
    txt: ''
});

export const LANGUAGE_ALLOW_CUSTOM_EXTENSION = Object.freeze({
    js: false,
    html: true,
    css: false,
    python: false,
    java: false,
    txt: true
});

export const LANGUAGE_SHOW_HISTORY_DROPDOWN = Object.freeze({
    js: false,
    html: true,
    css: false,
    python: false,
    java: false,
    txt: true
});

export const ENCODING_DISPLAY_NAMES = Object.freeze({
    'auto': '自动检测',
    'utf-8': 'UTF-8',
    'utf-8-bom': 'UTF-8 BOM',
    'windows-1252': 'ANSI (1252)'
});

export const DEFAULT_CODE_BY_LANGUAGE = Object.freeze({
    js: `// 🎉 欢迎使用在线代码编辑器！
function fibonacci(n) {
  if (n <= 1) return n;
  const memo = [0, 1];
  for (let i = 2; i <= n; i++) {
    memo[i] = memo[i - 1] + memo[i - 2];
  }
  return memo[n];
}
console.log('Fibonacci(10) =', fibonacci(10));
console.log('Fibonacci(20) =', fibonacci(20));`,
    python: `# 🐍 Python 示例
def fibonacci(n):
    if n <= 1:
        return n
    memo = [0, 1]
    for i in range(2, n + 1):
        memo.append(memo[i-1] + memo[i-2])
    return memo[n]

print(f"Fibonacci(10) = {fibonacci(10)}")
print(f"Fibonacci(20) = {fibonacci(20)}")`,
    html: `<!-- 🌐 HTML 示例 -->
<!DOCTYPE html>
<html>
<head>
  <title>示例页面</title>
</head>
<body>
  <h1>Hello, World!</h1>
  <p>这是一个 HTML 示例</p>
</body>
</html>`,
    css: `/* 🎨 CSS 示例 */
body {
  font-family: 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #667eea, #764ba2);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}`,
    java: `// ☕ Java 示例
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, Java!");
        
        int n = 10;
        System.out.println("Fibonacci(" + n + ") = " + fibonacci(n));
        
        int[] numbers = {5, 2, 8, 1, 9};
        java.util.Arrays.sort(numbers);
        System.out.print("排序后: ");
        for (int num : numbers) {
            System.out.print(num + " ");
        }
        System.out.println();
    }
    
    public static long fibonacci(int n) {
        if (n <= 1) return n;
        long[] memo = new long[n + 1];
        memo[0] = 0;
        memo[1] = 1;
        for (int i = 2; i <= n; i++) {
            memo[i] = memo[i - 1] + memo[i - 2];
        }
        return memo[n];
    }
}`,
    txt: `这是一段纯文本示例。

在 TXT 模式下：
  · 无语法高亮
  · 无 Java 运行支持
  · 后缀可自由输入（会出现在下拉历史中）

Hello, World!`
});

export const THEME_SEQUENCE = Object.freeze(['dark', 'light', 'ink', 'cream']);

export const THEME_ICONS = Object.freeze({
    dark: '☀️',
    light: '🌙',
    ink: '🌊',
    cream: '🧁'
});

export const MIME_TYPES = Object.freeze({
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    py: 'text/x-python',
    java: 'text/x-java-source',
    txt: 'text/plain'
});

export const EXTENSION_LANGUAGE_MAP = Object.freeze({
    js: 'js',
    ts: 'js',
    jsx: 'js',
    html: 'html',
    css: 'css',
    py: 'python',
    java: 'java',
    json: 'js',
    xml: 'html',
    md: 'html',
    txt: 'txt'
});

export const VALID_TEXT_FILE_EXTENSION_REGEX = /\.(js|ts|jsx|html|css|py|java|txt|json|md|xml)$/i;