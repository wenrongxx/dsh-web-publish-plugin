# 交接文档 — web-publish-plugin → DSH 插件（已完成）

> 本文件保存了**完整上下文**和**踩坑记录**，供后续维护参考。
> DSH 插件已完成安装并验证（见 §6）。
>
> **制作新 DSH 插件请先读 [`DSH-PLUGIN-DEV-GUIDE.md`](DSH-PLUGIN-DEV-GUIDE.md)**——
> 从目录结构、工具注册签名、三大陷阱到发布流程的完整方法总结。

---

## 0. 一句话目标

做一个插件，让 **AI Agent 写的网页自动上传到 GitHub、配置 GitHub Pages**，并可在设置里填 **GitHub / Cloudflare 的 API key**（Cloudflare 用于绑定自定义域名）。

**MCP 服务器形态**：已部署在内网 LXC，workbuddy 已接入。
**DSH 客户端插件形态**：✅ 已完成并安装到当前 profile。

---

## 1. 已交付 / 已部署（不要重复做）

### 1.1 部署核心（可复用，与形态无关）—— `src/core/` + `src/shared/`

| 文件 | 导出 | 作用 |
|---|---|---|
| `src/shared/types.ts` | `PluginConfig` `DeployRequest` `DeployResult` 等 | 类型定义 |
| `src/shared/config.ts` | `loadConfig` `saveConfig` `validateConfig` `CONFIG_FILE` `SECRETS_FILE` | 配置加载/保存（环境变量 > secrets.json > config.json） |
| `src/core/github.ts` | `ensureRepo` `pushFiles` `enablePages` | GitHub：建仓 / Git Data API 原子提交 / 开 GitHub Pages |
| `src/core/cloudflare.ts` | `configureCustomDomain` `cnameFileContent` | Cloudflare DNS CNAME 绑定（橙云代理） |
| `src/core/deploy.ts` | `deploy` | 编排：push → Pages → 域名 |

**这些是纯逻辑模块，DSH 插件可直接复用**，只需换掉「入口/工具注册」这一层。

### 1.2 MCP 服务器（已完成、已验证、已部署）—— `src/mcp-server/index.ts`

- **端点**：`https://mcp.wenrongxx.top/web-publish/mcp`（streamable-HTTP）
- **传输**：支持 stdio（默认）和 `--http <port> --prefix <name>`（streamable-HTTP）
- **3 个工具**：`publish_website`、`configure_plugin`、`get_plugin_status`
- **已部署到内网 LXC**（见 §3）
- workbuddy 的 `C:\Users\wenrongxx\.workbuddy\mcp.json` 已配置接入

### 1.3 DSH 插件（✅ 已完成、已安装、已验证）—— `src/dsh-plugin/`

**DSH 插件已成功安装并验证**。最终文件结构：

| 文件 | 说明 |
|---|---|
| `src/dsh-plugin/index.js` | Host 插件入口，注册 3 个工具（`publish_website`/`configure_plugin`/`get_plugin_status`） |
| `src/dsh-plugin/deploy-core.js` | 部署核心纯 JS 版（合并了 config/github/cloudflare/deploy 逻辑，零依赖） |
| `package.json` | `dsh.bundle.patch` 指向 `cordis.patch.yml` |
| `cordis.patch.yml` | Bundle patch，插入 `web-publish-plugin` 行 |
| `locale/en.json`、`locale/zh.json`、`icon.svg` | 显示资源 |

**验证结果**：`install_bundle` 返回 `application: "applied"`；`Tool.listTools` 确认 3 个工具全部注册。

**关键教训（详见 §2.5）**：
- DSH 工具必须声明 `output: { schema, render, presentationMeta? }`，`execute` 返回**纯值**（非 content block）
- DSH Loader **不能解析 TS 文件**，bundle 的入口必须是纯 JS（`.js`），不能 import `.ts`
- `asarextract.cjs` 只截取前 4000 字节，长文件要用 `asarextract_full.cjs` 全量提取

---

## 2. DSH 插件真实机制（本次会话探查 `app.asar` 的结论）

DSH 有一套**内部插件框架**，和最初猜的完全不同。已探明的事实：

### 2.1 核心结论：DSH 插件是「pnpm 组合包(bundle)」

| 维度 | DSH 真实做法 |
|---|---|
| 插件形态 | **组合包 bundle**，一个含 `package.json` 的包 |
| 工具注册 | `defineTool({...})` from **`@deepseek-ai/dsh-tools`**，再 `ctx.tools.register(...)` |
| 安装方式 | 通过 **`plugin_manager` 工具** 或 Web 侧边栏「插件」页安装；spec 支持 **git / tarball / registry 包名 / `link:<绝对路径>`** |
| 声明入口 | profile 的 `package.json` 里 `dsh.profile.bundles` 有序列表 |
| 启停 | 改 `cordis.patch.yml` 里条目的 `disabled`；开启 HMR 时即时生效 |
| 沙箱 | 工具操作要求 `danger-full-access` 或**逐次用户批准**；`ask` 模式会请求审批 |

### 2.2 关键模块（都在 `app.asar` 里，路径前缀 `dsh/node_modules/@deepseek-ai/`）

- `dsh-plugin-manager` —— 插件管理器（**README.zh.md 是最权威文档**，含安装/组合包/profile patch 全说明）
- `dsh-plugin-market` —— 插件市场（`list_indexes`/`list_plugins`/`list_versions` 工具）
- `cordis-plugin-loader` —— 插件 Loader（cordis 框架，config/entry/group/isolate/tree）
- `dsh-plugin-package-inventory-deepseek` —— 活跃插件包清单（模型不可见）
- `dsh/lib/plugin-*.js` —— 插件加载器入口

**注意**：`@deepseek-ai/dsh-tools`（`defineTool` 所在）**不在 app.asar 里**，是插件运行时才解析的依赖——组合包要自己声明依赖它。

### 2.3 工具定义的真实样子（摘自 `dsh-plugin-market/lib/types/tools.js`）

```js
import { defineTool } from '@deepseek-ai/dsh-tools';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.inject(['pluginMarket'], (scope) => { registerTool(scope); });
}
function registerTool(ctx) {
  ctx.tools.register(defineTool({
    name: 'plugin_market',
    description: '...',
    parameters: {
      action: { type: 'string', required: true, enum: [...], description: '...' },
      // ... 扁平 parameters，每个 { type, required, enum, description }
    },
    // apply/execute 里做实际逻辑
  }));
}
```

要点：**工具是 `defineTool({name, description, parameters})`，parameters 是扁平对象**（不是 JSON Schema 的 `properties/required`）。

⚠️ **重要补充（本轮从 dsh-tools/lib/index.js 全量提取确认）**：工具定义还必须包含 `output` 字段，否则报错 `"must declare output { schema, render, presentationMeta? }"`。

### 2.5 工具注册的完整真实签名

```
ctx.tools.register(definition) 要求 definition 包含：
{
  name: string,
  description: string,
  parameters: { key: { type, required?, enum?, description } },
  output: {                    // ← 必须有！
    schema: { type: 'string' },  // string/number/integer/boolean/null/array/object
    render: (args, value) => [{ type: 'text', text: value }],
    presentationMeta?: (args, value) => ...,  // 可选
  },
  async execute(args) {         // 返回纯值（字符串），不是 content block
    return '结果文本';
  },
}
```

**关键点**：
- `execute` 返回**纯值**，`output.render` 负责转 content block
- `output.schema.type` 必须在 SCHEMA_TYPES 内
- `defineTool()` 把 output 放在 `options.output` 里

### 2.6 DSH Loader 不能解析 TS 文件

DSH Loader 以纯 ESM 加载 bundle 的 JS 文件。如果 `index.js` 里 `import ... from '../shared/config.js'` 而实际文件是 `config.ts`，会报 `ERR_MODULE_NOT_FOUND`。`import type { ... }` 的 type-only 导入也会报错，因为 Loader 不执行 TS 编译。

**解决方案**：把所有逻辑合并成一个零依赖的纯 JS 文件（如 `deploy-core.js`）。

### 2.7 探查工具（可复用）

工作区里的 `inspect_asar.cjs` / `asarextract.cjs` 可列出并提取 `app.asar` 内文件内容，用于查 SDK 真实签名：

```bash
node inspect_asar.cjs            # 列出 asar 内全部文件（按关键词过滤）
node asarextract.cjs "<asar内路径>" # 提取某个文件的源码（只取前 4000 字节！）
node asarextract_full.cjs "<asar内路径>" [输出文件]  # 全量提取，不限长度
```

⚠️ `asarextract.cjs` 只截取前 4000 字节——长文件（如 `dsh-tools/lib/index.js` 有 16 万字符）必须用 `asarextract_full.cjs`。

### 2.8 `asarextract_full.cjs`（本轮新增，可复用）

完整提取版 `asarextract.cjs`，支持输出到文件：

```bash
node asarextract_full.cjs "dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js" dsh-tools-full.js
```

---

## 3. 已部署的 LXC 环境（MCP 服务器跑在这）

| 项 | 值 |
|---|---|
| 主机 | 内网 LXC，`192.168.1.31`，Debian 12，hostname `mcp` |
| 配置 | 1 vCPU / 256MB RAM / 2GB 磁盘（服务实测占 45MB） |
| SSH | `ssh -i "O:\Deepseek-harness\web_plugin\keys\deploykey" root@192.168.1.31` |
| Node | v20.18.1（`/opt/node/...`，已 symlink 到 `/usr/local/bin`） |
| 服务 | `web-publish-mcp.service`（systemd 常驻 + 开机自启） |
| 代码 | `/opt/web-publish-plugin`（`npm run build` → `dist/`） |
| 配置文件 | `/etc/web-publish-plugin/{config,secrets}.json`（`/root/.web-publish-plugin/` 下是符号链接） |
| nginx | 1.22，反代 `mcp.wenrongxx.top:443` → `127.0.0.1:8931` |
| TLS | Let's Encrypt 真证书（DNS-01 验证，Cloudflare token 自动加 TXT），到期 2027-01-22，自动续期 |
| 域名 | `https://mcp.wenrongxx.top/web-publish/mcp`（DNS 已解析到 192.168.1.31） |

### LXC 环境的坑（已踩过，别重复踩）
1. **代理 MITM**：出网走内网代理 `192.168.2.1`，需装其 CA 证书到系统信任（已装 `/usr/local/share/ca-certificates/proxy.crt`）。
2. **下载源**：代理挡了 `github.com` release 和 `nodejs.org` 主包；**国内镜像（npmmirror/aliyun/tuna）畅通**。Node 从 `cdn.npmmirror.com/binaries/node/` 下载。
3. **apt 慢**：换清华源 `mirrors.tuna.tsinghua.edu.cn`。
4. **PowerShell 传脚本坑**：`Get-Content | ssh` 管道会破坏 Python 缩进；用 **scp 传文件**再执行。
5. **PowerShell 变量坑**：`$opts = '-o A -o B'` 再 `ssh $opts` 会被拆坏；**每个 ssh/scp 命令写完整显式参数**。

---

## 4. 项目配置语义（已定，别改回去）

- **`repo`（仓库名）= 必填**。每个项目一个独立仓库，不传就报错，绝不兜底到默认仓库。
- **`customDomain`（自定义域名）= 可选，但只认调用时明确传的那个**。不传就只用 `*.github.io`，不从配置兜底。
- **配置里的默认 `repo` / `customDomain` / `autoConfigureDomain` 开关已删除**（避免误导）。
- config.json 现在只有：`github.owner`、`github.branch`、`cloudflare.zoneId`、`repoVisibility`；token 在 secrets.json。

### 4.1 部署核心已定的关键行为（`src/core/`，别改回去）

- **CNAME 目标恒为 `owner.github.io`**（`deploy.ts` 里 `pagesHost = \`\${cfg.github.owner.toLowerCase()}.github.io\``）。
  ⚠️ **踩过的坑**：绝不能用 `enablePages` 返回的 `pages.url` 当 CNAME 目标——仓库已绑定自定义域名时它返回域名本身，会导致 `CNAME content cannot reference itself`。
- **Cloudflare DNS 记录用 `proxied: false`（灰云，仅 DNS 解析）**，不走 Cloudflare 代理（用户明确要求）。
- **`cloudflare.ts` 有两道防御校验**：CNAME 目标不能等于域名自身、必须是 `.github.io` 主机；目标清洗为纯主机名（去协议/路径/端口）。
- `configureDomain` 开关已废弃，`customDomain` 传了才绑域名、不传只用 `*.github.io`。

## 5. 安全边界（已定，别改回去）

- **API Key 客户端永远看不到**：存 LXC 的 `secrets.json`（0600），只在服务端拼进 HTTPS 请求头发给 GitHub/Cloudflare。
- **`get_plugin_status` 只显示「（已设置）/（未设置）」**，token 和 zoneId 一个字符都不回显（曾泄露首尾 4 位 + 完整 zoneId，已堵）。
- config.json 保存时主动删 token；机密只进 secrets.json。
- **遗留口子**：MCP 端点目前无鉴权（内网任何人可调用）。可选加固：加 Bearer token。

---

## 6. ✅ DSH 插件已完成（本轮会话交付）

DSH 插件已成功安装并验证。最终实现要点：

### 6.1 文件结构
- `src/dsh-plugin/index.js` — Host 插件入口，`export const inject = ['tools']` + `export function apply(ctx)`
- `src/dsh-plugin/deploy-core.js` — 纯 JS 部署核心（合并 config/github/cloudflare/deploy，零依赖）
- `package.json` — `dsh.bundle.patch` 指向 `cordis.patch.yml`
- `cordis.patch.yml` — bundle patch
- `locale/en.json`、`locale/zh.json`、`icon.svg`

### 6.2 工具注册方式
```js
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register({
    name: 'publish_website',
    description: '...',
    output: TEXT_OUTPUT,  // { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
    parameters: { files: { type: 'object', required: true, description: '...' }, ... },
    async execute(args) {
      return '结果字符串';  // 返回纯值，render 转 content block
    },
  });
}
```

### 6.3 关键教训（避免重蹈覆辙）

| 陷阱 | 解决方案 |
|---|---|
| DSH Loader 不解析 TS（`ERR_MODULE_NOT_FOUND`） | 所有逻辑合并到 `deploy-core.js` 纯 JS 文件 |
| 工具缺 `output` 字段（`"must declare output"`） | 每个工具必须有 `output: { schema, render }` |
| `execute` 返回 `{ content: [...] }` | `execute` 返回纯值（字符串），`render` 负责转 content block |
| `asarextract.cjs` 截取 4000 字节 | 用 `asarextract_full.cjs` 全量提取 |
| `import type { ... } from './types.js'` 在 Loader 里报错 | type-only 导入也会报错，Loader 不执行 TS 编译 |
| `@deepseek-ai/dsh-tools` 不在 app.asar 里 | 不 import 它，直接用 `ctx.tools.register()` |

### 6.4 安装命令
```bash
plugin_manager install_bundle target=O:\Deepseek-harness\web_plugin
# 如需更新：先 remove_bundle，再 install_bundle
```

---

## 7. web-publish MCP 已修复的客户端兼容问题（重要）

部分 MCP 客户端连接后会调用 `prompts/list`、`resources/list`，若服务器返回 `Method not found`（-32601），客户端会认为服务器异常而**丢弃工具、界面不显示**。

**修复（`src/mcp-server/index.ts` 的 `createServer`）**：
- `server.server.registerCapabilities({ prompts: {}, resources: {} })` 声明能力
- `setRequestHandler(ListPromptsRequestSchema, ...)` 等注册 `prompts/list`、`resources/list`、`resources/templates/list`，**一律返回空数组**而非 Method not found

**验证方法**：调用 `initialize` → `prompts/list` → `resources/list` → `tools/list`，全部应返回 200（空列表），tools 应列出 3 个工具。

**已知**：web-publish 服务端已验证完全正常（端点 49ms 响应、能力齐全、Marvis 等客户端功能 OK）。若某客户端仍不显示，是该客户端识别远程 MCP 的问题，非服务端问题。

## 8. 现场状态快照

- 工作区：`O:\Deepseek-harness\web_plugin`
- MCP 服务：**运行中**，已验证全链路（init/tools/call 全通、CNAME 绑定正确、token 零泄露）
- web-publish MCP 服务端已修复两类 bug：CNAME 指向自身（bug）、prompts/resources 返回 Method not found（客户端兼容）
- Cloudflare 域名绑定链路已实测成功（CNAME → owner.github.io，灰云）
- workbuddy：已接入 MCP（`mcp.json`），功能正常
- **DSH 插件：✅ 已完成并安装**。`install_bundle` 返回 `application: "applied"`，`Tool.listTools` 确认 3 个工具（`publish_website`/`configure_plugin`/`get_plugin_status`）全部注册。`plugin.json` 已删除，改用 `package.json` + `cordis.patch.yml`。
- 探查脚本（`inspect_asar.cjs`/`asarextract.cjs`/`asarextract_full.cjs`/`verify_*.py`/`mcp_probe.py` 等）留在工作区可复用
