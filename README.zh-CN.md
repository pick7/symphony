# Symphony

**Symphony** 是一个编码代理编排器，它将项目工作转化为隔离的、自主的执行运行，让团队专注于管理工作而非监督编码代理。

[![Symphony 演示视频预览](.github/media/symphony-demo-poster.jpg)](.github/media/symphony-demo.mp4)

_在这个[演示视频](.github/media/symphony-demo.mp4)中，Symphony 监控 Linear 看板中的工作并派生代理来处理任务。代理完成任务并提供工作证据：CI 状态、PR 审查反馈、复杂度分析和演示视频。当被接受后，代理会安全地合并 PR。工程师无需监督 Codex；他们可以在更高层级管理工作。_

> [!WARNING]
> Symphony 是一个低调的工程预览版本，仅供在可信环境中测试。

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [两种实现](#两种实现)
  - [Elixir 实现（Linear + Codex）](#elixir-实现linear--codex)
  - [Node.js 实现（Jira + GitLab + AI）](#nodejs-实现jira--gitlab--ai)
- [快速开始](#快速开始)
  - [方式一：让代理为你构建](#方式一让代理为你构建)
  - [方式二：使用 Elixir 参考实现](#方式二使用-elixir-参考实现)
  - [方式三：使用 Node.js 实现](#方式三使用-nodejs-实现)
- [配置详解](#配置详解)
  - [WORKFLOW.md 文件格式](#workflowmd-文件格式)
  - [前置配置字段](#前置配置字段)
  - [提示模板](#提示模板)
  - [动态热重载](#动态热重载)
- [工作空间管理](#工作空间管理)
- [编排状态机](#编排状态机)
- [编码代理集成协议](#编码代理集成协议)
- [问题追踪器集成](#问题追踪器集成)
- [可观测性与仪表盘](#可观测性与仪表盘)
  - [Web 仪表盘](#web-仪表盘)
  - [JSON REST API](#json-rest-api)
- [故障模型与恢复策略](#故障模型与恢复策略)
- [安全性与操作安全](#安全性与操作安全)
- [测试](#测试)
- [项目结构](#项目结构)
- [规范文档](#规范文档)
- [常见问题](#常见问题)
- [许可证](#许可证)

---

## 项目简介

Symphony 是一个长期运行的自动化服务，它持续从问题追踪器（如 Linear 或 Jira）中读取工作，为每个问题创建隔离的工作空间，并在工作空间内运行编码代理会话。

该服务解决了四个核心运营问题：

1. **工作流守护进程化** — 将问题执行转化为可重复的守护进程工作流，替代手动脚本。
2. **代理执行隔离** — 在按问题划分的工作空间中隔离代理执行，确保代理命令只在对应的工作空间目录中运行。
3. **策略版本化** — 将工作流策略保存在仓库内（`WORKFLOW.md`），团队可以将代理提示和运行时设置与代码一起进行版本控制。
4. **运行时可观测性** — 提供足够的可观测性来操作和调试多个并发代理运行。

### 重要边界

- Symphony 是一个调度器/运行器和追踪器读取器。
- 工单写入（状态转换、评论、PR 链接）通常由编码代理使用工作流/运行时环境中可用的工具来执行。
- 一次成功的运行可能结束于工作流定义的交接状态（例如 `Human Review`），而不一定是 `Done`。

---

## 核心特性

| 特性 | 描述 |
|------|------|
| 轮询式调度 | 以可配置的间隔轮询问题追踪器获取候选工作 |
| 按问题隔离工作空间 | 每个问题拥有独立的工作空间目录，支持生命周期钩子 |
| 有界并发控制 | 全局和按状态的并发限制，防止资源过载 |
| 指数退避重试 | 失败后自动重试，使用指数退避策略，可配置最大退避时间 |
| 活跃运行协调 | 当问题状态变为终态或非活跃态时自动停止运行 |
| 卡死检测 | 检测无活动的代理会话并触发重试 |
| 热重载配置 | 修改 `WORKFLOW.md` 后无需重启即可自动重新加载配置和提示模板 |
| 可选 Web 仪表盘 | Phoenix LiveView（Elixir）或 Express（Node.js）仪表盘 |
| JSON REST API | 提供运行时状态查询和操作调试接口 |
| Token 使用追踪 | 跟踪编码代理的输入/输出/总 token 消耗 |
| 速率限制监控 | 追踪最新的代理速率限制负载 |
| 结构化日志 | 包含问题/会话上下文字段的结构化日志输出 |
| 启动时终态清理 | 服务启动时自动清理已处于终态的问题工作空间 |

---

## 系统架构

Symphony 采用分层架构设计，易于移植和理解：

```
┌─────────────────────────────────────────────────────────────────┐
│  策略层 (Policy Layer)                                          │
│  WORKFLOW.md 提示正文 + 团队特定规则                              │
├─────────────────────────────────────────────────────────────────┤
│  配置层 (Configuration Layer)                                    │
│  解析前置配置 → 类型化运行时设置，处理默认值和环境变量                 │
├─────────────────────────────────────────────────────────────────┤
│  协调层 (Coordination Layer)                                     │
│  轮询循环、问题资格判断、并发控制、重试、协调                         │
├─────────────────────────────────────────────────────────────────┤
│  执行层 (Execution Layer)                                        │
│  文件系统生命周期、工作空间准备、编码代理协议                         │
├─────────────────────────────────────────────────────────────────┤
│  集成层 (Integration Layer)                                      │
│  追踪器适配器（Linear / Jira）的 API 调用和数据规范化               │
├─────────────────────────────────────────────────────────────────┤
│  可观测性层 (Observability Layer)                                 │
│  结构化日志 + 可选的状态仪表盘和 JSON API                          │
└─────────────────────────────────────────────────────────────────┘
```

### 主要组件

1. **工作流加载器 (Workflow Loader)** — 读取并解析 `WORKFLOW.md`，返回配置和提示模板。
2. **配置层 (Config Layer)** — 提供类型化的配置访问器，处理默认值和 `$VAR` 环境变量解析。
3. **问题追踪器客户端 (Issue Tracker Client)** — 获取候选问题、刷新状态、清理终态工单。
4. **编排器 (Orchestrator)** — 拥有轮询周期和内存运行时状态，决定分发、重试、停止或释放。
5. **工作空间管理器 (Workspace Manager)** — 映射问题标识符到工作空间路径，管理目录生命周期。
6. **代理运行器 (Agent Runner)** — 创建工作空间、构建提示、启动编码代理、流式返回更新。
7. **状态界面 (Status Surface)** — 可选的可视化运行时状态（仪表盘、终端输出等）。

---

## 两种实现

Symphony 提供了两种参考实现，均遵循 [`SPEC.md`](SPEC.md) 规范。

### Elixir 实现（Linear + Codex）

| 组件 | 技术 |
|------|------|
| 语言 | Elixir ~1.19（OTP 28） |
| 运行时管理 | mise |
| Web 框架 | Phoenix LiveView + Bandit |
| HTTP 客户端 | Req |
| YAML 解析 | yaml_elixir |
| 模板引擎 | Solid（Liquid 兼容） |
| 代码检查 | Credo + Dialyzer |
| 测试框架 | ExUnit（100% 覆盖率阈值） |
| 问题追踪器 | Linear（GraphQL API） |
| 编码代理 | Codex app-server（JSON-RPC stdio） |

**特色功能：**
- OTP 监督树确保进程可靠性
- 开发时热代码重载，无需停止活跃的子代理
- 内置 `linear_graphql` 客户端工具，支持原始 Linear GraphQL 调用
- Phoenix LiveView 实时仪表盘
- 编译为独立可执行文件（escript）

### Node.js 实现（Jira + GitLab + AI）

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js >= 18（ES 模块） |
| Web 框架 | Express |
| HTTP 客户端 | Axios |
| 模板引擎 | LiquidJS |
| YAML 解析 | js-yaml |
| 文件监控 | Chokidar |
| 日志框架 | Winston |
| 问题追踪器 | Jira REST API 或内存适配器 |
| 编码代理 | OpenAI 兼容 HTTP API（聊天补全） |
| 版本控制集成 | GitLab REST API |

**两种运行模式：**

- **`prompt-only`（默认）** — 从 Jira 问题生成提示，你手动将提示复制到公司的 AI 端点。
- **`auto`** — 直接将提示发送到 OpenAI 兼容的 AI 端点，运行多轮对话并追踪 token 使用。

### 实现对比

| 特性 | Elixir | Node.js |
|------|--------|---------|
| 问题追踪器 | Linear | Jira |
| 代码托管 | GitHub | GitLab |
| 编码代理协议 | Codex app-server (JSON-RPC stdio) | OpenAI HTTP API (聊天补全) |
| 仪表盘 | Phoenix LiveView（实时） | Express（静态 HTML） |
| 测试套件 | 完整（ExUnit + Credo + Dialyzer） | 未提供 |
| CI/CD | GitHub Actions | 未提供 |
| 构建产物 | escript 可执行文件 | 直接运行 Node.js |

---

## 快速开始

### 方式一：让代理为你构建

告诉你喜欢的编码代理用你选择的编程语言构建 Symphony：

> 按照以下规范实现 Symphony：
> https://github.com/openai/symphony/blob/main/SPEC.md

### 方式二：使用 Elixir 参考实现

#### 前置条件

- 安装 [mise](https://mise.jdx.dev/) 来管理 Elixir/Erlang 版本
- 获取 Linear Personal API Key：Linear Settings → Security & access → Personal API keys
- 将 API Key 设置为 `LINEAR_API_KEY` 环境变量

#### 安装和运行

```bash
git clone https://github.com/openai/symphony
cd symphony/elixir

# 安装运行时（Elixir + Erlang）
mise trust
mise install

# 安装依赖并编译
mise exec -- mix setup
mise exec -- mix build

# 启动 Symphony
mise exec -- ./bin/symphony ./WORKFLOW.md
```

#### 可选 CLI 参数

```bash
# 指定自定义工作流文件路径
./bin/symphony /path/to/custom/WORKFLOW.md

# 启用 Web 仪表盘（指定端口）
./bin/symphony ./WORKFLOW.md --port 4000

# 自定义日志目录
./bin/symphony ./WORKFLOW.md --logs-root /var/log/symphony
```

### 方式三：使用 Node.js 实现

#### 前置条件

- Node.js >= 18
- Jira 账户和 API Token
- （可选）GitLab 账户和 Personal Access Token
- （可选，`auto` 模式）OpenAI 兼容的 AI API 端点

#### 安装和运行

```bash
cd nodejs
npm install

# 复制并填写你的凭证
cp .env.example .env
# 编辑 .env 文件，填入 Jira、GitLab、AI 的凭证

# 启动（默认使用 ./WORKFLOW.md）
node src/index.js

# 或指定工作流文件和端口
node src/index.js ./WORKFLOW.md --port 3000
```

在浏览器中打开 http://localhost:3000 查看仪表盘。

#### 环境变量

| 变量 | 描述 | 必填 |
|------|------|------|
| `JIRA_BASE_URL` | Jira 实例 URL（如 `https://company.atlassian.net`） | 是 |
| `JIRA_EMAIL` | Jira 账户邮箱 | 是 |
| `JIRA_API_TOKEN` | Jira API Token | 是 |
| `JIRA_PROJECT_KEY` | Jira 项目键（如 `PROJ`） | 是 |
| `GITLAB_BASE_URL` | GitLab 实例 URL | 否 |
| `GITLAB_TOKEN` | GitLab Personal Access Token | 否 |
| `GITLAB_PROJECT_ID` | GitLab 项目 ID | 否 |
| `AI_BASE_URL` | OpenAI 兼容 API Base URL | `auto` 模式必填 |
| `AI_API_KEY` | AI 端点的 API Key | `auto` 模式必填 |
| `AI_MODEL` | 模型名称（如 `gpt-4`） | `auto` 模式必填 |
| `PORT` | 仪表盘 HTTP 端口（默认 3000） | 否 |

---

## 配置详解

### WORKFLOW.md 文件格式

`WORKFLOW.md` 是 Symphony 的核心配置文件，使用 YAML 前置配置 + Markdown 正文格式：

```markdown
---
# YAML 前置配置（运行时设置）
tracker:
  kind: linear
  project_slug: "my-project-slug"
workspace:
  root: ~/code/workspaces
agent:
  max_concurrent_agents: 10
---

<!-- Markdown 正文（提示模板） -->
你正在处理 Linear 工单 {{ issue.identifier }}

标题: {{ issue.title }}
描述: {{ issue.description }}
```

**解析规则：**
- 如果文件以 `---` 开头，解析到下一个 `---` 之间的内容作为 YAML 前置配置
- 其余行作为提示正文
- 如果没有前置配置，整个文件作为提示正文，使用空配置
- YAML 前置配置必须解码为映射/对象；非映射 YAML 会报错
- 提示正文在使用前会被修剪

### 前置配置字段

#### `tracker`（追踪器配置）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `kind` | string | — | 必填。`linear`（Elixir）或 `jira` / `memory`（Node.js） |
| `endpoint` | string | `https://api.linear.app/graphql` | GraphQL 端点（Linear） |
| `api_key` | string | `$LINEAR_API_KEY` | API 密钥，支持 `$VAR_NAME` 环境变量解析 |
| `project_slug` | string | — | Linear 项目 slug（`linear` 类型必填） |
| `active_states` | list/string | `Todo, In Progress` | 活跃状态列表 |
| `terminal_states` | list/string | `Closed, Cancelled, Canceled, Duplicate, Done` | 终态列表 |

#### `polling`（轮询配置）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `interval_ms` | integer | `30000` | 轮询间隔（毫秒），运行时动态生效 |

#### `workspace`（工作空间配置）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `root` | path | `<系统临时目录>/symphony_workspaces` | 工作空间根目录。支持 `~` 和 `$VAR` 扩展 |

#### `hooks`（生命周期钩子）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `after_create` | shell script | null | 工作空间首次创建后执行。失败会中止创建 |
| `before_run` | shell script | null | 每次代理尝试前执行。失败会中止当前尝试 |
| `after_run` | shell script | null | 每次代理尝试后执行。失败会被记录但忽略 |
| `before_remove` | shell script | null | 工作空间删除前执行。失败会被记录但忽略 |
| `timeout_ms` | integer | `60000` | 所有钩子的超时时间（毫秒） |

#### `agent`（代理配置）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `max_concurrent_agents` | integer | `10` | 全局最大并发代理数 |
| `max_turns` | integer | `20` | 单次代理调用中的最大连续 turn 数 |
| `max_retry_backoff_ms` | integer | `300000`（5分钟） | 重试退避的最大延迟 |
| `max_concurrent_agents_by_state` | map | `{}` | 按状态的并发限制（状态名标准化为小写） |

#### `codex`（Codex 代理配置 — Elixir）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `command` | string | `codex app-server` | 启动命令（通过 `bash -lc` 执行） |
| `approval_policy` | string/object | 实现定义 | Codex 审批策略 |
| `thread_sandbox` | string | 实现定义 | 线程沙箱模式 |
| `turn_sandbox_policy` | object | 实现定义 | Turn 沙箱策略 |
| `turn_timeout_ms` | integer | `3600000`（1小时） | Turn 超时 |
| `read_timeout_ms` | integer | `5000` | 读取超时 |
| `stall_timeout_ms` | integer | `300000`（5分钟） | 卡死检测超时 |

#### `ai`（AI 配置 — Node.js）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `base_url` | string | `$AI_BASE_URL` | OpenAI 兼容 API Base URL |
| `api_key` | string | `$AI_API_KEY` | API Key |
| `model` | string | `$AI_MODEL` | 模型名称 |
| `system_prompt` | string | — | 系统提示 |
| `max_tokens` | integer | `4096` | 最大 token 数 |
| `temperature` | number | `0.2` | 温度参数 |
| `turn_timeout_ms` | integer | `600000` | Turn 超时 |
| `stall_timeout_ms` | integer | `300000` | 卡死检测超时 |

#### `server`（HTTP 服务器配置 — 扩展）

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `port` | integer | — | HTTP 端口。CLI `--port` 参数优先 |

### 提示模板

`WORKFLOW.md` 的 Markdown 正文是每个问题的提示模板，使用 Liquid 兼容的模板引擎渲染。

**可用变量：**

| 变量 | 描述 |
|------|------|
| `issue.id` | 追踪器内部 ID |
| `issue.identifier` | 人类可读的工单键（如 `ABC-123`） |
| `issue.title` | 工单标题 |
| `issue.description` | 工单描述 |
| `issue.state` | 当前追踪器状态名 |
| `issue.priority` | 优先级（整数，数值越小优先级越高） |
| `issue.url` | 工单 URL |
| `issue.labels` | 标签列表（已标准化为小写） |
| `issue.blocked_by` | 阻塞者列表 |
| `issue.created_at` | 创建时间 |
| `issue.updated_at` | 更新时间 |
| `attempt` | 重试次数（首次运行为 null） |

**模板示例：**

```markdown
你正在处理 Linear 工单 {{ issue.identifier }}

{% if attempt %}
这是第 {{ attempt }} 次重试。请从当前工作空间状态继续，而非从头开始。
{% endif %}

标题: {{ issue.title }}
描述: {{ issue.description }}
当前状态: {{ issue.state }}
标签: {{ issue.labels }}
```

### 动态热重载

Symphony 监控 `WORKFLOW.md` 文件变更，并在检测到修改时自动重新加载：

- 配置变更（轮询间隔、并发限制、活跃/终态状态等）立即生效，影响后续调度
- 提示模板变更对未来的运行生效
- 无效的重载不会导致服务崩溃；继续使用上一次已知的有效配置
- 已在运行的代理会话不会自动重启

---

## 工作空间管理

### 工作空间布局

```
<workspace.root>/
├── <sanitized-issue-identifier-1>/   # 例如 ABC-123/
│   ├── .git/
│   └── ... （仓库代码）
├── <sanitized-issue-identifier-2>/   # 例如 ABC-456/
│   ├── .git/
│   └── ... （仓库代码）
└── ...
```

### 工作空间标识符清理

工作空间目录名通过清理问题标识符生成：
- 只允许 `[A-Za-z0-9._-]` 字符
- 所有其他字符替换为 `_`

### 工作空间生命周期

1. **创建** — 若目录不存在，则创建并标记 `created_now=true`
2. **after_create 钩子** — 仅在首次创建时运行（例如 `git clone`）
3. **复用** — 同一问题的后续运行复用已有工作空间
4. **清理** — 当问题进入终态时删除工作空间

### 安全不变量

1. **代理只在工作空间内运行** — 启动编码代理前验证 `cwd == workspace_path`
2. **路径必须在根目录内** — 工作空间路径必须以工作空间根目录为前缀
3. **标识符已清理** — 工作空间目录名只包含安全字符

---

## 编排状态机

### 问题编排状态（内部状态，非追踪器状态）

```
┌──────────┐    分发    ┌─────────┐    退出    ┌──────────────┐
│ Unclaimed│──────────>│ Claimed │──────────>│ RetryQueued  │
│ (未认领)  │           │ (已认领) │<──────────│ (等待重试)    │
└──────────┘           │         │   重试定时器 └──────────────┘
     ^                 │ Running │                    │
     │                 │ (运行中) │                    │
     │                 └────┬────┘                    │
     │                      │                         │
     │     终态/非活跃      │                         │
     └──────────────────────┴─────────────────────────┘
                        Released (释放)
```

### 轮询-分发周期

每次轮询按以下顺序执行：

1. **协调** — 检查运行中问题的当前状态（卡死检测 + 追踪器状态刷新）
2. **验证** — 验证分发前置条件
3. **获取** — 从追踪器获取候选问题
4. **排序** — 按优先级、创建时间、标识符排序
5. **分发** — 在有可用槽位时分发合格问题

### 候选选择规则

问题必须同时满足以下条件才能被分发：

- 具有 `id`、`identifier`、`title` 和 `state`
- 状态在 `active_states` 中且不在 `terminal_states` 中
- 未在 `running` 中运行
- 未在 `claimed` 中被认领
- 全局并发槽位可用
- 按状态并发槽位可用
- `Todo` 状态的阻塞者规则通过（无非终态阻塞者）

### 重试与退避

| 场景 | 延迟计算 |
|------|----------|
| 正常退出后的续接重试 | 固定 `1000` ms |
| 失败驱动的重试 | `min(10000 * 2^(attempt-1), max_retry_backoff_ms)` |

---

## 编码代理集成协议

### Elixir：Codex App-Server 协议

Symphony 通过 JSON-RPC stdio 协议与 Codex app-server 通信：

1. **启动** — `bash -lc <codex.command>`，工作目录为工作空间路径
2. **握手** — 依次发送 `initialize` → `initialized` → `thread/start` → `turn/start`
3. **流式处理** — 读取 stdout 的行分隔 JSON 消息直到 turn 终止
4. **续接** — 若需继续，在同一线程上发起新的 `turn/start`
5. **终止条件** — `turn/completed`（成功）、`turn/failed`/`turn/cancelled`/超时/进程退出（失败）

### Node.js：OpenAI 兼容 HTTP API

Node.js 实现通过标准的 OpenAI 聊天补全 HTTP API 与 AI 端点通信，支持多轮对话。

---

## 问题追踪器集成

### 必需操作

| 操作 | 用途 |
|------|------|
| `fetch_candidate_issues()` | 获取活跃状态的候选问题 |
| `fetch_issues_by_states(state_names)` | 启动时终态清理 |
| `fetch_issue_states_by_ids(issue_ids)` | 活跃运行协调（状态刷新） |

### Linear 集成（Elixir）

- GraphQL API，端点默认为 `https://api.linear.app/graphql`
- 通过 `Authorization` 头发送认证令牌
- 使用 `project.slugId` 过滤项目问题
- 支持分页（默认每页 50 条）
- 可选 `linear_graphql` 客户端工具供代理在会话中使用

### Jira 集成（Node.js）

- REST API
- 支持按项目键、受理人、状态过滤
- ADF（Atlassian Document Format）描述自动转换为文本

---

## 可观测性与仪表盘

### Web 仪表盘

两种实现都在 `/` 路径提供人类可读的仪表盘，展示：

- 活跃会话及其状态
- 重试延迟队列
- Token 消耗统计
- 运行时总计
- 最近事件
- 健康/错误指标

**Elixir** 使用 Phoenix LiveView 实现实时更新仪表盘。
**Node.js** 使用 Express 提供静态 HTML 仪表盘。

### JSON REST API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/state` | 返回完整的运行时状态 JSON |
| GET | `/api/v1/<issue_identifier>` | 返回单个问题的详细信息 |
| POST | `/api/v1/refresh` | 触发立即轮询和协调 |

**`GET /api/v1/state` 响应示例：**

```json
{
  "generated_at": "2026-03-06T10:15:30Z",
  "counts": { "running": 2, "retrying": 1 },
  "running": [
    {
      "issue_id": "abc123",
      "issue_identifier": "MT-649",
      "state": "In Progress",
      "session_id": "thread-1-turn-1",
      "turn_count": 7,
      "last_event": "turn_completed",
      "started_at": "2026-03-06T10:10:12Z",
      "tokens": { "input_tokens": 1200, "output_tokens": 800, "total_tokens": 2000 }
    }
  ],
  "retrying": [
    {
      "issue_id": "def456",
      "issue_identifier": "MT-650",
      "attempt": 3,
      "due_at": "2026-03-06T10:16:00Z",
      "error": "no available orchestrator slots"
    }
  ],
  "codex_totals": {
    "input_tokens": 5000,
    "output_tokens": 2400,
    "total_tokens": 7400,
    "seconds_running": 1834.2
  },
  "rate_limits": null
}
```

---

## 故障模型与恢复策略

### 故障类型

| 类型 | 示例 | 恢复行为 |
|------|------|----------|
| 工作流/配置故障 | 缺少 `WORKFLOW.md`、无效 YAML | 跳过新分发，保持服务运行 |
| 工作空间故障 | 目录创建失败、钩子超时 | 当前尝试失败，编排器决定重试 |
| 代理会话故障 | 握手失败、turn 失败/超时 | 指数退避重试 |
| 追踪器故障 | API 传输错误、非 200 状态 | 跳过本次轮询，下次重试 |
| 可观测性故障 | 仪表盘渲染错误、日志 sink 失败 | 不影响编排器运行 |

### 重启恢复

Symphony 采用纯内存状态设计，重启后通过以下方式恢复：

1. 启动时终态工作空间清理
2. 重新轮询活跃问题
3. 重新分发合格工作

### 操作员干预点

- **编辑 `WORKFLOW.md`** — 修改提示和大部分运行时设置（自动检测并重新应用）
- **修改追踪器中的问题状态** — 终态 → 停止运行并清理工作空间；非活跃态 → 停止运行
- **重启服务** — 用于进程恢复或部署

---

## 安全性与操作安全

### 文件系统安全

- 工作空间路径必须保持在配置的工作空间根目录内
- 编码代理的工作目录必须是按问题划分的工作空间路径
- 工作空间目录名必须使用清理后的标识符

### 密钥处理

- 工作流配置中支持 `$VAR` 间接引用
- 不在日志中记录 API 令牌或密钥环境变量
- 验证密钥存在性但不打印内容

### 钩子脚本安全

- 钩子是来自 `WORKFLOW.md` 的任意 shell 脚本，被视为完全信任的配置
- 钩子在工作空间目录内运行
- 钩子输出在日志中会被截断
- 钩子超时是必需的，以避免阻塞编排器

### 强化建议

- 收紧 Codex 审批和沙箱设置
- 添加外部隔离层（OS/容器/VM 沙箱、网络限制）
- 过滤允许分发的问题/项目/标签
- 将代理可用的工具、凭证、文件路径和网络目标减少到最低需要

---

## 测试

### Elixir

```bash
cd elixir

# 运行完整质量门（格式检查 + lint + 覆盖率 + dialyzer）
make all

# 或单独运行
make fmt-check   # 格式检查
make lint         # Credo 代码检查 + @spec 检查
make coverage     # ExUnit 测试（100% 覆盖率阈值）
make dialyzer     # 类型检查
make build        # 编译为 escript
```

### Node.js

```bash
cd nodejs
npm install
npm start         # 启动服务
npm run dev       # 开发模式（文件监控自动重启）
```

---

## 项目结构

```
symphony/
├── README.md                         # 项目概述
├── README.zh-CN.md                   # 中文 README
├── README.en.md                      # 英文详细 README
├── SPEC.md                           # 完整规范文档（语言无关）
├── LICENSE                           # Apache License 2.0
│
├── .github/
│   ├── workflows/
│   │   ├── make-all.yml              # CI：格式、lint、覆盖率、dialyzer
│   │   └── pr-description-lint.yml   # PR 描述验证
│   ├── pull_request_template.md      # PR 模板
│   └── media/                        # 演示视频、截图
│
├── .codex/                           # Codex 技能和环境设置
│   ├── worktree_init.sh              # 工作树初始化脚本
│   └── skills/
│       ├── commit/SKILL.md           # 提交技能
│       ├── push/SKILL.md             # 推送技能
│       ├── pull/SKILL.md             # 拉取技能
│       ├── land/SKILL.md             # 合并着陆技能
│       ├── linear/SKILL.md           # Linear 交互技能
│       └── debug/SKILL.md            # 调试技能
│
├── elixir/                           # Elixir/OTP 实现
│   ├── lib/
│   │   ├── symphony_elixir/
│   │   │   ├── cli.ex               # CLI 入口
│   │   │   ├── config.ex            # 类型化配置层
│   │   │   ├── workflow.ex           # WORKFLOW.md 解析器
│   │   │   ├── workflow_store.ex     # 文件监控 + 热重载
│   │   │   ├── orchestrator.ex       # 轮询/分发/重试/协调
│   │   │   ├── agent_runner.ex       # 按问题 turn 运行器
│   │   │   ├── workspace.ex          # 按问题工作空间管理
│   │   │   ├── prompt_builder.ex     # Liquid 模板渲染
│   │   │   ├── tracker.ex            # 追踪器适配器接口
│   │   │   ├── status_dashboard.ex   # 状态仪表盘逻辑
│   │   │   ├── http_server.ex        # HTTP 服务器管理
│   │   │   ├── log_file.ex           # 日志文件管理
│   │   │   ├── linear/
│   │   │   │   ├── client.ex         # Linear GraphQL 客户端
│   │   │   │   ├── adapter.ex        # Linear 数据适配器
│   │   │   │   └── issue.ex          # Linear 问题模型
│   │   │   ├── codex/
│   │   │   │   ├── app_server.ex     # Codex app-server 客户端
│   │   │   │   └── dynamic_tool.ex   # 动态工具（linear_graphql）
│   │   │   └── tracker/
│   │   │       └── memory.ex         # 内存追踪器适配器
│   │   └── symphony_elixir_web/
│   │       ├── endpoint.ex           # Phoenix 端点
│   │       ├── router.ex             # 路由定义
│   │       ├── live/
│   │       │   └── dashboard_live.ex # LiveView 仪表盘
│   │       └── controllers/
│   │           └── observability_api_controller.ex  # JSON API
│   ├── test/                         # ExUnit 测试
│   ├── config/config.exs             # Mix 配置
│   ├── mix.exs                       # 项目定义和依赖
│   ├── Makefile                      # 构建和测试目标
│   ├── WORKFLOW.md                   # 示例工作流
│   ├── AGENTS.md                     # 代理编码约定
│   └── docs/
│       ├── logging.md                # 日志约定
│       └── token_accounting.md       # Token 计费文档
│
└── nodejs/                           # Node.js 实现
    ├── src/
    │   ├── index.js                  # CLI 入口
    │   ├── config.js                 # 类型化配置
    │   ├── workflow.js               # WORKFLOW.md 解析器
    │   ├── workflow-store.js         # 文件监控 + 热重载
    │   ├── prompt-builder.js         # Liquid 模板渲染
    │   ├── orchestrator.js           # 轮询/分发/重试/协调
    │   ├── agent-runner.js           # 按问题 turn 运行器
    │   ├── ai-client.js              # OpenAI 兼容 HTTP 客户端
    │   ├── workspace.js              # 按问题工作空间管理
    │   ├── logger.js                 # 结构化日志（Winston）
    │   ├── tracker/
    │   │   ├── index.js              # 追踪器适配器工厂
    │   │   ├── jira-adapter.js       # Jira REST API 客户端
    │   │   └── memory-adapter.js     # 内存测试适配器
    │   ├── gitlab/
    │   │   └── client.js             # GitLab REST API 客户端
    │   └── web/
    │       ├── server.js             # Express 服务器 + API 路由
    │       └── dashboard.html        # 单页仪表盘 UI
    ├── package.json                  # 项目依赖
    ├── .env.example                  # 环境变量模板
    ├── WORKFLOW.md                   # 示例工作流
    └── README.md                     # Node.js 实现文档
```

---

## 规范文档

完整的语言无关规范见 [`SPEC.md`](SPEC.md)，包含：

- 核心领域模型定义（Issue、Workspace、Run Attempt、Live Session 等）
- 编排状态机详细设计
- 轮询、调度和协调算法
- 工作空间管理和安全规范
- 编码代理 App-Server 协议
- 问题追踪器集成契约
- 提示构建和上下文组装
- 日志和可观测性规范
- 故障模型和恢复策略
- 安全和操作安全指南
- 参考算法（伪代码）
- 测试和验证矩阵
- 实现检查清单

你可以将 `SPEC.md` 提供给任何编码代理，让它用你选择的编程语言实现一个完全符合规范的 Symphony。

---

## 常见问题

### 为什么选择 Elixir 作为参考实现？

Elixir 构建在 Erlang/BEAM/OTP 之上，非常适合监督长期运行的进程。它拥有活跃的工具和库生态系统，还支持热代码重载而无需停止正在运行的子代理，这在开发过程中非常有用。

### 我怎么为自己的代码库设置？

启动 `codex`，给它 Symphony 仓库的 URL，然后让它帮你设置：

> 基于 https://github.com/openai/symphony/blob/main/elixir/README.md 为我的仓库设置 Symphony

### Symphony 和 Codex 是什么关系？

Symphony 是编排层，负责从问题追踪器获取工作、管理工作空间、分发任务并处理重试。Codex 是执行层，负责实际的代码编写和工具调用。Symphony 通过 Codex app-server 协议（JSON-RPC stdio）与 Codex 通信。

### 我可以用其他编码代理替代 Codex 吗？

可以。Node.js 实现已经演示了如何使用通用的 OpenAI 兼容 HTTP API。你也可以基于 `SPEC.md` 实现自己的代理集成，只要代理支持所需的通信协议。

### WORKFLOW.md 应该放在哪里？

推荐将 `WORKFLOW.md` 放在仓库根目录并进行版本控制。这样团队可以将代理提示和运行时设置与代码一起管理。Symphony 默认在当前工作目录查找 `WORKFLOW.md`，也可以通过 CLI 参数指定自定义路径。

### 如何在生产环境中加固 Symphony？

参考 `SPEC.md` 第 15 节的安全和操作安全指南：
- 收紧 Codex 审批和沙箱设置
- 添加容器/VM 隔离层
- 限制网络访问
- 过滤允许分发的问题范围
- 限制代理可用的工具和凭证

---

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 许可。
