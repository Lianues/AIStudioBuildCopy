import os
import xml.etree.ElementTree as ET

# 用户提供的 XML 格式内容
# 您可以将其替换为从文件读取或任何其他来源获取的字符串
xml_data = """
<changes>
  <change>
    <file>index.html</file>
    <description>Import a lively font (Poppins), add CSS keyframe animations for a gradient shift and a fade-in effect on the h1 element to make the text more dynamic and engaging.</description>
    <content><![CDATA[<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Animated Hello World</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700&display=swap" rel="stylesheet">
    <style>
        :root {
            color-scheme: light dark;
        }
        body {
            font-family: 'Poppins', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background-color: #fdfdff;
        }

        @media (prefers-color-scheme: dark) {
            body {
                background-color: #1a1a1a;
            }
        }

        #root {
            text-align: center;
        }
        
        h1 {
            font-size: clamp(2.5rem, 10vw, 6rem);
            font-weight: 700;
            background: linear-gradient(45deg, #f857a6, #ff5858, #49c5b6, #ffdd57);
            background-size: 400% 400%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: gradientShift 10s ease infinite, fadeIn 1.2s ease-out forwards;
            opacity: 0;
            text-shadow: 0 0 15px rgba(255, 88, 88, 0.1);
        }

        @keyframes gradientShift {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(25px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="./index.tsx"></script>
</body>
</html>
]]></content>
  </change>
  <change>
    <file>index.tsx</file>
    <description>Update React and ReactDOM imports to use esm.sh CDN for modern browser compatibility. The component remains a simple h1 element, now styled by the updated CSS in index.html.</description>
    <content><![CDATA[import React from 'https://esm.sh/react@18.2.0';
import ReactDOM from 'https://esm.sh/react-dom@18.2.0/client';

const App = () => {
  return React.createElement('h1', null, 'Hello World!');
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(React.createElement(App));
}
]]></content>
  </change>
  <change>
    <file>metadata.json</file>
    <description>Updated metadata description and name to reflect the new animated and lively design of the application.</description>
    <content><![CDATA[{
 "description": "A 'Hello, World!' application with a lively, animated font effect.",
 "prompt": "请你给这个字体加上平滑的动画效果，以及让字体变得更活泼",
 "requestFramePermissions": [],
 "name": "Animated Hello World"
}
]]></content>
  </change>
</changes>
"""

def apply_changes(xml_string):
    """
    解析 XML 字符串并根据其内容创建或更新文件。

    :param xml_string: 包含文件更改信息的 XML 格式字符串。
    """
    try:
        # 从字符串解析 XML
        root = ET.fromstring(xml_string)

        # 遍历每一个 <change> 标签
        for change in root.findall('change'):
            # 提取文件路径、描述和内容
            file_path_element = change.find('file')
            description_element = change.find('description')
            content_element = change.find('content')

            if file_path_element is None or content_element is None:
                print("警告: 某个 <change> 标签缺少 <file> 或 <content> 子标签，已跳过。")
                continue

            file_path = file_path_element.text.strip()
            description = description_element.text.strip() if description_element is not None else "无描述"
            content = content_element.text # .text 会自动处理 CDATA

            print(f"正在处理文件: {file_path}")
            print(f"  描述: {description}")

            try:
                # 提取文件所在的目录路径
                directory = os.path.dirname(file_path)

                # 如果文件路径包含目录 (例如 'src/components/')，且目录不存在，则创建它
                if directory and not os.path.exists(directory):
                    os.makedirs(directory)
                    print(f"  已创建目录: {directory}")

                # 使用 'w' 模式打开文件，如果文件存在则覆盖，不存在则创建
                # 使用 utf-8 编码以支持各种字符
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)

                print(f"  成功将内容写入到: {file_path}\n")

            except Exception as e:
                print(f"  处理文件 {file_path} 时出错: {e}\n")

    except ET.ParseError as e:
        print(f"XML 解析失败: {e}")
    except Exception as e:
        print(f"发生未知错误: {e}")


if __name__ == "__main__":
    print("开始应用文件更改...\n")
    apply_changes(xml_data)
    print("所有更改已应用完毕。")