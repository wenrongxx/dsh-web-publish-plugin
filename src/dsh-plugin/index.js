/**
 * DSH 缁勫悎鍖呮彃浠跺叆鍙ｏ紙Host 渚э級锛氭敞鍐?agent 宸ュ叿銆? *
 * DSH Loader 鐪熷疄鏈哄埗锛埪?锛夛細
 *  - export function apply(ctx) / export const inject锛屽鍑哄舰寮忎簩閫変竴涓嶆贩鐢? *  - 宸ュ叿鐢?ctx.tools.register(...) 娉ㄥ唽锛屽弬鏁颁负鎵佸钩瀵硅薄
 *    { name, description, parameters: { key: { type, required, enum, description } }, execute }
 *  - 宸ュ叿杩斿洖 { content: [{ type: 'text', text }] }
 */
import {
  CONFIG_FILE,
  SECRETS_FILE,
  loadConfig,
  saveConfig,
  validateConfig,
  deploy,
} from './deploy-core.js';

// 缁熶竴鏂囨湰 output schema锛歟xecute 杩斿洖瀛楃涓诧紝render 杞?content block
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
      '鎶?AI Agent 鍐欏ソ鐨勭綉椤碉紙鏂囦欢璺緞 -> 鍐呭锛夎嚜鍔ㄤ笂浼犲埌 GitHub 浠撳簱锛屽紑鍚?GitHub Pages锛? +
      '骞跺湪鏄庣‘鎸囧畾 customDomain 鏃剁粦瀹?Cloudflare 鑷畾涔夊煙鍚嶃€傞€傜敤浜庨儴缃查潤鎬侀〉闈€佸崟椤靛簲鐢ㄧ瓑銆?,
    output: TEXT_OUTPUT,
    parameters: {
      files: {
        type: 'object',
        required: true,
        description: '鏂囦欢鏄犲皠锛氳矾寰?-> 鏂囨湰鍐呭锛岃嚦灏戝寘鍚?index.html',
      },
      repo: {
        type: 'string',
        required: true,
        description: '鏈」鐩殑浠撳簱鍚嶏紙蹇呭～锛屾瘡涓」鐩竴涓嫭绔嬩粨搴擄紱涓嶅瓨鍦ㄤ細鑷姩鍒涘缓锛?,
      },
      branch: { type: 'string', required: false, description: '鍙戝竷鍒嗘敮锛岄粯璁?main' },
      commitMessage: { type: 'string', required: false, description: '鎻愪氦淇℃伅' },
      enablePages: {
        type: 'boolean',
        required: false,
        description: '鏄惁寮€鍚?GitHub Pages锛岄粯璁?true',
      },
      customDomain: {
        type: 'string',
        required: false,
        description:
          '鏈」鐩缁戝畾鐨勮嚜瀹氫箟鍩熷悕锛堝彲閫夛紝渚嬪 www.example.com锛夛紱浠呭湪鏄庣‘鎸囧畾鏃舵墠缁戝畾锛屼笉鎸囧畾鍒欏彧鐢?*.github.io',
      },
    },
    async execute(args) {
      try {
        const r = await deploy(args);
        return [
          `鉁?閮ㄧ讲瀹屾垚锛?{r.repoFullName}`,
          `浠撳簱锛?{r.repoUrl}`,
          `Pages锛?{r.pagesUrl}${r.pagesEnabled ? '锛堝凡寮€鍚級' : '锛堟湭寮€鍚級'}`,
          r.customDomainUrl ? `鑷畾涔夊煙鍚嶏細${r.customDomainUrl}` : '',
          `鎻愪氦锛?{r.commitSha?.slice(0, 7)}锛屾枃浠讹細${r.pushedFiles.join('銆?)}`,
          '',
          ...r.messages,
        ]
          .filter(Boolean)
          .join('\n');
      } catch (e) {
        return `鉂?閮ㄧ讲澶辫触锛?{e.message}`;
      }
    },
  });

  /* ---------------------------- configure_plugin -------------------------- */
  ctx.tools.register({
    name: 'configure_plugin',
    description: '鏌ョ湅鎴栨洿鏂?web-publish 鎻掍欢鐨勯厤缃紙GitHub/Cloudflare API key 绛夛級',
    output: TEXT_OUTPUT,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['get', 'update'],
        description: '鎿嶄綔绫诲瀷锛歡et=鏌ョ湅閰嶇疆锛寀pdate=鏇存柊閰嶇疆',
      },
      githubToken: {
        type: 'string',
        required: false,
        description: 'GitHub Personal Access Token锛坮epo + workflow 鏉冮檺锛?,
      },
      githubOwner: { type: 'string', required: false, description: 'GitHub 鐢ㄦ埛鍚?缁勭粐鍚? },
      githubBranch: { type: 'string', required: false, description: '榛樿鍒嗘敮锛堥粯璁?main锛? },
      cloudflareApiToken: {
        type: 'string',
        required: false,
        description: 'Cloudflare API Token锛圸one.DNS Edit 鏉冮檺锛?,
      },
      cloudflareZoneId: { type: 'string', required: false, description: 'Cloudflare Zone ID' },
      repoVisibility: {
        type: 'string',
        required: false,
        enum: ['public', 'private'],
        description: '鑷姩鍒涘缓浠撳簱鐨勫彲瑙佹€э紙榛樿 public锛?,
      },
    },
    async execute(args) {
      if (args.action === 'get') {
        const cfg = loadConfig();
        // 搂5锛歵oken/zoneId 涓嶅洖鏄句换浣曞瓧绗︼紝鍙姤锛堝凡璁剧疆锛?锛堟湭璁剧疆锛?        return [
          '褰撳墠閰嶇疆锛?,
          `GitHub Owner: ${cfg.github.owner ?? '锛堟湭璁剧疆锛?}`,
          `GitHub Branch: ${cfg.github.branch ?? 'main'}`,
          `GitHub Token: ${cfg.github.token ? '锛堝凡璁剧疆锛? : '锛堟湭璁剧疆锛?}`,
          `Cloudflare Zone ID: ${cfg.cloudflare.zoneId ? '锛堝凡璁剧疆锛? : '锛堟湭璁剧疆锛?}`,
          `Cloudflare API Token: ${cfg.cloudflare.apiToken ? '锛堝凡璁剧疆锛? : '锛堟湭璁剧疆锛?}`,
          `浠撳簱鍙鎬? ${cfg.repoVisibility ?? 'public'}`,
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
      return '鉁?閰嶇疆宸蹭繚瀛橈紙token 鍙繘 secrets.json锛屼笉鍐欏叆 config.json锛?;
    },
  });

  /* ---------------------------- get_plugin_status ------------------------- */
  ctx.tools.register({
    name: 'get_plugin_status',
    description: '鏌ヨ web-publish 鎻掍欢鐨勯厤缃畬鏁存€э紙涓嶅洖鏄句换浣曟満瀵嗭級',
    output: TEXT_OUTPUT,
    parameters: {},
    async execute() {
      const cfg = loadConfig();
      const missing = validateConfig(cfg);
      return [
        '鎻掍欢鐘舵€侊細',
        `閰嶇疆鏂囦欢: ${CONFIG_FILE}`,
        `鏈哄瘑鏂囦欢: ${SECRETS_FILE}`,
        `缂哄け閰嶇疆椤? ${missing.length > 0 ? missing.join('銆?) : '鏃狅紙閰嶇疆瀹屾暣锛?}`,
      ].join('\n');
    },
  });
}
