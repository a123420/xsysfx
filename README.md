# 像素陨石防线

像素风格飞行射击小游戏。支持**游客本地游玩**，也可启动后端后**注册登录、上传战绩、查看全球排行榜、云同步成就**。

## 快速开始

需要已安装 [Node.js](https://nodejs.org/) 18 或更高版本。

```bash
cd xsysfx
npm install
npm start
```

浏览器打开：http://localhost:3000

默认端口为 `3000`，可用环境变量修改：

```bash
set PORT=8080
npm start
```

## 功能

### 游戏（前端）

- WASD 移动，鼠标瞄准，空格 / 左键射击
- 三种难度：简单 / 标准 / 困难（得分倍率不同）
- 装备掉落：连发枪、穿透弹、护盾、加速、散弹、激光、回血
- 双 BOSS、陨石潮、连击倍率、23 项成就
- 每日任务（北京时间 0 点刷新）、帮助图鉴、背景音乐
- 未登录时最高分 / 成就 / 任务进度保存在浏览器 LocalStorage

### 账号与云存档（后端）

- 注册 / 登录 / 退出 / 修改密码（会话 Token，7 天有效）
- 每局结束自动上传分数、难度、存活、击毁、连击、BOSS 战绩
- 全球排行榜：总榜 / 本周，可按难度筛选；同一账号只保留最高分
- 称号随最高分与成就提升（新兵 → 星际王牌）
- 个人战绩历史、修改昵称、每日任务云同步

## 项目结构

```
xsysfx/
├── server/
│   ├── index.js      # Express 接口与静态资源
│   └── db.js         # JSON 文件存储（账号 / 分数 / 会话）
├── public/
│   ├── index.html    # 游戏页面
│   └── js/client.js  # 登录、排行榜、战绩上传
├── data/
│   └── store.json    # 运行后自动生成的数据文件
├── package.json
└── 像素陨石防线.html  # 纯单机版（不连服务器）
```

## 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务探活 |
| GET | `/api/stats` | 玩家数 / 对局数 / 最高分 |
| GET | `/api/content` | 简报与当日任务 |
| GET | `/api/leaderboard` | 排行榜 `?period=all\|week&difficulty=` |
| PUT | `/api/me/password` | 修改密码 `{ oldPassword, newPassword }` |
| POST | `/api/auth/register` | 注册 `{ username, password, nickname? }` |
| POST | `/api/auth/login` | 登录 `{ username, password }` |
| POST | `/api/auth/logout` | 退出（需登录） |
| GET | `/api/auth/me` | 当前用户与近期战绩 |
| PUT | `/api/me/profile` | 修改昵称 |
| PUT | `/api/me/cloud` | 同步成就与累计数据 |
| POST | `/api/scores` | 提交本局成绩 |
| GET | `/api/me/history` | 个人历史对局 |

登录成功后，请求头携带：`Authorization: Bearer <token>`。

## 单机版

不想装 Node 时，可直接双击打开 `像素陨石防线.html`。该文件不包含排行榜与账号功能。

## 数据说明

- 服务端数据保存在 `data/store.json`，无需单独安装数据库
- 密码使用 Node 内置 `scrypt` 加盐哈希，不会明文存储
- 删除 `data/store.json` 即清空所有账号与排行榜
