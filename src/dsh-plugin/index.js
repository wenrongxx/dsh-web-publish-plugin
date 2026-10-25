/**
 * DSH 组合包插件入口（Host 侧）：注册 agent 工具。
 *
 * DSH Loader 真实机制（§2）：
 *  - export function apply(ctx) / export const inject，导出形式二选一不混用
 *  - 工具用 ctx.tools.register(...) 注册，参数为扁平对象
 *    { name, description, parameters: { key: { type, required, enum, description } }, execute }
 *  - 工具返回 { content: [{ type: 'text', text }] }
 */
import {
  CONFIG_FILE,
  SECRETS_FILE,
  loadConfig,
  saveConfig,
  validateConfig,
  deploy,
} from './deploy-core.js';

// 统一文本 output schema：execute 返回字符串，render 转 content block
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
};

export const inject = ['tools'];

export function apply(ctx) {
  /* ---------------------------- publish_website --------------------------- */
  ctx.tools.register({
    name: 'publish_website',
    description:
      '把 AI Agent 写好的网页（文件路径 -> 内容）自动上传到 GitHub 仓库，开启 GitHub Pages，' +
      '并在明确指定 customDomain 时绑定 Cloudflare 自定义域名。适用于部署静态页面、单页应用等。',
    output: TEXT_OUTPUT,
    parameters: {
      files: {
        type: 'object',
        required: true,
        description: '文件映射：路径 -> 文本内容，至少包含 index.html',
      },
      repo: {
        type: 'string',
        required: true,
        description: '本项目的仓库名（必填，每个项目一个独立仓库；不存在会自动创建）',
      },
      branch: { type: 'string', required: false, description: '发布分支，默认 main' },
      commitMessage: { type: 'string', required: false, description: '提交信息' },
      enablePages: {
        type: 'boolean',
        required: false,
        description: '是否开启 GitHub Pages，默认 true',
      },
      customDomain: {
        type: 'string',
        required: false,
        description:
          '本项目要绑定的自定义域名（可选，例如 www.example.com）；仅在明确指定时才绑定，不指定则只用 *.github.io',
      },
    },
    async execute(args) {
      try {
        const r = await deploy(args);
        return [
          `✅ 部署完成：${r.repoFullName}`,
          `仓库：${r.repoUrl}`,
          `Pages：${r.pagesUrl}${r.pagesEnabled ? '（已开启）' : '（未开启）'}`,
          r.customDomainUrl ? `自定义域名：${r.customDomainUrl}` : '',
          `提交：${r.commitSha?.slice(0, 7)}，文件：${r.pushedFiles.join('、')}`,
          '',
          ...r.messages,
        ]
          .filter(Boolean)
          .join('\n');
      } catch (e) {
        return `❌ 部署失败：${e.message}`;
      }
    },
  });

  /* ---------------------------- configure_plugin -------------------------- */
  ctx.tools.register({
    name: 'configure_plugin',
    description: '查看或更新 web-publish 插件的配置（GitHub/Cloudflare API key 等）',
    output: TEXT_OUTPUT,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['get', 'update'],
        description: '操作类型：get=查看配置，update=更新配置',
      },
      githubToken: {
        type: 'string',
        required: false,
        description: 'GitHub Personal Access Token（repo + workflow 权限）',
      },
      githubOwner: { type: 'string', required: false, description: 'GitHub 用户名/组织名' },
      githubBranch: { type: 'string', required: false, description: '默认分支（默认 main）' },
      cloudflareApiToken: {
        type: 'string',
        required: false,
        description: 'Cloudflare API Token（Zone.DNS Edit 权限）',
      },
      cloudflareZoneId: { type: 'string', required: false, description: 'Cloudflare Zone ID' },
      repoVisibility: {
        type: 'string',
        required: false,
        enum: ['public', 'private'],
        description: '自动创建仓库的可见性（默认 public）',
      },
    },
    async execute(args) {
      if (args.action === 'get') {
        const cfg = loadConfig();
        // §5：token/zoneId 不回显任何字符，只报（已设置）/（未设置）
        return [
          '当前配置：',
          `GitHub Owner: ${cfg.github.owner ?? '（未设置）'}`,
          `GitHub Branch: ${cfg.github.branch ?? 'main'}`,
          `GitHub Token: ${cfg.github.token ? '（已设置）' : '（未设置）'}`,
          `Cloudflare Zone ID: ${cfg.cloudflare.zoneId ? '（已设置）' : '（未设置）'}`,
          `Cloudflare API Token: ${cfg.cloudflare.apiToken ? '（已设置）' : '（未设置）'}`,
          `仓库可见性: ${cfg.repoVisibility ?? 'public'}`,
        ].join('\n');
      }

      saveConfig({
        config: {
          github: {
            owner: args.githubOwner || undefined,
            branch: args.githubBranch || undefined,
          },
          cloudflare: {
            zoneId: args.cloudflareZoneId || undefined,
          },
          repoVisibility: args.repoVisibility || undefined,
        },
        secrets: {
          githubToken: args.githubToken || undefined,
          cloudflareApiToken: args.cloudflareApiToken || undefined,
        },
      });
      return '✅ 配置已保存（token 只进 secrets.json，不写入 config.json）';
    },
  });

  /* ---------------------------- get_plugin_status ------------------------- */
  ctx.tools.register({
    name: 'get_plugin_status',
    description: '查询 web-publish 插件的配置完整性（不回显任何机密）',
    output: TEXT_OUTPUT,
    parameters: {},
    async execute() {
      const cfg = loadConfig();
      const missing = validateConfig(cfg);
      return [
        '插件状态：',
        `配置文件: ${CONFIG_FILE}`,
        `机密文件: ${SECRETS_FILE}`,
        `缺失配置项: ${missing.length > 0 ? missing.join('、') : '无（配置完整）'}`,
      ].join('\n');
    },
  });
}
