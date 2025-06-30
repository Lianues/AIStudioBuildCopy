# 应用重构计划：从 CLI 到 Web GUI

## 1. 总体规划

本项目旨在将现有基于命令行的 Node.js 应用重构为现代化的、前后端分离的 Web 应用。这将极大地改善用户交互体验和开发效率。

新架构包含两个核心部分：

- **后端 API 服务**: 基于现有的 Node.js/TypeScript 代码库，负责所有核心逻辑，并通过 API 对外提供服务。
- **前端 Web 应用**: 一个全新的、基于现代框架的单页应用（SPA），负责用户界面和交互。

## 2. 架构示意图

```mermaid
graph TD
    subgraph "用户浏览器"
        Frontend[前端 Web 应用<br>(React / Vue / Svelte)]
    end

    subgraph "本地服务器"
        Backend[Node.js API 服务器<br>(Express / Fastify)]
        Core[核心逻辑<br>(projectReader, aiService, etc.)]
    end

    User(用户) -- 操作 --> Frontend
    Frontend -- "API 请求 (HTTP/WebSocket)" --> Backend
    Backend -- "调用内部模块" --> Core
    Core -- "返回结果" --> Backend
    Backend -- "API 响应" --> Frontend
    Frontend -- "更新界面" --> User
```

## 3. 重构路线图

```mermaid
gantt
    title 应用重构路线图：从 CLI 到 Web GUI

    section 后端改造 (API 化)
    定义核心 API 接口       :done,    des1, 2024-07-01, 1d
    引入 Express.js 并搭建服务器 :         des2, after des1, 2d
    封装 Project Reader API  :         des3, after des2, 2d
    封装 AI Service API      :         des4, after des2, 2d
    封装 File Change API     :         des5, after des2, 1d

    section 前端搭建 (从零到一)
    技术选型与项目初始化     :         des6, 2024-07-02, 1d
    搭建基础页面布局         :         des7, after des6, 2d
    实现文件树组件           :         des8, after des7, 3d
    实现代码展示组件         :         des9, after des7, 2d

    section 功能整合与联调
    联调：显示项目文件树     :         des10, after des3, after des8, 2d
    联调：点击文件显示内容   :         des11, after des10, 2d
    联调：实现 AI 交互面板   :         des12, after des4, after des11, 3d
    联调：提交并应用代码变更 :         des13, after des5, after des12, 3d
```

## 4. 阶段一：后端改造 —— 构建 API 服务

**目标**：将现有逻辑封装成可通过网络调用的 API。

- **安装依赖**:
  - `express`, `cors`
  - `@types/express`, `@types/cors`
- **创建服务器入口**:
  - 新建文件 `src/server.ts`，用于初始化和启动 Express 服务器。
- **定义 API Endpoints**:
  - `GET /api/project/files`: 获取项目文件结构。
  - `GET /api/files/content?path=<file_path>`: 获取指定文件内容。
  - `POST /api/ai/chat`: 与 AI 服务交互。
  - `POST /api/files/apply-changes`: 应用代码变更。

## 5. 阶段二：前端搭建 —— 创建用户界面

**目标**：创建一个用户可以与之交互的 Web 界面。

- **技术选型与初始化**:
  - **框架**: React + TypeScript
  - **构建工具**: Vite
  - **操作**: 运行 `npm create vite@latest frontend -- --template react-ts` 创建前端项目。
- **组件化设计**:
  - **`FileTree` 组件**: 展示项目文件结构。
  - **`Editor` 组件**: 展示/编辑文件内容 (推荐使用 Monaco Editor)。
  - **`ChatPanel` 组件**: 与 AI 服务交互的界面。

## 6. 阶段三：功能整合与联调

**目标**：将前端界面与后端 API 连接起来，实现完整的功能闭环。

- **开发流程**:
  - 使用 `concurrently` 实现 `npm run dev` 同时启动前后端服务。
- **核心功能流**:
  1.  **启动**: 前端获取并展示文件树。
  2.  **查看**: 点击文件，前端获取并展示文件内容。
  3.  **交互**: 通过聊天面板与 AI 交互。
  4.  **应用**: 提交 AI 生成的变更并应用到文件。
