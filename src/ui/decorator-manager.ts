// 装饰器管理模块，负责将翻译应用到编辑器显示
import * as vscode from 'vscode';
import { Vocabulary } from '../types';
import { getTranslation } from '../vocabulary/vocabulary-manager';
import { getSyntaxColor } from './syntax-highlighter';

// 存储所有活跃的装饰类型
let activeDecorations: vscode.TextEditorDecorationType[] = [];
// 存储当前装饰的标识符范围信息
const decorationRanges = new Map<string, vscode.DecorationOptions[]>();

/**
 * 清除所有现有的装饰
 */
export function clearAllDecorations() {
    // 清除所有现有的装饰类型
    activeDecorations.forEach(decoration => decoration.dispose());
    activeDecorations = [];
    decorationRanges.clear();
    console.log(`[CodeLocalizer] 已清除所有母语装饰`);
}

/**
 * 检查给定位置是否在代码注释中
 * @param document 文档对象
 * @param position 要检查的位置
 * @returns 是否在注释中
 */
function isInComment(document: vscode.TextDocument, position: vscode.Position): boolean {
    // 获取当前行的文本
    const line = document.lineAt(position.line).text;
    
    // 检查当前位置是否在单行注释之后
    
    // 处理常见编程语言的单行注释符号
    const singleLineComments = [
        '//', // C, C++, Java, JavaScript, TypeScript
        '#',  // Python, Ruby, Shell, Perl
        '--', // SQL, Lua
        '%',  // MATLAB, LaTeX
        ';',  // Assembly, Lisp
        "'",  // VB
        '<!--', // HTML, XML
        '/*'  // CSS开始标记
    ];
    
    // 检查是否在单行注释中
    for (const commentStart of singleLineComments) {
        const commentIndex = line.indexOf(commentStart);
        // 如果找到注释符号，且当前位置在注释符号之后
        if (commentIndex !== -1 && position.character > commentIndex) {
            return true;
        }
    }
    
    // 处理多行注释，需要查找整个文本
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    // 常见多行注释的开始和结束标记
    const multilineCommentPairs = [
        { start: '/*', end: '*/' },     // C, C++, Java, JavaScript, CSS
        { start: '<!--', end: '-->' },  // HTML, XML
        { start: '=begin', end: '=end' }, // Ruby
        { start: '"""', end: '"""' },   // Python 文档字符串
        { start: "'''", end: "'''" },   // Python 文档字符串
        { start: '{-', end: '-}' },     // Haskell
        { start: '(*', end: '*)' }      // OCaml
    ];
    
    // 检查是否在多行注释中
    for (const { start, end } of multilineCommentPairs) {
        let searchStartPos = 0;
        let commentStartIndex = -1;
        let commentEndIndex = -1;
        
        // 搜索所有多行注释块
        while (true) {
            commentStartIndex = text.indexOf(start, searchStartPos);
            if (commentStartIndex === -1) break;
            
            commentEndIndex = text.indexOf(end, commentStartIndex + start.length);
            // 如果找不到结束标记，则假设注释一直延伸到文件末尾
            if (commentEndIndex === -1) commentEndIndex = text.length;
            
            // 检查当前位置是否在注释块内
            if (offset > commentStartIndex && offset < commentEndIndex + end.length) {
                return true;
            }
            
            // 移动搜索位置到当前注释块之后
            searchStartPos = commentEndIndex + end.length;
        }
    }
    
    return false;
}

/**
 * 将驼峰命名法拆分为单词数组
 * 例如：userName -> ["user", "Name"]
 * @param identifier 驼峰命名的标识符
 * @returns 拆分后的单词数组
 */
function splitCamelCase(identifier: string): string[] {
    if (!identifier) {
        return [];
    }
    // 1. 在连续大写字母（通常是缩写词）和之后的大写字母加小写字母（单词的开始）之间插入下划线
    // 例如：JSONData -> JSON_Data, HTTPRequest -> HTTP_Request
    let result = identifier.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
    // 2. 在小写字母或数字与之后的大写字母之间插入下划线
    // 例如：myVariable -> my_Variable, version2Update -> version2_Update, userID -> user_ID
    result = result.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
    // 3. 在字母与之后的一个或多个数字之间插入下划线
    // 例如：version123 -> version_123, fileType2 -> fileType_2
    result = result.replace(/([a-zA-Z])(\d+)/g, '$1_$2'); // 数字匹配修正为 \d+
    // 4. 在一个或多个数字与之后的字母之间插入下划线
    // 例如：123version -> 123_version
    result = result.replace(/(\d+)([a-zA-Z])/g, '$1_$2'); // 数字匹配修正为 \d+

    return result.split('_').filter(p => p.length > 0);
}

/**
 * 检查是否是常见技术术语，这些术语通常不需要翻译
 * @param word 要检查的单词
 * @returns 是否是技术术语
 */
function isTechnicalTerm(word: string): boolean {
    // 常见的技术术语列表
    const technicalTerms = [
        // 编程语言
        'java', 'python', 'javascript', 'typescript', 'csharp', 'golang', 'ruby', 'php', 'swift', 'kotlin',
        // 数据库
        'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'oracle', 'sqlite',
        // 框架和库
        'react', 'angular', 'vue', 'node', 'express', 'django', 'flask', 'spring', 'hibernate', 'jquery',
        // 工具和平台
        'git', 'docker', 'kubernetes', 'jenkins', 'travis', 'aws', 'azure', 'gcp', 'heroku',
        // 协议和格式
        'http', 'https', 'tcp', 'udp', 'json', 'xml', 'yaml', 'csv', 'rest', 'graphql',
        // 其他常见技术术语
        'api', 'sdk', 'cli', 'gui', 'ui', 'ux', 'css', 'html', 'dom', 'ajax', 'cors',
        'auth', 'oauth', 'jwt', 'ssl', 'tls', 'ssh', 'ftp', 'smtp', 'imap',
        'cdn', 'dns', 'url', 'uri', 'ip', 'localhost', 'admin', 'dev', 'prod', 'qa', 'test',
        'crud', 'mvc', 'orm', 'spa', 'pwa', 'ssr', 'csr',
        'cpu', 'gpu', 'ram', 'rom', 'ssd', 'hdd', 'io'
    ];
    
    // 不区分大小写比较
    return technicalTerms.includes(word.toLowerCase());
}

/**
 * 检查是否是CSS颜色代码或单位等不需要翻译的技术值
 * @param word 要检查的单词
 * @returns 是否是技术值
 */
function isTechnicalValue(word: string): boolean {
    // 处理常见的CSS特定值（这些不应该被翻译）
    const cssSpecificValues = [
        'disabled', 'readonly', 'checked', 'selected', 'active', 'focus', 'hover',
        'enabled', 'hidden', 'visible', 'collapsed', 'expanded'
    ];
    
    if (cssSpecificValues.includes(word.toLowerCase())) {
        return true;
    }
    
    // 直接过滤常见的明显是颜色代码的短值
    const obviousColorCodes = ['FFF', 'fff', 'CCC', 'ccc', 'EEE', 'eee', 'AAA', 'aaa', 
                               'DDD', 'ddd', 'BBB', 'bbb', 'ECF', 'ecf', 'FCF', 'fcf',
                               'cccccc', 'CCCCCC', 'ffffff', 'FFFFFF', 'FF3B30', 'ff3b30',
                               'E8E93', 'e8e93', 'aaaaaa', 'AAAAAA'];
    
    if (obviousColorCodes.includes(word)) {
        return true;
    }
    
    // 检查英文单词 - 如果是普通英文单词，不应当被当作颜色代码过滤掉
    const commonEnglishWords = ['take', 'add', 'code', 'data', 'face', 'seed', 'deed',
                              'fade', 'made', 'bed', 'feed', 'beef'];
    
    if (commonEnglishWords.includes(word.toLowerCase())) {
        return false; // 允许这些单词被提取，即使它们看起来像颜色代码
    }
    
    // 检查是否是标准的十六进制颜色代码（不带#前缀）
    // 匹配3位、6位、8位纯十六进制（只包含0-9,a-f的字符）
    if (/^[0-9a-fA-F]{3}$/.test(word) || 
        /^[0-9a-fA-F]{6}$/.test(word) || 
        /^[0-9a-fA-F]{8}$/.test(word)) {
        return true;
    }
    
    // 检查非标准长度但可能是颜色代码的值（4位、5位等）
    // 对于长度2-8的值，如果全部是十六进制字符，且至少包含一个字母(a-f)，很可能是颜色
    if (/^[0-9a-fA-F]{2,8}$/.test(word) && /[a-fA-F]/.test(word)) {
        return true;
    }
    
    // 检查是否是带#前缀的十六进制颜色
    if (/^#([0-9a-fA-F]{1,8})$/.test(word)) {
        return true;
    }
    
    // 检查是否是RGB/RGBA格式
    if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/.test(word)) {
        return true;
    }
    
    // 检查是否是HSL/HSLA格式
    if (/^hsla?\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*(?:,\s*[\d.]+\s*)?\)$/.test(word)) {
        return true;
    }
    
    // 检查是否是CSS单位值
    if (/^-?\d+(\.\d+)?(px|em|rem|vh|vw|%|pt|pc|in|cm|mm|ex|ch|vmin|vmax|fr|deg|rad|turn|s|ms)$/.test(word)) {
        return true;
    }
    
    // 检查是否是纯数字
    if (/^-?\d+(\.\d+)?$/.test(word)) {
        return true;
    }
    
    return false;
}

/**
 * 将单词标准化为基本形式，移除所有非字母字符并转换为小写
 * 这样不同形式的相同单词都能被视为一个单词
 * @param word 要标准化的单词
 * @returns 标准化后的单词
 */
function normalizeWord(word: string): string {
    // 移除所有非字母字符，转换为小写
    return word.replace(/[^a-zA-Z]/g, '').toLowerCase();
}

/**
 * 验证翻译是否符合字母数量匹配规则
 * @param original 原始词
 * @param translated 翻译结果
 * @returns 如果符合匹配规则返回翻译，否则返回undefined
 */
function validateTranslationMatch(original: string, translated: string | undefined): string | undefined {
    if (!translated) {
        return undefined;
    }
    
    // 标准化两个单词（去除非字母字符并转为小写）
    const normalizedOriginal = normalizeWord(original);
    const normalizedTranslated = normalizeWord(translated);
    
    // 验证原始单词是否过短
    if (normalizedOriginal.length < 2) {
        return undefined;
    }
    
    // 检查是否完全匹配（大小写不敏感）
    if (normalizedOriginal.toLowerCase() === normalizedTranslated.toLowerCase()) {
        return translated; // 完全匹配可以直接返回
    }
    
    // 对于纯字母单词，确保字母数量完全相同
    // 只有确切的单词（忽略大小写但字母数量相同）才允许匹配
    if (/^[a-zA-Z]+$/.test(original) && /^[a-zA-Z]+$/.test(translated)) {
        if (normalizedOriginal.length !== normalizedTranslated.length) {
            console.log(`[CodeLocalizer] 字符数量不匹配，拒绝翻译: "${original}" -> "${translated}" (长度: ${normalizedOriginal.length} vs ${normalizedTranslated.length})`);
            return undefined;
        }
    }
    
    return translated;
}

/**
 * 添加更优先的匹配方法，直接在装饰器中使用，确保能完全忽略大小写匹配
 * @param vocabulary 词汇表
 * @param word 要查找的单词
 * @returns 找到的翻译或undefined
 */
function findTranslationIgnoreCase(vocabulary: Vocabulary, word: string): string | undefined {
    if (!vocabulary || !vocabulary.entries || !word) {
        return undefined;
    }
    
    // 标准化搜索词（移除非字母字符并转小写）
    const normalizedWord = normalizeWord(word);
    
    // 如果标准化后的词太短，可能不是有意义的单词
    if (normalizedWord.length < 2) {
        return undefined;
    }
    
    // 遍历词汇表查找匹配
    for (const entry of vocabulary.entries) {
        if (entry.type === 'identifier' && entry.original && entry.translated) {
            // 获取词汇表条目的标准化形式
            const normalizedEntry = normalizeWord(entry.original);
            
            // 重要: 检查标准化后的字符数量是否完全相同，避免uni匹配到unity的情况
            if (normalizedEntry.length !== normalizedWord.length) {
                continue; // 字母数量不匹配，跳过此条目
            }
            
            // 只有当字母数量相同且标准化后的词完全相同时才匹配
            if (normalizedEntry === normalizedWord) {
                console.log(`[CodeLocalizer] 增强大小写匹配成功: "${word}" -> "${entry.original}" (标准化: "${normalizedWord}")`);
                return entry.translated;
            }
        }
    }
    
    return undefined;
}

/**
 * 检查是否是文件路径或URL链接
 * @param text 要检查的文本
 * @returns 是否是路径或链接
 */
function isPathOrUrl(text: string): boolean {
    if (!text) {
        return false;
    }
    
    // 检查常见的文件路径格式
    const pathPatterns = [
        // 绝对路径
        /^\/[\w\-\.\/]+$/,
        // 相对路径（以./或../开头）
        /^\.\.?\/[\w\-\.\/]+$/,
        // Windows格式路径
        /^[a-zA-Z]:\\[\w\-\.\\]+$/,
        // 包含文件扩展名的路径（如.png, .js, .jsx, .ts, .tsx, .css等）
        /\.(?:png|jpe?g|gif|svg|webp|ico|js|jsx|ts|tsx|css|scss|less|html|htm|xml|json|ya?ml|md|pdf|zip|rar|gz|tar)$/i,
        // 静态资源路径格式
        /^(?:\/|\.\/|\.\.\/)(?:static|assets|img|images|media|resources)\/[\w\-\.\/]+$/i,
        // 以斜杠结尾的目录路径
        /\/[\w\-\.]+\/$/
    ];
    
    // 检查常见的URL格式
    const urlPatterns = [
        // 包含协议的URL
        /^(?:https?|ftp|file):\/\/[\w\-\.\/]+$/i,
        // 不含协议但以www开头的URL
        /^www\.[\w\-\.\/]+$/i,
        // 常见域名后缀
        /\.(?:com|org|net|edu|gov|io|app|co|me)(?:\/|$)/i
    ];
    
    // 检查是否匹配任意一种路径模式
    for (const pattern of pathPatterns) {
        if (pattern.test(text)) {
            return true;
        }
    }
    
    // 检查是否匹配任意一种URL模式
    for (const pattern of urlPatterns) {
        if (pattern.test(text)) {
            return true;
        }
    }
    
    // 特殊情况：检查是否是导入路径
    if (text.includes('/') && 
        (text.startsWith('./') || text.startsWith('../') || 
         text.startsWith('/') || /^@[\w-]+\/[\w-]+/.test(text))) {
        return true;
    }
    
    return false;
}

/**
 * 处理复合标识符的翻译
 * 如果整体没有翻译，尝试拆分并分别翻译各部分
 * @param original 原始复合标识符
 * @param vocabulary 词汇表
 * @returns 翻译结果
 */
function handleCompoundIdentifier(original: string, vocabulary: Vocabulary): string | undefined {
    // 检查是否是文件路径或URL链接
    if (isPathOrUrl(original)) {
        return undefined; // 不翻译路径或链接
    }
    
    // 检查是否是技术术语
    if (isTechnicalTerm(original)) {
        return undefined; // 不翻译技术术语
    }
    
    // 检查是否是CSS颜色代码或单位等技术值
    if (isTechnicalValue(original)) {
        return undefined; // 不翻译技术值
    }
    
    // 如果是下划线分隔的复合词（如 __init__ 或 my_variable_name）
    if (original.includes('_')) {
        const parts = original.split('_'); // 注意：这里不过滤空字符串，以保留下划线结构
        // 例如: "__init__" -> ["", "", "init", "", ""]
        // 例如: "my_var" -> ["my", "var"]
        // 例如: "_leading" -> ["", "leading"]

        const translatedPartsForUnderscore: string[] = []; // 使用局部变量
        let anyPartActuallyTranslatedInUnderscore = false; // 使用局部变量

        for (const part of parts) {
            if (part === '') { // 如果部分是空字符串（代表一个下划线的位置），直接保留
                translatedPartsForUnderscore.push(''); // 这将在 join('_') 时正确重建下划线
                continue;
            }

            // 检查是否是路径或链接的一部分
            if (isPathOrUrl(part)) {
                translatedPartsForUnderscore.push(part);
                continue;
            }
            
            if (isTechnicalTerm(part)) {
                translatedPartsForUnderscore.push(part);
                continue;
            }
            
            // 递归处理每个非空部分
            // 注意：这里对 part 的递归调用 handleCompoundIdentifier 自身
            let partTranslation = handleCompoundIdentifier(part, vocabulary) || 
                                findTranslationIgnoreCase(vocabulary, part) ||
                                getTranslation(vocabulary, part, 'identifier');
            
            partTranslation = validateTranslationMatch(part, partTranslation);
            
            if (partTranslation && partTranslation !== part) {
                translatedPartsForUnderscore.push(partTranslation);
                anyPartActuallyTranslatedInUnderscore = true; // 标记至少有一个有效部分被翻译了
            } else {
                translatedPartsForUnderscore.push(part); // 保持原样
            }
        }
        
        // 只有当至少有一个有效部分被实际翻译成不同内容时才返回组合结果
        if (anyPartActuallyTranslatedInUnderscore) {
            return translatedPartsForUnderscore.join('_');
        }
        // 如果没有任何一部分被翻译，则返回 undefined，表示此带下划线的词无法通过此方法翻译
        // 这会阻止后续逻辑（如 findTranslationIgnoreCase 对整个原始词的调用）尝试翻译它，从而避免丢失下划线
        return undefined; 
    }
    
    // 首先尝试使用增强的大小写不敏感匹配 (现在这部分逻辑在下划线处理之后)
    let wholeTranslation = findTranslationIgnoreCase(vocabulary, original);
    
    if (wholeTranslation) {
        return wholeTranslation;
    }
    
    // 然后尝试整体匹配（用getTranslation函数）
    wholeTranslation = getTranslation(vocabulary, original, 'identifier');
    
    // 重要: 对getTranslation的结果也进行字母数量匹配验证
    wholeTranslation = validateTranslationMatch(original, wholeTranslation);
    
    if (wholeTranslation) {
        return wholeTranslation;
    }
    
    // 检查原文是否应该被处理（长度太短的词可能不需要处理）
    // 对于下划线分隔的特殊标识符，此检查现在不再那么重要，因为下划线情况已优先处理
    // 但对于不含下划线的短词，此检查仍然有效。
    if (!original.includes('_') && original.length < 3) {
        return undefined;
    }
    
    let translatedParts: string[] = []; // 这个变量用于下面的前缀/后缀和驼峰处理
    let hasTranslation = false; // 这个变量主要用于前缀/后缀处理
    
    // 先尝试常见前缀/后缀分割 (确保其不干扰下划线处理，通过 !original.includes('_') 条件)
    const prefixMatch = original.match(/^(get|set|is|has|add|remove|create|update|delete|find|fetch|load|save|init|on|handle)([A-Z][a-zA-Z0-9_]*$)/i);
    if (prefixMatch && !original.includes('_')) { // 仅当不含下划线时优先应用此逻辑
        const prefix = prefixMatch[1];
        const rest = prefixMatch[2];
        
        let prefixTranslation = isTechnicalTerm(prefix) ? undefined : 
                              findTranslationIgnoreCase(vocabulary, prefix) || 
                              getTranslation(vocabulary, prefix, 'identifier');
        
        prefixTranslation = validateTranslationMatch(prefix, prefixTranslation);
        const restTranslation = handleCompoundIdentifier(rest, vocabulary); // 递归处理剩余部分
        
        if ((prefixTranslation || prefix) && (restTranslation || rest)) {
            hasTranslation = (prefixTranslation !== undefined && prefixTranslation !== prefix) || 
                             (restTranslation !== undefined && restTranslation !== rest);
            
            const result = `${prefixTranslation || prefix}${restTranslation || rest}`;
            if (hasTranslation) {
                return result;
            }
        }
    }
    
    // 处理驼峰命名法或其他混合模式 (如果不是下划线分隔)
    if (/[a-z][A-Z]/.test(original) || /^[a-z]+[A-Z][a-z]/.test(original)) {
        const parts = splitCamelCase(original);
        translatedParts = []; // 为驼峰逻辑重置
        hasTranslation = false; // 为驼峰逻辑重置 (虽然驼峰内部用 anyCamelPartTranslated)
        let anyCamelPartTranslated = false;
        
        for (const part of parts) {
            if (part.length < 2 && !(/[A-Z]/.test(part) && original.startsWith(part))) continue;

            if (isPathOrUrl(part)) { translatedParts.push(part); continue; }
            if (isTechnicalTerm(part)) { translatedParts.push(part); continue; }
            
            let partTranslation = findTranslationIgnoreCase(vocabulary, part) ||
                               getTranslation(vocabulary, part, 'identifier');
            
            partTranslation = validateTranslationMatch(part, partTranslation);
            
            if (partTranslation && partTranslation !== part) {
                translatedParts.push(partTranslation);
                anyCamelPartTranslated = true;
            } else {
                translatedParts.push(part);
            }
        }
        
        if (anyCamelPartTranslated) {
            return translatedParts.join('');
        }
    }
    
    return undefined; // 如果所有尝试都失败，返回undefined
}

/**
 * 应用母语装饰到编辑器，确保不更新临时词汇表
 * 此函数只负责显示装饰，不会触发提取逻辑
 */
export async function applyMotherTongueDecorations(
    editor: vscode.TextEditor,
    vocabulary: Vocabulary
) {
    // 检查是否启用了母语显示
    const config = vscode.workspace.getConfiguration('codeLocalizerDemo');
    const enableDisplay = config.get<boolean>('enableMotherTongueDisplay', true);
    
    if (!enableDisplay) {
        console.log(`[CodeLocalizer] 母语显示当前已禁用，不应用装饰`);
        return;
    }
    
    // 清除该编辑器的现有装饰
    clearDocumentDecorations(editor.document.uri.toString());
    
    if (!editor || !vocabulary || !vocabulary.entries) {
        console.log(`[CodeLocalizer] 无法应用装饰: 编辑器或词汇表无效`);
        return;
    }
    
    const document = editor.document;
    const text = document.getText();
    
    // 新增：记录文件类型
    console.log(`[CodeLocalizer] 开始为文件应用母语装饰: ${document.fileName}，类型: ${document.languageId}`);
    
    // 创建一个新的装饰类型
    const decorationType = vscode.window.createTextEditorDecorationType({
        // 完全隐藏原始文本，包括其字符间的间隔
        color: 'transparent', // 原始文本透明
        textDecoration: 'none; position: relative; z-index: 1;',
        // 确保字符的间距也被透明化
        letterSpacing: '0px',
        // 使用这个属性可以完全隐藏原始文本
        opacity: '0', 
        // 确保不改变原有元素的大小和排列
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    
    activeDecorations.push(decorationType);
    
    // 存储所有将要应用的装饰
    const decorationsArray: vscode.DecorationOptions[] = [];
    
    // 记录已处理的位置，避免重复装饰
    const processedPositions = new Set<string>();
    
    // 性能优化：先过滤有效的词汇表条目再进行文档操作
    const validEntries = vocabulary.entries.filter(entry => 
        entry && entry.original && entry.translated && entry.original !== entry.translated
    );
    
    console.log(`[CodeLocalizer] 当前词汇表包含 ${vocabulary.entries.length} 条，过滤后有 ${validEntries.length} 条有效条目`);
    
    // 第一步：应用词汇表中的精确匹配项
    for (const entry of validEntries) {
        try {
            const originalWord = entry.original;
            const entryTranslated = entry.translated;
            
            // 增加验证，确保翻译符合字母数量匹配规则
            const translatedWord = validateTranslationMatch(originalWord, entryTranslated);
            
            // 如果验证失败，跳过此条目
            if (!translatedWord) {
                continue;
            }
            
            // 检查是否是文件路径或URL链接
            if (isPathOrUrl(originalWord)) {
                continue; // 跳过路径或链接
            }
            
            // 创建一个正则表达式来匹配整个单词
            // 修改正则表达式，使其同时匹配独立标识符和属性/方法名
            // 添加对点后属性的支持，如obj.property，确保精确全词匹配
            const escapedWord = escapeRegExp(originalWord);
            const wordBoundary = '\\b';
            // 关键修改：使正则表达式大小写不敏感
            const regex = new RegExp(`(${wordBoundary}${escapedWord}${wordBoundary}|(?<=\\.)${escapedWord}${wordBoundary})`, 'gi');
            let match;
            
            // 查找文档中所有匹配项
            while ((match = regex.exec(text)) !== null) {
                const matchedText = match[0];
                
                // 确保完全匹配（考虑大小写），避免部分匹配
                if (matchedText.toLowerCase() !== originalWord.toLowerCase()) {
                    continue;
                }
                
                const startPos = document.positionAt(match.index);
                const endPos = document.positionAt(match.index + matchedText.length);
                
                // 检查是否在注释中，如果在注释中则跳过
                if (isInComment(document, startPos)) {
                    continue;
                }
                
                // 获取匹配到的文本的上下文，以检查是否是路径的一部分
                const lineText = document.lineAt(startPos.line).text;
                const beforeText = lineText.substring(0, startPos.character);
                const afterText = lineText.substring(endPos.character);
                
                // 如果匹配词是更大路径/URL的一部分，则跳过
                if (
                    // 检查前面的文本是否包含路径相关字符
                    /[\/\\]$/.test(beforeText) || 
                    // 检查后面的文本是否包含路径相关字符
                    /^[\/\\]/.test(afterText) ||
                    // 检查整行是否看起来像是导入语句或路径定义
                    /(?:import|require|from|path|src|href|url)\s*[:=(\s]\s*['"]/.test(lineText)
                ) {
                    continue;
                }
                
                const range = new vscode.Range(startPos, endPos);
                
                // 生成唯一的位置标识
                const positionKey = `${startPos.line}:${startPos.character}:${endPos.line}:${endPos.character}`;
                
                // 检查这个位置是否已经处理过
                if (processedPositions.has(positionKey)) {
                    continue;
                }
                
                // 记录这个位置已被处理
                processedPositions.add(positionKey);
                
                // 获取适合该关键字的颜色
                const syntaxColor = getSyntaxColor(originalWord, document, startPos);
                
                // 格式化翻译后的文本
                const formattedTranslation = formatTranslatedIdentifier(translatedWord, originalWord);
                
                // 计算适当的覆盖偏移量，处理不同字符宽度的情况
                const marginOffset = calculateMarginOffset(originalWord, translatedWord);
                
                // 创建装饰选项
                const decoration: vscode.DecorationOptions = {
                    range,
                    renderOptions: {
                        after: {
                            contentText: formattedTranslation,
                            color: syntaxColor,
                            // 使用计算的margin确保精确覆盖原始文本
                            margin: marginOffset,
                            // 保证足够高的z-index覆盖原始文本
                            textDecoration: 'none; position: relative; z-index: 10; white-space: pre;'
                        },
                        light: {
                            after: {
                                color: syntaxColor
                            }
                        },
                        dark: {
                            after: {
                                color: syntaxColor
                            }
                        },
                    },
                    hoverMessage: new vscode.MarkdownString(`**原始标识符**: \`${originalWord}\`\n\n**母语翻译**: ${formattedTranslation}`)
                };
                
                decorationsArray.push(decoration);
            }
        } catch (error) {
            console.error(`[CodeLocalizer] 处理标识符 "${entry.original}" 出错:`, error);
        }
    }
    
    // 第二步：查找和处理复合标识符（包含下划线或驼峰命名）
    try {
        // 匹配标识符模式，包括下划线分隔的和驼峰命名的标识符
        // 使用更精确的标识符匹配，确保只匹配完整的标识符
        // 修改：使用更通用的标识符匹配模式，适用于更多类型的文件
        // 原来的正则表达式: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g  <- 这行注释是旧的，实际旧代码更复杂
        // 新的正则表达式同时支持英文词组、驼峰命名、下划线分隔等多种形式
        // const identifierRegex = /\b[a-zA-Z][\w-]*\b|[A-Z][a-z]+(?:[A-Z][a-z]+)*|\b[a-zA-Z]+\b/g; // 这是导致问题的旧版正则表达式
        const identifierRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g; // <--- 修改后的正则表达式
        let match: RegExpExecArray | null;
        
        while ((match = identifierRegex.exec(text)) !== null) {
            const originalWord = match[0];
            
            // 略微放宽短标识符的限制，但仍跳过过短的单词
            if (originalWord.length < 2) {
                continue;
            }
            
            // 检查是否是文件路径或URL链接
            if (isPathOrUrl(originalWord)) {
                continue; // 跳过路径或链接
            }
            
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + originalWord.length);
            
            // 检查是否在注释中，如果在注释中则跳过
            if (isInComment(document, startPos)) {
                continue;
            }
            
            // 获取匹配到的文本的上下文，以检查是否是路径的一部分
            const lineText = document.lineAt(startPos.line).text;
            const beforeText = lineText.substring(0, startPos.character);
            const afterText = lineText.substring(endPos.character);
            
            // 如果匹配词是更大路径/URL的一部分，则跳过
            if (
                // 检查前面的文本是否包含路径相关字符
                /[\/\\]$/.test(beforeText) || 
                // 检查后面的文本是否包含路径相关字符
                /^[\/\\]/.test(afterText) ||
                // 检查整行是否看起来像是导入语句或路径定义
                /(?:import|require|from|path|src|href|url)\s*[:=(\s]\s*['"]/.test(lineText)
            ) {
                continue;
            }
            
            // 直接跳过常见的明确是颜色的短代码
            const commonColors = ['FFF', 'fff', 'CCC', 'ccc', 'EEE', 'eee', 'AAA', 'aaa', 
                                 'DDD', 'ddd', 'BBB', 'bbb', 'ECF', 'ecf', 'FCF', 'fcf',
                                 'cccccc', 'CCCCCC', 'ffffff', 'FFFFFF', 'FF3B30', 'ff3b30',
                                 'E8E93', 'e8e93', 'aaaaaa', 'AAAAAA'];
            
            if (commonColors.includes(originalWord)) {
                continue;
            }
            
            // 特别处理：直接检查是否是十六进制颜色格式（不带#），优先级高
            if (/^[0-9a-fA-F]{3}$/.test(originalWord) || 
                /^[0-9a-fA-F]{6}$/.test(originalWord) || 
                /^[0-9a-fA-F]{8}$/.test(originalWord)) {
                // 明确是十六进制颜色，直接跳过
                continue;
            }
            
            // 检查非标准长度但可能是颜色代码的值
            if (/^[0-9a-fA-F]{2,8}$/.test(originalWord) && /[a-fA-F]/.test(originalWord)) {
                continue;
            }
            
            // 再检查其他不应翻译的技术值（不包括CSS关键字）
            if (isTechnicalValue(originalWord)) {
                continue;
            }
            
            // 确保某些单词即使看起来像颜色代码也被允许提取
            const importantWords = ['take', 'code', 'face', 'add'];
            if (importantWords.includes(originalWord.toLowerCase())) {
                // 不跳过这些重要单词
            }
            
            // 生成唯一的位置标识
            const positionKey = `${startPos.line}:${startPos.character}:${endPos.line}:${endPos.character}`;
            
            // 检查这个位置是否已经处理过
            if (processedPositions.has(positionKey)) {
                continue;
            }
            
            // 处理复合标识符 - 放宽条件，允许更多类型的标识符被翻译
            // 不再严格要求必须包含下划线或驼峰式命名
            const possibleTranslation = handleCompoundIdentifier(originalWord, vocabulary) || 
                                       findTranslationIgnoreCase(vocabulary, originalWord);
            
            // 增加验证，确保翻译符合字母数量匹配规则
            const translatedWord = validateTranslationMatch(originalWord, possibleTranslation);
            
            if (translatedWord && translatedWord !== originalWord) {
                const range = new vscode.Range(startPos, endPos);
                
                // 记录这个位置已被处理
                processedPositions.add(positionKey);
                
                // 格式化翻译后的文本
                const formattedTranslation = formatTranslatedIdentifier(translatedWord, originalWord);
                
                // 计算适当的覆盖偏移量
                const marginOffset = calculateMarginOffset(originalWord, translatedWord);
                
                // 创建装饰选项
                const decoration: vscode.DecorationOptions = {
                    range,
                    renderOptions: {
                        after: {
                            contentText: formattedTranslation,
                            // 获取适合该关键字的颜色，如果没有特定颜色则使用默认文本颜色
                            color: getSyntaxColor(originalWord, document, startPos),
                            // 使用计算的margin确保精确覆盖原始文本
                            margin: marginOffset,
                            // 保证足够高的z-index覆盖原始文本
                            textDecoration: 'none; position: relative; z-index: 10; white-space: pre;'
                        },
                        light: {
                            after: {
                                // 使用相同的颜色逻辑
                                color: getSyntaxColor(originalWord, document, startPos)
                            }
                        },
                        dark: {
                            after: {
                                // 使用相同的颜色逻辑
                                color: getSyntaxColor(originalWord, document, startPos)
                            }
                        },
                    },
                    hoverMessage: new vscode.MarkdownString(`**原始复合标识符**: \`${originalWord}\`\n\n**母语翻译**: ${formattedTranslation}`)
                };
                
                decorationsArray.push(decoration);
            }
        }
    } catch (error) {
        console.error(`[CodeLocalizer] 处理复合标识符出错:`, error);
    }
    
    // 应用所有装饰
    if (decorationsArray.length > 0) {
        decorationRanges.set(editor.document.uri.toString(), decorationsArray);
        editor.setDecorations(decorationType, decorationsArray);
        console.log(`[CodeLocalizer] 应用了 ${decorationsArray.length} 个母语装饰，处理了 ${processedPositions.size} 个词条`);
    } else {
        console.log(`[CodeLocalizer] 未找到可替换的标识符`);
    }
}

/**
 * 清除特定文档的装饰
 */
function clearDocumentDecorations(documentUri: string) {
    // 清除特定文档的现有装饰
    const decorations = decorationRanges.get(documentUri);
    if (decorations) {
        vscode.window.visibleTextEditors.forEach(editor => {
            if (editor.document.uri.toString() === documentUri) {
                activeDecorations.forEach(decoration => {
                    editor.setDecorations(decoration, []);
                });
            }
        });
    }
}

/**
 * 转义正则表达式中的特殊字符
 */
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 刷新所有编辑器的装饰，确保不更新临时词汇表
 * 此函数只负责刷新装饰，不会触发提取逻辑
 */
export function refreshAllDecorations(vocabulary: Vocabulary) {
    console.log(`[CodeLocalizer] 开始刷新所有编辑器的母语装饰，词汇表有 ${vocabulary.entries.length} 条条目`);
    
    // 先检查装饰是否启用
    const config = vscode.workspace.getConfiguration('codeLocalizerDemo');
    const enableDisplay = config.get<boolean>('enableMotherTongueDisplay', true);
    
    if (!enableDisplay) {
        console.log(`[CodeLocalizer] 母语显示当前已禁用，不刷新装饰`);
        return;
    }
    
    // 然后才应用到所有编辑器
    vscode.window.visibleTextEditors.forEach(editor => {
        applyMotherTongueDecorations(editor, vocabulary);
    });
}

// 添加新的计算margin偏移量的函数
/**
 * 计算装饰器的margin偏移量，考虑字符宽度差异
 * @param originalWord 原始单词
 * @param translatedWord 翻译后的单词
 * @returns 适合的margin值
 */
function calculateMarginOffset(originalWord: string, translatedWord: string | undefined): string {
    // 如果翻译为空，使用原始单词
    if (!translatedWord) {
        translatedWord = originalWord;
    }
    
    // 基础偏移量，使翻译文本覆盖原始文本
    const baseOffset = originalWord.length;
    
    // 处理特殊情况：中文字符和非ASCII字符可能需要特殊处理
    const containsWideChars = /[\u4e00-\u9fa5\uff01-\uff5e]/.test(translatedWord);
    const containsSpecialChars = /[^\x00-\x7F]/.test(translatedWord);
    
    // 优化：为多字节字符提供更精确的宽度计算
    if (containsWideChars || containsSpecialChars) {
        // 对于包含中文等双宽度字符的情况，计算实际视觉宽度
        const visualWidth = calculateVisualWidth(translatedWord);
        
        // 确保偏移量足够覆盖原始文本
        const effectiveOffset = Math.max(baseOffset, visualWidth);
        return `0 0 0 -${baseOffset}ch`;
    }
    
    // 标准情况
    return `0 0 0 -${baseOffset}ch`;
}

/**
 * 计算字符串的视觉宽度，考虑到中文和其他宽字符
 * @param text 要计算宽度的文本
 * @returns 估计的视觉宽度
 */
function calculateVisualWidth(text: string): number {
    let width = 0;
    
    for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        // 中文字符、全角符号等通常占用两个字符宽度
        if (/[\u4e00-\u9fa5\uff01-\uff5e]/.test(char)) {
            width += 2;
        } else {
            width += 1;
        }
    }
    
    return width;
}

/**
 * 格式化翻译后的标识符，使其更符合母语习惯
 * @param translatedWord 翻译后的单词
 * @param originalWord 原始单词
 * @returns 格式化后的翻译文本
 */
function formatTranslatedIdentifier(translatedWord: string | undefined, originalWord: string): string {
    // 如果翻译为空，返回原始单词
    if (!translatedWord) {
        return originalWord;
    }
    
    // 移除多余的空格
    let formatted = translatedWord.trim();
    
    // 如果是中文翻译，去除中文之间的空格
    formatted = formatted.replace(/([^\x00-\x7F])\s+([^\x00-\x7F])/g, '$1$2');
    
    // 保持原始标识符的大小写风格
    if (originalWord === originalWord.toUpperCase()) {
        // 全大写
        formatted = formatted.toUpperCase();
    } else if (originalWord[0] === originalWord[0].toUpperCase()) {
        // 首字母大写
        formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    }
    
    return formatted;
}