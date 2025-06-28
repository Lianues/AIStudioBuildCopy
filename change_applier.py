
import os
import sys
import xml.etree.ElementTree as ET

def apply_changes_from_xml(xml_string, base_directory="project"):
    """
    解析XML字符串，并在指定的基目录下应用文件更改。

    Args:
        xml_string (str): 包含文件更改描述的XML内容字符串。
        base_directory (str): 所有文件操作的根目录。
    """
    # 首先，确保基目录存在
    try:
        os.makedirs(base_directory, exist_ok=True)
        print(f"基目录 '{base_directory}' 已确保存在。")
    except OSError as e:
        print(f"错误：无法创建基目录 '{base_directory}': {e}", file=sys.stderr)
        sys.exit(1)
        
    try:
        # 移除可能存在于CDATA之外的BOM字符或空白
        clean_xml_string = xml_string.strip()
        root = ET.fromstring(clean_xml_string)
    except ET.ParseError as e:
        print(f"错误：XML格式无效。请检查您的输入。 {e}", file=sys.stderr)
        sys.exit(1)

    # 查找所有的 'change' 元素
    for change in root.findall('change'):
        file_path_elem = change.find('file')
        content_elem = change.find('content')

        # 检查 'file' 标签是否存在且有内容
        if file_path_elem is None or not file_path_elem.text:
            print("警告：发现一个没有 <file> 标签或标签内容为空的 <change> 块，已跳过。", file=sys.stderr)
            continue

        relative_path = file_path_elem.text.strip()
        
        # 'content' 标签可以存在但内容为空，这代表要写入一个空文件
        content = content_elem.text if content_elem is not None and content_elem.text is not None else ""

        # 将相对路径与基目录合并成完整的目标路径
        target_path = os.path.join(base_directory, relative_path)
        print(f"正在处理文件: {target_path}...")

        try:
            # 提取文件所在目录
            parent_dir = os.path.dirname(target_path)

            # 如果路径包含目录，则创建目录
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
                print(f"已确保目录存在: {parent_dir}")

            # 以写入模式('w')打开文件，如果文件存在则覆盖，不存在则新建
            with open(target_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            print(f"成功将内容写入到: {target_path}")

        except IOError as e:
            print(f"错误：写入文件 '{target_path}' 时发生IO错误: {e}", file=sys.stderr)
        except Exception as e:
            print(f"错误：处理文件 '{target_path}' 时发生未知错误: {e}", file=sys.stderr)

def main():
    """
    主函数，从标准输入读取XML并应用更改。
    """
    print("脚本已启动。请粘贴您的XML内容到终端。")
    print("在Windows上按 Ctrl+Z 然后回车，或在macOS/Linux上按 Ctrl+D 来结束输入。")
    
    # 从标准输入流读取所有内容
    xml_input = sys.stdin.read()

    if not xml_input.strip():
        print("错误：没有从标准输入接收到任何内容。", file=sys.stderr)
        sys.exit(1)

    apply_changes_from_xml(xml_input)
    print("\n所有更改已成功应用。")

if __name__ == "__main__":
    main()