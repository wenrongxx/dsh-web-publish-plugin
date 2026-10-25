# Web Publish Plugin — DSH 插件

让 AI Agent 写的网页自动上传到 GitHub、配置 GitHub Pages，可绑定 Cloudflare 自定义域名。

## 包含的工具

| 工具 | 说明 |
|---|---|
| `publish_website` | 部署网页到 GitHub Pages。必填 `files` + `repo`，可选 `customDomain` |
| `configure_plugin` | 查看/更新配置（GitHub/Cloudflare API key） |
| `get_plugin_status` | 查询配置完整性（不回显机密） |

## 安装（DSH）

### 1. 下载并解压

从 [Release 页面](https://github.com/wenrongxx/dsh-web-publish-plugin/releases) 下载 `web-publish-plugin.zip`，解压到任意目录。

### 2. 安装到 DSH

在 DSH 对话中让 Agent 执行：

```
plugin_manager install_bundle target=<解压后的绝对路径>
```

或在 Web 侧边栏「插件」页 → 「安装」→ 选择本地目录。

### 3. 配置 API Key

创建配置文件（`~` 在 Windows 上是 `C:\Users\<用户名>`）：

- **Windows**: `C:\Users\<用户名>\.web-publish-plugin\`
- **Linux/Mac**: `~/.web-publish-plugin/`

#### `secrets.json`（机密，权限建议 600）

```json
{
  "githubToken": "ghp_xxx（repo + workflow 权限）",
  "cloudflareApiToken": "xxx（Zone.DNS Edit 权限）"
}
```

#### `config.json`（非机密）

```json
{
  "github": { "owner": "你的GitHub用户名", "branch": "main" },
  "cloudflare": { "zoneId": "你的Zone ID" },
  "repoVisibility": "public"
}
```

也可以在对话中让 Agent 用 `configure_plugin` 工具填写，无需手动编辑文件。

## 使用示例

配置完成后，直接对 Agent 说：

> 用 publish_website 部署一个网页到仓库 my-site，文件如下：
> index.html: `<h1>Hello</h1>`

Agent 会自动调用工具完成：建仓 → 上传 → 开启 Pages。

## 安全说明

- API key 仅存本地 `secrets.json`，不随插件分发
- 工具返回**永不回显** token，只显示「（已设置）/（未设置）」
- CNAME 目标锁定为 `owner.github.io`，Cloudflare DNS 记录使用灰云（`proxied: false`）
- 插件代码**无任何 DELETE 操作**，不会删除仓库或 DNS 记录

## 文件结构

```
package.json              # DSH bundle manifest
cordis.patch.yml          # Bundle patch
icon.svg                  # 插件图标
locale/en.json            # 英文语言包
locale/zh.json            # 中文语言包
config.example.json       # 配置模板
secrets.example.json      # 机密配置模板
src/dsh-plugin/index.js   # DSH 插件入口
src/dsh-plugin/deploy-core.js  # 部署核心逻辑
```

## License

MIT
