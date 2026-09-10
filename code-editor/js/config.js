/**
 * ============================================================================
 * config.js — 常量、默认值、语言与编码定义
 * ============================================================================
 *
 * 本模块从 v7.7.0 单文件主脚本顶部提取，保留全部常量定义：
 *   - CONFIG：应用版本、大文件阈值、历史记录限制、自动保存延迟、
 *             搜索超时、Java 运行超时、Toast 时长
 *   - STORAGE_KEYS：全部 localStorage 存储键
 *   - INDEXED_DB / DIR_HANDLE_DB：IndexedDB 数据库配置
 *   - LANGUAGE_DISPLAY_NAMES / LANGUAGE_EXTENSIONS：语言映射
 *   - ENCODING_DISPLAY_NAMES：编码显示名称（仅保留 4 种）
 *   - DEFAULT_CODE_BY_LANGUAGE：各语言默认代码模板
 *   - THEME_SEQUENCE / THEME_ICONS：主题切换顺序与图标
 *   - MIME_TYPES / EXTENSION_LANGUAGE_MAP / VALID_TEXT_FILE_EXTENSION_REGEX
 *
 * 本模块只导出纯数据，无 DOM 依赖、无副作用，可被任意其他模块安全引入。
 * ============================================================================
 */

export const CONFIG = Object.freeze({
    APP_VERSION: '8.1.1',

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
    // 统一由 search.js 的 updateMatchCountDebounced 使用，
    // fullUpdate 注入的回调也是这个防抖版本，避免被绕过。
    MATCH_COUNT_DEBOUNCE_MS: 150,

    // ---- Java 运行 ----
    JAVA_RUN_TIMEOUT_MS: 30000,

    // ---- Toast ----
    TOAST_DURATION_MS: 2500
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
    REPLACE_WITH_MANUAL_HEIGHT: 'replace-with-manual-height'
});

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
    java: 'Java'
});

export const LANGUAGE_EXTENSIONS = Object.freeze({
    js: 'js',
    html: 'html',
    css: 'css',
    python: 'py',
    java: 'java'
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
}`
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
    java: 'text/x-java-source'
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
    md: 'html'
});

export const VALID_TEXT_FILE_EXTENSION_REGEX = /\.(js|ts|jsx|html|css|py|java|txt|json|md|xml)$/i;