import os
import sys

def create_project_summary(project_dir="project"):
    """
    读取指定项目目录下的所有文件，并按预定格式输出其内容摘要。

    Args:
        project_dir (str): 要读取的项目目录的路径。

    Returns:
        str: 格式化后的包含所有文件内容和用户指令的字符串。
    """
    if not os.path.isdir(project_dir):
        print(f"错误：项目目录 '{project_dir}' 不存在。请先使用 change_applier.py 创建项目文件。", file=sys.stderr)
        sys.exit(1)

    file_blocks = []
    
    # 使用 os.walk 遍历目录和子目录，并对文件进行排序以保证顺序一致
    for root, _, files in sorted(os.walk(project_dir)):
        for filename in sorted(files):
            full_path = os.path.join(root, filename)
            # 获取相对于 project 目录的路径，并统一使用正斜杠
            relative_path = os.path.relpath(full_path, project_dir).replace('\\', '/')
            
            header = f"--- START OF FILE {relative_path} ---"
            
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                # 将文件头和内容组合成一个块
                file_blocks.append(f"{header}\n{content}")
            except Exception as e:
                print(f"警告：无法读取文件 {full_path}：{e}", file=sys.stderr)

    if not file_blocks:
        print(f"信息：目录 '{project_dir}' 中没有找到任何文件。", file=sys.stderr)
    
    # 用两个换行符（一个空行）连接所有文件块
    all_files_string = "\n\n".join(file_blocks)
    
    # --- 用户交互部分 ---
    print("\n请在下方输入您的需求，然后按回车键：")
    user_instruction = sys.stdin.readline().strip()
    
    # 组合最终的输出
    instruction_header = "---User Instruction---"
    final_output = f"{all_files_string}\n\n{instruction_header}\n{user_instruction}"
    
    return final_output

def main():
    """
    主函数
    """
    formatted_output = create_project_summary()
    
    # 打印最终整合好的内容
    print("\n\n--- [ 格式化输出结果 ] ---\nThese are the existing files in the app:")
    print(formatted_output)

if __name__ == "__main__":
    main()