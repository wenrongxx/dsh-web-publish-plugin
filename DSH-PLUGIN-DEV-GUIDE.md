# DSH 插件开发指南

> 从零制作一个可安装的 DSH（DeepSeek Harness）组合包插件。本文件基于 `web-publish-plugin`
> 的实战开发经验整理，可直接照此流程制作新插件。

---

## 1. 核心概念

DSH 插件是 **pnpm 组合包（bundle）**——一个含 `package.json` 的包，通过 `plugin_manager`
安装到 profile，由 Cordis Loader 以纯 ESM 加载。

| 维度 | 做法 |
|---|---|
| 插件形态 | 组合包：`package.json`（含 `dsh.bundle.patch`）+ `cordis.patch.yml` |
| 入口 | `export function apply(ctx)` + `export const inject = ['tools']` |
| 工具注册 | `ctx.tools.register(definition)`（不强制用 `defineTool` 包装） |
| 安装方式 | `plugin_manager install_bundle target=<本地绝对路径>` |
| 文件语言 | **必须纯 JS**——Loader 不做 TS 编译（见 §4.1） |
| 显示元数据 | `locale/*.json` 的 `meta` + `package.json` 的 `description` + `icon.svg` |

### 关键模块（都在 app.asar 内，路径前缀 `dsh/node_modules/@deepseek-ai/`）

- `dsh-tools` — 工具注册管线（`defineTool`、JSON Schema 编译、output 渲染）
- `dsh-plugin-manager` — 插件安装/启停管理
- `cordis-plugin-loader` — Cordis Loader（config/entry/group/isolate/tree）
- `dsh-client-ui-plugin-manager` — 侧边栏「插件」页 UI

---

## 2. 目录结构（最小可用插件）

```
my-plugin/
├── package.json              # 必需：bundle manifest
├── cordis.patch.yml          # 必需：Loader patch，插入自己的行
├── icon.svg                  # 推荐：插件图标（SVG/PNG ≤256KiB）
├── locale/
│   ├── en.json               # 必需：meta.title / meta.description
│   └── zh.json               # 推荐：中文语言包
├── src/
│   └── index.js              # 插件入口（apply + 工具注册）
│   └── core.js               # 业务逻辑（纯 JS，零依赖）
├── config.example.json       # 可选：配置模板
└── secrets.example.json      # 可选：机密配置模板
```

### package.json

```json
{
  "name": "@你的用户名/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "中文描述——侧边栏 About 区域和 GitHub 都读这个字段",
  "exports": {
    ".": "./src/index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["src/**/*.js", "cordis.patch.yml", "locale/*.json", "icon.svg"]
}
```

**注意**：
- `name` 用 `@你的用户名/包名`（不要用 `@local/`——DSHX 会标记为不可安装）
- `description` 用中文——侧边栏插件页直接显示这个字段
- `files` 列出所有随包分发的文件

### cordis.patch.yml

```yaml
- insert:
    - id: my-plugin
      name: '@你的用户名/my-plugin'
      config: {}
```

### locale/zh.json

```json
{
  "meta": {
    "title": "插件显示名",
    "description": "插件描述（插件管理器工具显示这个字段）"
  }
}
```

**说明**：`locale/zh.json` 的 `meta.description` 给 `list_bundles` 工具读；
`package.json` 的 `description` 给侧边栏插件页读——**两处都要写**，内容可相同。

### icon.svg

- 格式：SVG / PNG / JPEG / WebP，≤ 256 KiB
- 必须放在包内，不支持 URL
- 侧边栏插件页和 GitHub Release 都会显示

---

## 3. 插件入口（src/index.js）

### 3.1 导出形式（二选一，不混用）

```js
// 方式 A：Host 插件（最常用）
export const inject = ['tools'];           // 声明需要的服务
export function apply(ctx) {               // 激活函数
  // ctx.services / ctx.tools / ctx.on ...
}

// 方式 B：Service 类
export default class MyPlugin { ... }
```

### 3.2 注册工具——完整签名（从 dsh-tools/lib/index.js 提取确认）

```js
ctx.tools.register({
  name: 'my_tool',                    // 工具名（全局唯一）
  description: '工具描述给模型看',
  
  parameters: {                       // 扁平参数对象（非 JSON Schema properties/required）
    files: { type: 'object', required: true,  description: '...' },
    repo:  { type: 'string', required: true,  description: '...' },
    level: { type: 'number', required: false, description: '...' },
    mode:  { type: 'string', enum: ['a', 'b'], description: '...' },
  },
  
  output: {                           // ← 必须有！缺失报错 "must declare output"
    schema: { type: 'string' },       // SCHEMA_TYPES: object/array/string/number/integer/boolean/null
    render: (args, value) => [{ type: 'text', text: value }],
    presentationMeta: (args, value) => undefined,  // 可选
  },
  
  async execute(args) {
    return '结果字符串';               // ← 返回纯值，不是 content block！
  },
});
```

**`execute` 返回值规则**：
- **返回纯值**（如字符串、JSON 对象），与 `output.schema` 匹配
- `output.render(args, value)` 负责把纯值转成 `[{ type: 'text', text: value }]`
- 错误直接 `throw new Error(msg)`，DSH 自动包装成 `isError: true`
- 也可返回 `{ isError: true }` 标记非致命错误

**与 `defineTool` 的关系**：`defineTool`（来自 `@deepseek-ai/dsh-tools`）是可选的包装器，
做参数校验、schema 编译、finalize/preview 等。不用它时 `ctx.tools.register` 直接收裸对象，
但 `output` 字段要求相同。

### 3.3 简单工具模板（文本输出）

```js
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register({
    name: 'hello',
    description: 'Say hello',
    parameters: { name: { type: 'string', required: true, description: 'Whom to greet' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`;
    },
  });
}
```

---

## 4. 三大陷阱（实战踩坑，必读）

### 4.1 DSH Loader 不解析 TypeScript ❌

Loader 以纯 ESM 加载 `.js` 文件，**不会**执行 TS 编译或类型擦除：

```js
// ❌ 会报 ERR_MODULE_NOT_FOUND（哪怕只是 import type）
import { loadConfig } from '../shared/config.js';   // 实际文件是 config.ts
import type { Config } from './types.js';            // type-only 导入也会报错！

// ✅ 解决方案：把所有逻辑合并成一个零依赖的纯 JS 文件
// src/core.js —— config/github/cloudflare/deploy 全在这里
export function loadConfig() { /* ... */ }
export async function deploy(req) { /* ... */ }
```

**不要** import `@deepseek-ai/dsh-tools`——它不在插件运行时的解析路径上，会报
`Cannot find package`。直接用 `ctx.tools.register(裸对象)` 即可。

### 4.2 工具缺 output 字段 ❌

```
TypeError: tool "xxx" must declare output { schema, render, presentationMeta? }
```

**每个** `ctx.tools.register` 调用都必须带 `output`（见 §3.2）。

### 4.3 execute 返回 content block ❌

`execute` 返回的值会先经 `output.schema` 校验，再经 `output.render` 转换：

```js
// ❌ execute 返回 content block（schema 校验失败）
async execute() { return { content: [{ type: 'text', text: 'hi' }] }; }

// ✅ execute 返回纯值
async execute() { return 'hi'; }
```

---

## 5. 显示元数据（侧边栏 About）

侧边栏「插件」页 About 区域显示 `package.json` 的 `description`（安装时快照）。
**如果 About 显示乱码，说明创建仓库时用 PowerShell 上传把 UTF-8 双重编码了**——
必须用 Python `urllib` 传原始字节修复（PowerShell 的 `Invoke-RestMethod -ContentType`
对中文会做双重编码）。

| 显示位置 | 数据来源 |
|---|---|
| 侧边栏插件页 About | `package.json` 的 `description` |
| `list_bundles` 工具输出 | `locale/zh.json` 的 `meta.description` |
| 侧边栏插件页图标 | `icon.svg`（或 `package.json` 顶层 `icon` 字段） |
| GitHub 仓库描述 | 仓库创建/修改时的 `description` 参数 |

---

## 6. 安装与验证

### 安装

```bash
# 用 plugin_manager 工具（推荐）
plugin_manager install_bundle target=<插件目录绝对路径>

# 更新（先删再装）
plugin_manager remove_bundle target=@用户名/包名
plugin_manager install_bundle target=<插件目录绝对路径>
```

安装结果 `application: "applied"` + `warnings: []` = 成功。

### 验证

```bash
# 1. 检查 bundle 是否安装
plugin_manager list_bundles

# 2. 检查工具是否注册
cordis_inspect_query platform=host provider=Tool method=listTools

# 3. 本地测试业务逻辑（不经过 DSH）
node -e "import('./src/core.js').then(async m => { console.log(await m.myFunc()); })"
```

### `install_bundle` 常见失败

| 错误 | 原因 | 解决 |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: config.js` | import 了 `.ts` 的 `.js` 后缀 | 改成纯 JS（§4.1） |
| `Cannot find package '@deepseek-ai/dsh-tools'` | import 了 dsh-tools | 删掉 import，直接用 `ctx.tools.register` |
| `must declare output { schema, render }` | 工具缺 output | 补上 `output` 字段（§4.2） |
| `already-installed` | 重复安装 | 先 `remove_bundle` 再 `install_bundle` |
| `EPERM: rename package.json` | profile 目录被锁 | 重试或修复权限 |

---

## 7. 探查 DSH SDK 的工具（写新插件前必看）

DSH 内部接口没有公开文档，需要从 `app.asar` 提取源码：

```bash
# 列出 asar 内全部文件（按关键词过滤）
node inspect_asar.cjs

# 提取单个文件——⚠️ 只截取前 4000 字节！
node asarextract.cjs "dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"

# 全量提取（长文件必须用这个）
node asarextract_full.cjs "dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js" output.txt
```

**常用 asar 内路径**（前缀 `dsh/node_modules/@deepseek-ai/`）：

| 模块 | 用途 |
|---|---|
| `dsh-tools/lib/index.js` | 工具注册、output schema、execute/render 管线 |
| `dsh-plugin-manager/lib/types/tools.js` | plugin_manager 工具定义（参考写法） |
| `dsh-plugin-market/lib/types/tools.js` | plugin_market 工具定义（参考写法） |
| `dsh-client-ui-plugin-manager/lib/client.js` | 侧边栏插件页 UI 源码 |
| `dsh-client-ui-plugin-manager/locale/zh.json` | 插件页 UI 中文语言包 |

**insight inspect 也可以**：

```bash
cordis_inspect_query platform=host provider=Tool method=listTools
cordis_inspect_query platform=host provider=Service method=listService
cordis_inspect_query platform=host provider=Config method=listConfigs
```

---

## 8. 分享与发布

### 8.1 打包 ZIP

```python
import zipfile
files = ['package.json', 'cordis.patch.yml', 'icon.svg', 'README.md',
         'locale/en.json', 'locale/zh.json',
         'src/index.js', 'src/core.js',
         'config.example.json', 'secrets.example.json']
with zipfile.ZipFile('plugin.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in files:
        zf.writestr(f, open(f, 'rb').read())
```

**机密检查**：确认 `config.example.json` / `secrets.example.json` 只含占位符，
`.gitignore` 排除 `secrets.json`、`.env`、密钥文件。

### 8.2 上传到 GitHub（⚠️ 编码陷阱）

**PowerShell 的 `Invoke-RestMethod` 会把中文双重编码**——用 Python `urllib` 传原始字节：

```python
import urllib.request, json, base64
pat = json.load(open(r'C:\Users\<你>\.web-publish-plugin\secrets.json'))['githubToken']
content = open('file.js', 'rb').read()  # 读原始字节，不要 text
body = json.dumps({'message': 'add file', 'content': base64.b64encode(content).decode(), 'sha': sha})
req = urllib.request.Request(url, method='PUT', data=body.encode('utf-8'),
    headers={'Authorization': f'Bearer {pat}', 'Content-Type': 'application/json'})
```

### 8.3 创建 Release + 上传资产

```python
# 1. 创建 release
body = json.dumps({'tag_name': 'v1.0.0', 'name': 'v1.0.0', 'body': '描述'})
req = urllib.request.Request('https://api.github.com/repos/<owner>/<repo>/releases',
    method='POST', data=body.encode('utf-8'),
    headers={'Authorization': f'Bearer {pat}', 'Content-Type': 'application/json'})
rel = json.load(urllib.request.urlopen(req))

# 2. 上传 zip（multipart）
boundary = '----WebKitFormBoundary...'
body = (f'--{boundary}\r\nContent-Disposition: form-data; name="asset"; '
        f'filename="plugin.zip"\r\nContent-Type: application/zip\r\n\r\n').encode()
body += zip_bytes + f'\r\n--{boundary}--\r\n'.encode()
req = urllib.request.Request(f'https://uploads.github.com/repos/<owner>/<repo>/releases/'
    f'{rel["id"]}/assets?name=plugin.zip', method='POST', data=body,
    headers={'Authorization': f'Bearer {pat}',
             'Content-Type': f'multipart/form-data; boundary={boundary}'})
```

---

## 9. 安全边界（制作时要遵守）

1. **API key 永不写入仓库/ZIP**——只进本地 `secrets.json`（0600 权限）
2. **工具返回永不回显 token**——只显示「（已设置）/（未设置）」
3. **不写 DELETE 操作**——插件不应有删除仓库/DNS 记录的能力
4. **危险操作加防御校验**——如 CNAME 不能指向自身、目标必须是白名单主机
5. **执行前校验配置完整性**——`validateConfig` 缺项时报错，不静默失败

---

## 10. 完整实战参考

`web-publish-plugin`（本仓库 `O:\Deepseek-harness\web_plugin`）覆盖了以上全部要点：

| 文件 | 对应章节 |
|---|---|
| `package.json` + `cordis.patch.yml` | §2 |
| `src/dsh-plugin/index.js`（工具注册） | §3 |
| `src/dsh-plugin/deploy-core.js`（纯 JS 业务） | §4.1 |
| `locale/zh.json` + `icon.svg` | §5 |
| `inspect_asar.cjs` / `asarextract.cjs` / `asarextract_full.cjs` | §7 |
| `HANDOFF.md` | 项目历史与踩坑记录 |
| GitHub: `wenrongxx/dsh-web-publish-plugin` | §8 |
