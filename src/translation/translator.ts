// 翻译器模块，处理LLM翻译逻辑
import * as vscode from 'vscode';
import { TranslationRequest, TranslationResponse, VocabularyEntryType, TranslationQuality } from '../types';
import * as util from 'util';
import * as child_process from 'child_process';
import * as http from 'http'; // 用于Ollama API
import * as https from 'https'; // 支持HTTPS

const exec = util.promisify(child_process.exec);

// 翻译缓存，用于减少重复调用LLM的次数
const translationCache: Map<string, string> = new Map();

// --- Simulation Functions (defined first) ---
function simulateTranslateItem(item: string, isIdentifier: boolean): string {
    if (isIdentifier) {
        // 创建一个映射，只在全词匹配时进行替换
        const wordMap: Record<string, string> = {
            'file': '文件',
            'path': '路径',
            'content': '内容',
            'analyze': '分析',
            'data': '数据',
            'name': '名称',
            'value': '值',
            'type': '类型',
            'use': '使用'
        };
        
        // 检查是否进行全词匹配（使用正则表达式的\b边界匹配）
        for (const [eng, chn] of Object.entries(wordMap)) {
            // 创建一个正则表达式用于全词匹配
            const regex = new RegExp(`\\b${eng}\\b`, 'i');
            if (regex.test(item)) {
                return item.replace(new RegExp(`\\b${eng}\\b`, 'g'), chn);
            }
        }
        
        // 如果没有匹配项，返回原始标识符
        return `${item}`;
    } else {
        return `${item} (已翻译)`;
    }
}

function simulateTranslationBatch(items: string[], isIdentifier: boolean): { original: string, translated: string }[] {
    console.log(`[CodeLocalizer] 使用模拟翻译处理 ${items.length} 个项目。`);
    return items.map(item => ({
        original: item,
        translated: simulateTranslateItem(item, isIdentifier)
    }));
}

export function simulateTranslation(request: TranslationRequest): TranslationResponse {
    const isIdentifier = request.type === 'identifier';
    const translations = request.items.map(item => {
        return {
            original: item,
            translated: simulateTranslateItem(item, isIdentifier)
        };
    });
        return { translations };
}

// --- Translation Batch Functions ---
async function translateBatchWithCli(
    items: string[], 
    isIdentifier: boolean, 
    llmPath: string, 
    llmParams?: string
): Promise<{original: string, translated: string}[]> {
    // 检查缓存中是否已有部分项目的翻译
    const itemsNeedTranslation: string[] = [];
    const cachedTranslations: {original: string, translated: string}[] = [];
    
    // 先从缓存中查找已有翻译
    for (const item of items) {
        const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${item}`;
        if (translationCache.has(cacheKey)) {
            cachedTranslations.push({
                original: item,
                translated: translationCache.get(cacheKey)!
            });
            console.log(`[CodeLocalizer] 缓存命中: ${item} -> ${translationCache.get(cacheKey)}`);
        } else {
            itemsNeedTranslation.push(item);
        }
    }
    
    // 如果所有项目都在缓存中找到，则直接返回缓存结果
    if (itemsNeedTranslation.length === 0) {
        console.log(`[CodeLocalizer] 所有项目(${items.length}个)均从缓存中获取翻译`);
        return cachedTranslations;
    }
    
    console.log(`[CodeLocalizer CLI] 翻译批次，项数: ${itemsNeedTranslation.length}，缓存命中: ${cachedTranslations.length}`);

    let prompt = isIdentifier 
        ? `将以下编程标识符翻译为中文，保持专业性且简洁。给每个标识符一个恰当的中文名称，不要加任何解释，直接用JSON格式返回原始标识符和对应的中文翻译。\n\n标识符: ${itemsNeedTranslation.join(', ')}\n\n以JSON格式返回，格式为: {"translations": [{"original": "标识符", "translated": "翻译"}]}`
        : `将以下编程注释翻译为中文，保持专业性。\n\n注释: ${itemsNeedTranslation.join('\n')}\n\n以JSON格式返回，格式为: {"translations": [{"original": "原注释", "translated": "翻译后的注释"}]}`;
    
    try {
        const escapedPrompt = prompt.replace(/"/g, '\\"'); 
        const cmd = `"${llmPath}" ${llmParams || ''} "${escapedPrompt}"`;

        console.log(`[CodeLocalizer CLI] 执行LLM命令 (first 100 chars): ${cmd.substring(0, 100)}...`);
        const { stdout, stderr } = await exec(cmd, { timeout: 30000 });
        
        if (stderr) {
            console.error(`[CodeLocalizer CLI] LLM stderr: \n--- STDERR START ---\n${stderr}\n--- STDERR END ---`);
        }
        
        if (stdout) {
            console.log(`[CodeLocalizer CLI] LLM原始输出 (stdout) (first 200 chars): \n--- STDOUT START ---\n${stdout.substring(0,200)}\n--- STDOUT END ---`);
            const jsonMatch = stdout.match(/({[\s\S]*})/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    const result = JSON.parse(jsonMatch[1]);
                    if (result.translations && Array.isArray(result.translations)) {
                        console.log(`[CodeLocalizer CLI] 成功解析LLM输出，获得${result.translations.length}个翻译`);
                        
                        // 更新缓存
                        for (const translation of result.translations) {
                            const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${translation.original}`;
                            translationCache.set(cacheKey, translation.translated);
                        }
                        
                        // 合并缓存结果和新翻译结果
                        return [...cachedTranslations, ...result.translations];
                    } else {
                        throw new Error('LLM CLI 输出格式不正确，缺少translations数组');
                    }
                } catch (parseError) {
                    console.error(`[CodeLocalizer CLI] 解析LLM CLI 输出JSON出错:`, parseError);
                    return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
                }
            } else {
                console.error(`[CodeLocalizer CLI] 无法从LLM CLI 输出中提取JSON`);
                return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
            }
        } else {
            console.error(`[CodeLocalizer CLI] LLM CLI 没有输出`);
            return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
        }
    } catch (execError) {
        console.error(`[CodeLocalizer CLI] 执行LLM CLI 命令出错:`, execError);
        return [...cachedTranslations, ...simulateTranslationBatch(itemsNeedTranslation, isIdentifier)];
    }
}

// 从Ollama获取可用模型列表
export async function getOllamaModels(ollamaApiUrl: string = 'http://localhost:11434'): Promise<string[]> {
    try {
        const apiUrlObj = new URL(ollamaApiUrl);
        const protocol = apiUrlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: apiUrlObj.hostname,
            port: apiUrlObj.port || (apiUrlObj.protocol === 'https:' ? 443 : 80),
            path: '/api/tags',
            method: 'GET'
        };

        return new Promise((resolve) => {
            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const response = JSON.parse(data);
                            if (response.models && Array.isArray(response.models)) {
                                const modelNames = response.models.map((model: any) => model.name);
                                console.log(`[CodeLocalizer] 从Ollama获取到${modelNames.length}个模型: ${modelNames.join(', ')}`);
                                resolve(modelNames);
                                return;
                            }
                        } catch (parseError) {
                            console.error('[CodeLocalizer] 解析Ollama模型列表出错:', parseError);
                        }
                    } else {
                        console.error(`[CodeLocalizer] 获取Ollama模型列表失败，状态码: ${res.statusCode}`);
                    }
                    resolve([]); // 出错时返回空数组
                });
            });
            
            req.on('error', (e) => {
                console.error(`[CodeLocalizer] 请求Ollama模型列表出错:`, e);
                resolve([]);
            });
            
            req.end();
        });
    } catch (error) {
        console.error(`[CodeLocalizer] 获取Ollama模型列表时发生错误:`, error);
        return [];
    }
}

// 计算最优批量大小，根据条目类型和长度进行自适应调整
function calculateOptimalBatchSize(items: string[], type: VocabularyEntryType): number {
    if (items.length <= 5) {
        return items.length; // 对于少量条目，直接处理全部
    }

    // 计算平均长度
    const avgLength = items.reduce((sum, item) => sum + item.length, 0) / items.length;
    
    // 根据条目类型和长度特征决定批量大小
    if (type === 'identifier') {
        // 标识符通常较短，可以批量处理更多
        if (avgLength < 10) {
            return Math.min(40, items.length); // 短标识符
        } else if (avgLength < 20) {
            return Math.min(30, items.length); // 中等长度标识符
        } else {
            return Math.min(20, items.length); // 长标识符
        }
    } else {
        // 注释通常较长，需要更小的批量
        if (avgLength < 50) {
            return Math.min(15, items.length); // 短注释
        } else if (avgLength < 100) {
            return Math.min(8, items.length); // 中等长度注释
        } else {
            return Math.min(5, items.length); // 长注释
        }
    }
}

// 串行处理翻译批次，每个批次完成后可回调
async function processInSequence<T, R>(
    items: T[],
    getBatchSize: (remainingItems: T[]) => number,
    processFn: (batch: T[]) => Promise<R[]>,
    progressCallback?: (completed: number, total: number, batchResults: R[]) => void
): Promise<R[]> {
    const results: R[] = [];
    let completed = 0;
    const total = items.length;
    
    // 串行处理批次，动态调整批次大小
    let remainingItems = [...items];
    
    while (remainingItems.length > 0) {
        // 动态计算下一批次的大小
        const batchSize = getBatchSize(remainingItems);
        const batch = remainingItems.slice(0, batchSize);
        remainingItems = remainingItems.slice(batchSize);
        
        try {
            // 处理当前批次
            const batchResults = await processFn(batch);
            results.push(...batchResults);
            completed += batch.length;
            
            // 进度回调
            if (progressCallback) {
                progressCallback(completed, total, batchResults);
            }
        } catch (error) {
            console.error('[CodeLocalizer] 批次处理失败:', error);
            // 出错时，可能需要减小批次大小重试，这里简化处理
            if (batch.length > 1) {
                // 将失败的批次重新放回队列，但用更小的批次尝试
                remainingItems = [...batch.slice(1), ...remainingItems];
                
                // 当前批次的第一个元素单独处理
                try {
                    const singleResult = await processFn([batch[0]]);
                    results.push(...singleResult);
                    completed += 1;
                    
                    if (progressCallback) {
                        progressCallback(completed, total, singleResult);
                    }
                } catch (innerError) {
                    console.error('[CodeLocalizer] 单条目处理失败:', innerError);
                    // 即使单个条目也失败了，增加计数以避免无限循环
                    completed += 1;
                }
            } else {
                // 单条目处理失败，计数增加避免无限循环
                completed += batch.length;
            }
        }
    }
    
    return results;
}

// 评估翻译质量
function evaluateTranslationQuality(originals: string[], translations: {original: string, translated: string}[]): {
    genuinelyTranslatedCount: number,
    qualityScore: number,
    issues: {original: string, translated: string, issue: string}[]
} {
    let genuinelyTranslatedCount = 0;
    const issues: {original: string, translated: string, issue: string}[] = [];
    
    // 翻译集合映射，便于查找
    const translationMap = new Map<string, string>();
    translations.forEach(t => translationMap.set(t.original, t.translated));
    
    // 检查每个原始条目
    for (const original of originals) {
        const translated = translationMap.get(original);
        
        // 检查是否缺失
        if (!translated) {
            issues.push({
                original,
                translated: original, // 默认使用原文
                issue: '未被翻译'
            });
            continue;
        }
        
        // 检查是否有效翻译（不同于原文）
        if (translated !== original) {
            genuinelyTranslatedCount++;
            
            // 进行简单的质量检查
            if (translated.length < original.length * 0.5 && original.length > 10) {
                issues.push({
                    original,
                    translated,
                    issue: '疑似翻译不完整'
                });
            } else if (/^[a-zA-Z0-9_\s]+$/.test(translated) && original.length > 5) {
                issues.push({
                    original,
                    translated,
                    issue: '疑似未翻译成目标语言'
                });
            }
        } else {
            // 与原文相同，不算有效翻译
            issues.push({
                original,
                translated,
                issue: '译文与原文相同'
            });
        }
    }
    
    // 计算整体质量分数 (0-1)
    const qualityScore = genuinelyTranslatedCount / originals.length;
    
    return {
        genuinelyTranslatedCount,
        qualityScore,
        issues
    };
}

// 简化的提示词模板
function getSimplePromptForOllama(
    items: string[],
    isIdentifier: boolean,
    targetLanguage: string
): { system: string, userPrompt: string } {
    const languageName = getLanguageName(targetLanguage);
    
    // 简化的系统提示
    const systemPrompt = isIdentifier 
        ? `请将以下编程代码中的标识符翻译成${languageName}，保持专业性和简洁性。返回JSON格式，键为原标识符，值为翻译。`
        : `请将以下编程代码中的注释翻译成${languageName}，保持专业性和准确性。返回JSON格式，键为原注释，值为翻译。`;
    
    // 简化的用户提示
    const userPrompt = `以下是需要翻译的${isIdentifier ? '标识符' : '注释'}:\n` + 
                      items.map(item => `- "${item.replace(/"/g, '\\"')}"`).join('\n') + 
                      '\n\n请直接返回JSON格式的翻译结果，不要有其他内容。';
    
    return { system: systemPrompt, userPrompt };
}

// --- Main Exported Function ---
export async function translateWithLocalLLM(request: TranslationRequest): Promise<TranslationResponse> {
    try {
        const startTime = Date.now();
        const config = vscode.workspace.getConfiguration('codeLocalizerDemo');
        const provider = config.get<string>('translationService.provider', 'ollamaApi'); // 默认使用Ollama
        const targetLanguage = config.get<string>('targetLanguage', 'zh-CN');
    const isIdentifier = request.type === 'identifier';
        
        // 无需翻译的情况
        if (request.items.length === 0) {
            return { translations: [] };
        }
        
        // 提取已缓存的条目
        const itemsNeedTranslation: string[] = [];
        const cachedTranslations: {original: string, translated: string}[] = [];
        
        for (const item of request.items) {
            const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${item}-${targetLanguage}`;
            if (translationCache.has(cacheKey)) {
                cachedTranslations.push({
                    original: item,
                    translated: translationCache.get(cacheKey)!
                });
            } else {
                itemsNeedTranslation.push(item);
            }
        }
        
        // 所有条目均已缓存
        if (itemsNeedTranslation.length === 0) {
            return { translations: cachedTranslations };
        }
        
        // 设置进度通知
        let translations: {original: string, translated: string}[] = [...cachedTranslations];
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `正在翻译${isIdentifier ? '标识符' : '注释'}`,
            cancellable: true  // 允许用户取消
        }, async (progress, token) => {
            progress.report({ message: `正在准备翻译 ${itemsNeedTranslation.length} 项内容...` });
            
            if (provider === 'ollamaApi') {
                const ollamaModelName = config.get<string>('translationService.ollamaModelName', '');
                const ollamaApiUrl = config.get<string>('translationService.ollamaApiUrl', 'http://localhost:11434');
                
                if (!ollamaModelName || ollamaModelName.trim() === '') {
                    vscode.window.showErrorMessage('未设置Ollama模型名称。请运行"配置本地LLM设置"命令选择模型。');
                    return;
                }
                
                // 创建取消令牌监听
                token.onCancellationRequested(() => {
                    console.log('[CodeLocalizer] 用户取消了翻译操作');
                    vscode.window.showInformationMessage('翻译操作已取消。已完成的部分将被保留。');
                });
                
                // 使用串行处理翻译批次
                const batchResults = await processInSequence(
                    itemsNeedTranslation,
                    (remainingItems) => calculateOptimalBatchSize(remainingItems, request.type),
                    async (batch) => {
                        // 检查是否已取消
                        if (token.isCancellationRequested) {
                            return [];
                        }
                        
                        return await translateBatchWithOllamaApi(
                            batch,
                            isIdentifier,
                            ollamaApiUrl,
                            ollamaModelName,
                            targetLanguage
                        );
                    },
                    (completed, total, batchResults) => {
                        // 进度更新回调
                        const percentage = Math.round((completed / total) * 100);
                        progress.report({ 
                            message: `已完成 ${completed}/${total} 项 (${percentage}%)`
                        });
                        
                        // 更新总翻译结果
                        translations = [...translations, ...batchResults];
                    }
                );
                
                // 串行处理完成后，已经将所有结果添加到translations中
            } else { // localCommand提供者
                const llmPath = config.get<string>('localLLMPath');
                const llmParams = config.get<string>('localLLMParams');
                
                if (!llmPath || llmPath.trim() === '') {
                    console.log(`[CodeLocalizer] LLM路径未配置 (localCommand)，使用模拟翻译`);
                    return;
                }
                
                // 使用串行处理翻译批次
                const batchResults = await processInSequence(
                    itemsNeedTranslation,
                    (remainingItems) => calculateOptimalBatchSize(remainingItems, request.type),
                    async (batch) => {
                        // 检查是否已取消
                        if (token.isCancellationRequested) {
                            return [];
                        }
                        
                        return await translateBatchWithCli(
                            batch,
                            isIdentifier,
                            llmPath,
                            llmParams
                        );
                    },
                    (completed, total, batchResults) => {
                        // 进度更新回调
                        const percentage = Math.round((completed / total) * 100);
                        progress.report({ 
                            message: `已完成 ${completed}/${total} 项 (${percentage}%)`
                        });
                        
                        // 更新总翻译结果
                        translations = [...translations, ...batchResults];
                    }
                );
            }
            
            progress.report({ message: `翻译完成！共 ${translations.length} 项` });
        });
        
        // 评估翻译质量
        const quality = evaluateTranslationQuality(request.items, translations);
        
        // 如果翻译质量过低，记录警告信息
        if (quality.qualityScore < 0.3 && request.items.length >= 5) {
            console.warn(`[CodeLocalizer] 翻译质量较低: ${quality.qualityScore.toFixed(2)}，共 ${quality.issues.length} 个问题`);
            // 不在这里阻止返回结果，让上层调用者决定是否使用结果
        }
        
        console.log(`[CodeLocalizer] 翻译完成，耗时: ${(Date.now() - startTime)}ms，项目数: ${request.items.length}`);
        return {
            translations,
            quality: {
                score: quality.qualityScore,
                genuinelyTranslatedCount: quality.genuinelyTranslatedCount,
                totalCount: request.items.length,
                issues: quality.issues
            }
        };
    } catch (error) {
        console.error(`[CodeLocalizer] LLM翻译错误 (translateWithLocalLLM):`, error);
        return simulateTranslation(request);
    }
}

// Ollama批次翻译函数
async function translateBatchWithOllamaApi(
    items: string[],
    isIdentifier: boolean,
    ollamaApiUrl: string,
    ollamaModelName: string,
    targetLanguage: string = 'zh-CN'
): Promise<{original: string, translated: string}[]> {
    // 检查缓存中是否已有部分项目的翻译
    const itemsNeedTranslation: string[] = [];
    const cachedTranslations: {original: string, translated: string}[] = [];
    
    // 先从缓存中查找已有翻译
    for (const item of items) {
        const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${item}-${targetLanguage}`;
        if (translationCache.has(cacheKey)) {
            cachedTranslations.push({
                original: item,
                translated: translationCache.get(cacheKey)!
            });
        } else {
            itemsNeedTranslation.push(item);
        }
    }
    
    // 如果所有项目都在缓存中找到，则直接返回缓存结果
    if (itemsNeedTranslation.length === 0) {
        return cachedTranslations;
    }
    
    console.log(`[CodeLocalizer Ollama] 翻译批次，待翻译项数: ${itemsNeedTranslation.length}，缓存命中项数: ${cachedTranslations.length}`);

    // 获取简化的提示词
    const { system: systemPrompt, userPrompt } = getSimplePromptForOllama(
        itemsNeedTranslation,
        isIdentifier,
        targetLanguage
    );

    if (!ollamaModelName || ollamaModelName.trim() === '') {
        console.error(`[CodeLocalizer Ollama] 未设置Ollama模型名称`);
        // 返回原文，而不是模拟翻译，因为模拟翻译可能与用户期望不符
        const untranslatedItems = itemsNeedTranslation.map(original => ({ original, translated: original }));
        return [...cachedTranslations, ...untranslatedItems];
    }
    
    console.log(`[CodeLocalizer Ollama] 使用模型: ${ollamaModelName} 翻译 ${itemsNeedTranslation.length} 个新项目到 ${getLanguageName(targetLanguage)}`);

    const payload = {
        model: ollamaModelName,
        prompt: userPrompt,
        system: systemPrompt,
        format: "json", 
        stream: false,
        options: {
            temperature: 0.1, // 降低温度以提高一致性和准确性
            num_ctx: 4096     // 增加上下文窗口，允许更大的批量处理
        }
    };
    const payloadString = JSON.stringify(payload);

    try {
        const apiUrlObj = new URL(ollamaApiUrl);
        const protocol = apiUrlObj.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: apiUrlObj.hostname,
            port: apiUrlObj.port || (apiUrlObj.protocol === 'https:' ? 443 : 80),
            path: '/api/generate', //  Ollama API endpoint
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadString)
            },
            timeout: 120000 // 增加超时时间到2分钟，适应较大批量
        };

        return new Promise<{original: string, translated: string}[]>((resolve) => { 
            const req = protocol.request(options, (res) => {
                let responseBody = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { responseBody += chunk; });
                res.on('end', () => {
                    console.log(`[CodeLocalizer Ollama] API响应状态码: ${res.statusCode}`);
                    const finalResults: {original: string, translated: string}[] = [...cachedTranslations];

                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const ollamaResponse = JSON.parse(responseBody);
                            const llmJsonOutputString = ollamaResponse.response || responseBody; 

                            if (llmJsonOutputString) {
                                try {
                                    const translationsFromLLM = JSON.parse(llmJsonOutputString);
                                    let genuinelyTranslatedCount = 0;

                                    itemsNeedTranslation.forEach(original => {
                                        const translatedText = translationsFromLLM[original];
                                        if (typeof translatedText === 'string' && translatedText.trim() !== '') {
                                            finalResults.push({ original, translated: translatedText });
                                            if (original !== translatedText) {
                                                genuinelyTranslatedCount++;
                                            }
                                            // 更新缓存
                                            const cacheKey = `${isIdentifier ? 'id' : 'cm'}-${original}-${targetLanguage}`;
                                            translationCache.set(cacheKey, translatedText);
                                        } else {
                                            // LLM未提供翻译或提供了空翻译，使用原文
                                            finalResults.push({ original, translated: original });
                                            console.warn(`[CodeLocalizer Ollama] 模型未对 "${original}" 提供有效翻译，使用原文。`);
                                        }
                                    });

                                    console.log(`[CodeLocalizer Ollama] 从LLM获得 ${Object.keys(translationsFromLLM).length} 个键值对，有效翻译 ${genuinelyTranslatedCount} / ${itemsNeedTranslation.length} 个新项目。`);

                                    // 动态调整质量阈值，根据批次大小
                                    const translationThreshold = itemsNeedTranslation.length <= 5 ? 0.3 : 
                                                                 itemsNeedTranslation.length <= 15 ? 0.4 : 0.5;
                                    const minimumItemsForThreshold = 5;

                                    if (itemsNeedTranslation.length >= minimumItemsForThreshold &&
                                        (genuinelyTranslatedCount / itemsNeedTranslation.length) < translationThreshold) {
                                        
                                        const msg = vscode.l10n.t(
                                            "LLM仅翻译了 {0} / {1} 个新条目 ({2}%). 翻译质量不佳。",
                                            genuinelyTranslatedCount,
                                            itemsNeedTranslation.length,
                                            Math.round((genuinelyTranslatedCount / itemsNeedTranslation.length) * 100)
                                        );
                                        console.warn(`[CodeLocalizer Ollama] ${msg}`);
                                        // 不再提前返回空数组，而是返回当前结果，让上层逻辑判断
                                    }
                                    
                                    resolve(finalResults);
                                    return;

                                } catch (innerParseError) {
                                    console.error('[CodeLocalizer Ollama] 解析LLM返回的JSON内容失败:', innerParseError, '\\nLLM JSON输出字符串:', llmJsonOutputString.substring(0, 500));
                                }
                            } else {
                                console.error('[CodeLocalizer Ollama] Ollama响应中缺少 "response" 字段或响应体为空。');
                            }
                        } catch (parseError) {
                            console.error('[CodeLocalizer Ollama] 解析Ollama API外层响应出错:', parseError, '\\n原始响应体:', responseBody.substring(0, 500));
                        }
    } else {
                        console.error(`[CodeLocalizer Ollama] Ollama API请求失败，状态码: ${res.statusCode}, 响应: ${responseBody.substring(0,500)}`);
                    }
                    
                    // 如果上述任何步骤失败，将未从缓存中获取的条目视为未翻译
                    console.warn('[CodeLocalizer Ollama] 因API错误或解析问题，未翻译的新项目将以原文填充。');
                    itemsNeedTranslation.forEach(original => {
                        if (!finalResults.find(fr => fr.original === original)) { // 确保不重复添加
                           finalResults.push({ original, translated: original });
                        }
                    });
                    resolve(finalResults);
                });
            });
            req.on('timeout', () => {
                req.destroy(); // 销毁请求
                console.error(`[CodeLocalizer Ollama] Ollama API请求超时 (${options.timeout}ms)`);
                vscode.window.showErrorMessage(vscode.l10n.t('Ollama API请求超时。请尝试减小翻译批量或检查Ollama服务状态。'));
                // 返回已缓存条目和未翻译条目（使用原文）
                const timeoutResults = [...cachedTranslations];
                itemsNeedTranslation.forEach(original => {
                    if (!timeoutResults.find(fr => fr.original === original)) {
                       timeoutResults.push({ original, translated: original });
                    }
                });
                resolve(timeoutResults);
            });
            req.on('error', (e) => {
                console.error(`[CodeLocalizer Ollama] Ollama API请求错误:`, e);
                 const errorResults = [...cachedTranslations];
                itemsNeedTranslation.forEach(original => {
                     if (!errorResults.find(fr => fr.original === original)) {
                       errorResults.push({ original, translated: original });
                    }
                });
                resolve(errorResults);
            });
            req.write(payloadString);
            req.end();
        });
    } catch (error) { 
        console.error(`[CodeLocalizer Ollama] 调用Ollama API时发生顶层错误:`, error);
        // 对于顶层错误，也返回包含原文的列表
        const topErrorResults = [...cachedTranslations];
        itemsNeedTranslation.forEach(original => {
            if (!topErrorResults.find(fr => fr.original === original)) {
                topErrorResults.push({ original, translated: original });
            }
        });
        return Promise.resolve(topErrorResults);
    }
}

// 获取语言名称
function getLanguageName(targetLanguage: string): string {
    const languageMap: {[key: string]: string} = {
        'zh-CN': '中文',
        'zh-TW': '繁体中文',
        'ja': '日语',
        'ko': '韩语',
        'ru': '俄语',
        'fr': '法语',
        'de': '德语', 
        'es': '西班牙语',
        'pt-BR': '葡萄牙语',
        'it': '意大利语',
        'tr': '土耳其语'
    };
    return languageMap[targetLanguage] || '中文';
} 