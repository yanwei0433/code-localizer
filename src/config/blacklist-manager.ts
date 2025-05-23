// 黑名单管理模块，处理JSON格式的黑名单配置
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 黑名单数据接口
export interface BlacklistData {
    technicalTerms: string[];
    ignoreList: string[];
    meaningfulShortWords: string[];
    pythonKeywords: string[];
    customBlacklist: string[];
}

// 默认黑名单文件名
const DEFAULT_BLACKLIST_FILENAME = 'blacklist.json';

/**
 * 获取黑名单文件路径
 * @param context VS Code扩展上下文
 * @returns 黑名单文件的完整路径
 */
function getBlacklistPath(context: vscode.ExtensionContext): string {
    // 使用全局存储目录保存黑名单文件
    return path.join(context.globalStorageUri.fsPath, DEFAULT_BLACKLIST_FILENAME);
}

/**
 * 从JSON文件加载黑名单数据
 * @param context VS Code扩展上下文
 * @returns 黑名单数据
 */
export async function loadBlacklist(context: vscode.ExtensionContext): Promise<BlacklistData> {
    try {
        // 获取黑名单文件路径
        const blacklistPath = getBlacklistPath(context);
        
        // 确保全局存储目录存在
        await ensureDirectoryExists(path.dirname(blacklistPath));
        
        // 检查黑名单文件是否存在
        if (!fs.existsSync(blacklistPath)) {
            // 如果不存在，复制默认黑名单
            await copyDefaultBlacklist(context);
        }
        
        // 读取黑名单文件
        const data = fs.readFileSync(blacklistPath, 'utf-8');
        const blacklist = JSON.parse(data) as BlacklistData;
        
        console.log(`[CodeLocalizer] 已加载黑名单，包含 ${blacklist.technicalTerms.length} 个技术术语和 ${blacklist.customBlacklist.length} 个自定义黑名单项`);
        
        return blacklist;
    } catch (error) {
        console.error(`[CodeLocalizer] 加载黑名单失败:`, error);
        
        // 出错时返回默认黑名单
        return getDefaultBlacklist();
    }
}

/**
 * 确保目录存在，如果不存在则创建
 * @param directory 目录路径
 */
async function ensureDirectoryExists(directory: string): Promise<void> {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
}

/**
 * 将默认黑名单复制到全局存储目录
 * @param context VS Code扩展上下文
 */
async function copyDefaultBlacklist(context: vscode.ExtensionContext): Promise<void> {
    try {
        // 获取默认黑名单路径（扩展目录下的blacklist.json）
        const defaultBlacklistPath = path.join(context.extensionPath, DEFAULT_BLACKLIST_FILENAME);
        const targetPath = getBlacklistPath(context);
        
        // 如果默认黑名单文件存在，则复制
        if (fs.existsSync(defaultBlacklistPath)) {
            const data = fs.readFileSync(defaultBlacklistPath, 'utf-8');
            fs.writeFileSync(targetPath, data);
            console.log(`[CodeLocalizer] 已复制默认黑名单到 ${targetPath}`);
        } else {
            // 如果默认黑名单文件不存在，则创建一个新的
            const defaultData = JSON.stringify(getDefaultBlacklist(), null, 2);
            fs.writeFileSync(targetPath, defaultData);
            console.log(`[CodeLocalizer] 已创建新的默认黑名单到 ${targetPath}`);
        }
    } catch (error) {
        console.error(`[CodeLocalizer] 复制默认黑名单失败:`, error);
        throw error;
    }
}

/**
 * 获取默认黑名单数据
 * @returns 默认黑名单数据
 */
function getDefaultBlacklist(): BlacklistData {
    return {
        technicalTerms: [
            "python", "java", "javascript", "typescript", "php", "ruby", "go", "golang", "rust", "c", "cpp", "csharp",
            "react", "vue", "angular", "node", "npm", "yarn", "webpack", "babel", "django", "flask", "spring", "laravel",
            ".net", "dotnet", "unity", "swift", "kotlin", "scala", "perl", "lua", "julia", "haskell", "clojure",
            
            "api", "rest", "graphql", "json", "xml", "html", "css", "dom", "web", "ui", "ux", "db", "sql", "nosql", 
            "mongo", "redis", "mysql", "postgres", "sqlite", "oracle", "aws", "azure", "gcp", "cloud", "docker", 
            "kubernetes", "k8s", "git", "github", "gitlab", "heroku", "devops", "cicd", "ai", "ml", "dl",
            
            "http", "https", "ftp", "ssh", "tcp", "ip", "udp", "dns", "smtp", "imap", "pop3", "oauth", "jwt",
            "ascii", "utf8", "utf16", "unicode", "iso", "ieee", "uri", "url", "urn", "mime", "tls", "ssl",
            
            "jpg", "jpeg", "png", "gif", "svg", "pdf", "doc", "docx", "xls", "xlsx", "csv", "md", "txt", "rtf",
            "zip", "rar", "tar", "gz", "exe", "dll", "so", "lib", "jar", "war", "apk", "dmg", "iso",
            
            "id", "uuid", "guid", "crud", "mvc", "mvvm", "spa", "pwa", "sdk", "cli", "ide", "cdn", 
            "seo", "ssr", "csr", "orm", "acid", "cap", "idl", "rpc", "ram", "rom", "cpu", "gpu", "iot",
            
            "scss", "sass", "less", "stylus", "postcss", "tailwind", "bootstrap", "bulma", "uikit", "mui",
            "chakra", "mantine", "material", "ant", "elementui", "quasar", "vuetify", "nuxt", "next", "remix",
            "astro", "svelte", "preact", "ember", "flex", "grid", "rgba", "hsla", "rgb", "hsl", "var",
            
            "uni", "wx", "vant", "taro", "rn", "uview", "axios", "fetch", "lodash", "jquery", "moment",
            "dayjs", "math", "md5", "sha", "uuid", "crypto", "util", "async", "env", "init",
            
            "vscode", "intellij", "webstorm", "eslint", "prettier", "stylelint", "jshint", "husky",
            "lint", "jest", "mocha", "chai", "karma", "cypress", "msw", "storybook", "vite", "rollup"
        ],
        ignoreList: [
            "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", 
            "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
            "id", "db", "ui", "io", "os", "fs", "js", "ts", "rx", "ms", "ns",
            "px", "fn", "ip", "ok", "el", "idx", "tmp", "img", "btn", "num", 
            "obj", "src", "dst", "len", "pos", "val", "err", "res", "req",
            "i", "j", "k", "x", "y", "z", "n"
        ],
        meaningfulShortWords: [
            "by", "to", "of", "in", "on", "at", "is", "as", "for", "if",
            "def", "self", "len"
        ],
        pythonKeywords: [
            "class", "def", "self", "init", "__init__", "return", "len",
            "list", "dict", "set", "tuple", "str", "int", "float", "bool",
            "import", "from", "as", "try", "except", "finally",
            "with", "yield", "lambda", "pass", "break", "continue"
        ],
        customBlacklist: []
    };
}

/**
 * 保存黑名单数据到JSON文件
 * @param context VS Code扩展上下文
 * @param blacklist 黑名单数据
 */
export async function saveBlacklist(context: vscode.ExtensionContext, blacklist: BlacklistData): Promise<void> {
    try {
        const blacklistPath = getBlacklistPath(context);
        await ensureDirectoryExists(path.dirname(blacklistPath));
        
        // 格式化JSON数据，使用2个空格缩进
        const data = JSON.stringify(blacklist, null, 2);
        fs.writeFileSync(blacklistPath, data);
        
        console.log(`[CodeLocalizer] 已保存黑名单到 ${blacklistPath}`);
    } catch (error) {
        console.error(`[CodeLocalizer] 保存黑名单失败:`, error);
        throw error;
    }
}

/**
 * 获取使用给定黑名单的Set对象
 * @param blacklist 黑名单数据
 * @returns 技术术语黑名单集合
 */
export function getTermsSet(blacklist: BlacklistData): Set<string> {
    return new Set([...blacklist.technicalTerms, ...blacklist.customBlacklist]);
}

/**
 * 从黑名单中获取忽略列表集合
 * @param blacklist 黑名单数据
 * @returns 忽略列表集合
 */
export function getIgnoreSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.ignoreList);
}

/**
 * 从黑名单中获取有意义的短词集合
 * @param blacklist 黑名单数据
 * @returns 有意义短词集合
 */
export function getMeaningfulShortWordsSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.meaningfulShortWords);
}

/**
 * 从黑名单中获取Python关键词集合
 * @param blacklist 黑名单数据
 * @returns Python关键词集合
 */
export function getPythonKeywordsSet(blacklist: BlacklistData): Set<string> {
    return new Set(blacklist.pythonKeywords);
}

/**
 * 添加术语到自定义黑名单
 * @param context VS Code扩展上下文
 * @param term 要添加的术语
 */
export async function addTermToCustomBlacklist(context: vscode.ExtensionContext, term: string): Promise<void> {
    try {
        // 加载当前黑名单
        const blacklist = await loadBlacklist(context);
        
        // 检查是否已存在
        if (blacklist.customBlacklist.includes(term)) {
            console.log(`[CodeLocalizer] 术语 "${term}" 已存在于自定义黑名单中`);
            return;
        }
        
        // 添加新术语
        blacklist.customBlacklist.push(term);
        
        // 保存更新后的黑名单
        await saveBlacklist(context, blacklist);
        
        console.log(`[CodeLocalizer] 术语 "${term}" 已添加到自定义黑名单`);
    } catch (error) {
        console.error(`[CodeLocalizer] 添加术语到自定义黑名单失败:`, error);
        throw error;
    }
}

/**
 * 从自定义黑名单中移除术语
 * @param context VS Code扩展上下文
 * @param term 要移除的术语
 */
export async function removeTermFromCustomBlacklist(context: vscode.ExtensionContext, term: string): Promise<void> {
    try {
        // 加载当前黑名单
        const blacklist = await loadBlacklist(context);
        
        // 查找术语索引
        const index = blacklist.customBlacklist.indexOf(term);
        
        // 如果找不到，直接返回
        if (index === -1) {
            console.log(`[CodeLocalizer] 术语 "${term}" 不在自定义黑名单中`);
            return;
        }
        
        // 移除术语
        blacklist.customBlacklist.splice(index, 1);
        
        // 保存更新后的黑名单
        await saveBlacklist(context, blacklist);
        
        console.log(`[CodeLocalizer] 术语 "${term}" 已从自定义黑名单中移除`);
    } catch (error) {
        console.error(`[CodeLocalizer] 从自定义黑名单移除术语失败:`, error);
        throw error;
    }
}

/**
 * 打开黑名单文件进行编辑
 * @param context VS Code扩展上下文
 */
export async function openBlacklistForEditing(context: vscode.ExtensionContext): Promise<void> {
    try {
        // 确保黑名单文件存在
        const blacklistPath = getBlacklistPath(context);
        
        if (!fs.existsSync(blacklistPath)) {
            await copyDefaultBlacklist(context);
        }
        
        // 打开文件
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(blacklistPath));
        await vscode.window.showTextDocument(document);
        
        // 提示用户
        vscode.window.showInformationMessage('黑名单文件已打开，编辑后保存即可生效');
    } catch (error) {
        console.error(`[CodeLocalizer] 打开黑名单文件失败:`, error);
        vscode.window.showErrorMessage(`打开黑名单文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 检查标识符是否是颜色代码
 * @param identifier 要检查的标识符
 * @returns 是否是颜色代码
 */
export function isHexColor(identifier: string): boolean {
    // 用于检测16进制颜色代码的正则表达式集合
    const hexColorPatterns = [
        /^[0-9a-fA-F]{3}$/,             // 3位十六进制颜色 (如 fff, f0f, a1b)
        /^[0-9a-fA-F]{6}$/,             // 6位十六进制颜色 (如 f0f0f0, 123abc)
        /^[0-9a-fA-F]{8}$/,             // 8位十六进制颜色 (带透明度, 如 f0f0f0ff)
        /^[0-9a-fA-F]{2,8}$/,           // 可能是颜色代码的格式 (需要另外检查是否包含字母)
        /^([0-9a-fA-F])\1+$/,           // 重复字符的十六进制 (如 fff, aaa)
        /^([0-9a-fA-F]{2})\1+$/         // 重复双字符的十六进制 (如 ababab)
    ];

    // 检查是否匹配任何一个颜色代码模式
    const isBasicHexColor = hexColorPatterns.some((pattern, index) => {
        // 对于第4个模式 (index=3)，需要额外检查是否包含字母
        if (index === 3) {
            return pattern.test(identifier) && /[a-fA-F]/.test(identifier);
        }
        return pattern.test(identifier);
    });
    
    return isBasicHexColor;
} 