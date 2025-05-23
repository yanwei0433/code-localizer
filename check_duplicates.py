#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
词汇表重复检查工具
检查loc_core_vocabulary_zh-CN.json中是否存在重复的单词（基于original字段）
不区分大小写，进行全词匹配，将不重复的条目生成到一个新文件中
输出格式为每行一个词汇条目的JSON格式
"""

import json
import os
from datetime import datetime

def check_duplicates():
    """检查词汇表中的重复项并生成新的无重复词汇表（每行一个词汇条目）"""
    # 获取当前脚本所在目录
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 输入文件路径 (使用绝对路径)
    input_file = os.path.join(current_dir, "loc_core_vocabulary_zh-CN.json")
    
    # 输出文件路径（带时间戳以避免覆盖）
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = os.path.join(current_dir, f"loc_core_vocabulary_zh-CN_no_duplicates_{timestamp}.json")
    
    try:
        # 检查文件是否存在
        if not os.path.exists(input_file):
            print(f"错误: 找不到文件 '{input_file}'")
            print(f"当前工作目录: {os.getcwd()}")
            print(f"脚本所在目录: {current_dir}")
            print("请确保词汇表文件在正确的位置")
            return
            
        # 读取原始词汇表
        with open(input_file, 'r', encoding='utf-8') as f:
            vocabulary = json.load(f)
        
        # 提取所有条目
        entries = vocabulary["entries"]
        print(f"原始词汇表共有 {len(entries)} 个条目")
        
        # 用于跟踪已处理的单词（转为小写以实现不区分大小写）
        processed_words = set()
        
        # 用于存储不重复的条目
        unique_entries = []
        
        # 记录重复项
        duplicates = []
        
        # 处理每个条目
        for entry in entries:
            original_word = entry["original"]
            original_lower = original_word.lower()
            
            # 检查是否已存在（不区分大小写的全词匹配）
            if original_lower in processed_words:
                duplicates.append(original_word)
                continue
            
            # 如果不重复，则添加到新列表并记录
            unique_entries.append(entry)
            processed_words.add(original_lower)
        
        # 创建新的词汇表对象
        new_vocabulary = vocabulary.copy()
        new_vocabulary["entries"] = unique_entries
        
        # 保存到新文件，每行一个条目
        with open(output_file, 'w', encoding='utf-8') as f:
            # 先写入文件头部（不包含entries部分）
            header = {k: v for k, v in new_vocabulary.items() if k != "entries"}
            header_json = json.dumps(header, ensure_ascii=False)
            f.write(header_json[:-1] + ',\n')  # 去掉结尾的 }，加上逗号和换行
            
            # 写入"entries":[
            f.write('"entries": [\n')
            
            # 逐条写入词汇条目，每行一个
            for i, entry in enumerate(unique_entries):
                entry_json = json.dumps(entry, ensure_ascii=False)
                if i < len(unique_entries) - 1:
                    f.write('  ' + entry_json + ',\n')
                else:
                    f.write('  ' + entry_json + '\n')
            
            # 写入文件尾部
            f.write(']\n}')
        
        # 输出结果统计
        print(f"发现 {len(duplicates)} 个重复条目")
        print(f"新词汇表共有 {len(unique_entries)} 个条目")
        print(f"已保存到 {output_file}")
        
        # 如果有重复项，输出它们
        if duplicates:
            print("\n重复的单词列表：")
            for word in duplicates:
                print(f"- {word}")
    
    except Exception as e:
        print(f"处理过程中出错: {e}")
        # 打印更详细的错误信息
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_duplicates()