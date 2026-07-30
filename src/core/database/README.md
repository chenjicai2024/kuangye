# 通用数据库模块

## 概述

本模块为 Kuangye 项目提供统一的数据持久化能力，替代原有的 JSON 文件存储方式。

## 技术栈

- **数据库**：SQLite
- **驱动**：better-sqlite3
- **位置**：`<userData>/kuangye.db`

## 目录结构

```
src/core/database/
├── index.ts                    # 模块导出
├── connection.ts               # 数据库连接管理
├── migrations.ts               # 数据库迁移（表结构定义）
├── dual-write.ts               # 双写模式管理
├── README.md                   # 本文件
├── adapters/                   # 双写适配器
│   ├── project-adapter.ts      # 项目存储适配
│   ├── chat-adapter.ts         # 聊天记录适配
│   └── experience-adapter.ts   # 经验卡片适配
└── repositories/               # 数据访问层
    ├── base-repository.ts      # 基类（通用 CRUD）
    ├── project-repository.ts   # 项目管理
    ├── execution-repository.ts # 执行记录
    ├── chat-repository.ts      # 聊天记录
    ├── experience-repository.ts # 经验卡片
    └── agent-repository.ts     # AI 助手会话
```

## 使用方法

### 初始化

在应用启动时（`main/index.ts` 的 `app.whenReady()`）：

```typescript
import { initDatabase, runMigrations, closeDatabase } from '../core/database'

// 初始化数据库
const db = initDatabase({ basePath: app.getPath('userData') })
runMigrations(db)

// 应用退出时
app.on('before-quit', () => {
  closeDatabase()
})
```

### 使用 Repository

```typescript
import { ProjectRepository, ChatRepository } from '../core/database'

const projectRepo = new ProjectRepository()
const chatRepo = new ChatRepository()

// 创建项目
const project = projectRepo.createProject('我的项目')

// 创建聊天会话
const conversation = chatRepo.createConversation(
  project.id,
  '客户对话',
  'direct',
  ['客户', '我']
)

// 创建消息
chatRepo.messages.createMessage(conversation.id, {
  senderName: '客户',
  senderRole: 'peer',
  contentKind: 'text',
  originalText: '你好'
})
```

## Repository 说明

| Repository | 主要功能 |
|------------|----------|
| `ProjectRepository` | 项目 CRUD、配置管理、工作区管理 |
| `ExecutionRepository` | 执行记录管理、步骤记录 |
| `ChatRepository` | 聊天会话和消息管理、搜索 |
| `ExperienceRepository` | 经验卡片 CRUD、使用统计、搜索 |
| `AgentRepository` | AI 助手会话和消息管理 |

## 表结构

| 表名 | 用途 |
|------|------|
| `projects` | 动作链项目配置 |
| `executions` | 动作链执行记录 |
| `execution_steps` | 执行步骤记录（工作记忆） |
| `chat_conversations` | 聊天会话 |
| `chat_messages` | 聊天消息 |
| `experience_cards` | 经验卡片 |
| `agent_sessions` | AI 助手会话 |
| `agent_messages` | AI 助手消息 |
| `db_version` | 数据库版本号 |

## 双写模式

系统支持同时写入 JSON 文件和数据库，默认配置为**只写数据库**。

### 默认配置

```typescript
{
  enableDatabase: true,   // 启用数据库写入
  enableJsonFile: false,  // 不写入 JSON 文件
  readFromDatabase: true  // 从数据库读取
}
```

### 自定义配置

```typescript
import { setDualWriteConfig, getDualWriteConfig } from '../core/database'

// 查看当前配置
console.log(getDualWriteConfig())

// 如果需要同时写入 JSON（用于调试或回滚）
setDualWriteConfig({
  enableDatabase: true,
  enableJsonFile: true,
  readFromDatabase: true
})
```

## 完成状态

1. ~~**Phase 1**：创建数据库模块基础结构~~ ✅
2. ~~**Phase 2**：实现各 Repository（数据访问层）~~ ✅
3. ~~**Phase 3**：添加双写逻辑（JSON + DB）~~ ✅
4. **Phase 4**：数据迁移脚本（跳过，直接使用数据库存储新数据）
5. **Phase 5**：切换读取到数据库（已默认启用）
6. **Phase 6**：移除 JSON 写入（已默认禁用）
