/**
 * DSH 插件内部部署核心：与 src/core/ + src/shared/ 的 TypeScript 逻辑一致
 * （CNAME 目标恒为 owner.github.io、Cloudflare 灰云 proxied:false 等 §4.1 语义不变）。
 * DSH Loader 以纯 ESM 加载插件，无法解析 TS 跨文件的 .js 指向，故此文件将
 * config / github / cloudflare / deploy 合并为零依赖的纯 JS 模块。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* ============================== shared/config ============================== */

export const CONFIG_DIR = path.join(os.homedir(), '.web-publish-plugin');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const SECRETS_FILE = path.join(CONFIG_DIR, 'secrets.json');

function readJson(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    throw new Error(`配置文件解析失败 ${file}: ${e.message}`);
  }
  return {};
}

/** 优先级：环境变量 > secrets.json > config.json */
export function loadConfig() {
  const fileCfg = readJson(CONFIG_FILE);
  const secrets = readJson(SECRETS_FILE);
  const env = process.env;
  return {
    github: {
      token: env.GITHUB_TOKEN || secrets.githubToken || fileCfg.github?.token,
      owner: env.GITHUB_OWNER || fileCfg.github?.owner,
      repo: env.GITHUB_REPO || fileCfg.github?.repo,
      branch: env.GITHUB_BRANCH || fileCfg.github?.branch || 'main',
    },
    cloudflare: {
      apiToken:
        env.CLOUDFLARE_API_TOKEN ||
        secrets.cloudflareApiToken ||
        fileCfg.cloudflare?.apiToken,
      zoneId: env.CLOUDFLARE_ZONE_ID || fileCfg.cloudflare?.zoneId,
      customDomain: env.CUSTOM_DOMAIN || fileCfg.cloudflare?.customDomain,
    },
    autoConfigureDomain: fileCfg.autoConfigureDomain ?? true,
    repoVisibility: fileCfg.repoVisibility ?? 'public',
  };
}

/** 非机密写 config.json；机密写 secrets.json（0600）。token/apiToken 永不进 config.json */
export function saveConfig(patch) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  if (patch.config) {
    const existing = readJson(CONFIG_FILE);
    const merged = {
      github: { ...existing.github, ...patch.config.github },
      cloudflare: { ...existing.cloudflare, ...patch.config.cloudflare },
      autoConfigureDomain:
        patch.config.autoConfigureDomain ?? existing.autoConfigureDomain ?? true,
      repoVisibility:
        patch.config.repoVisibility ?? existing.repoVisibility ?? 'public',
    };
    delete merged.github.token;
    delete merged.cloudflare.apiToken;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  }

  if (patch.secrets) {
    const existing = readJson(SECRETS_FILE);
    const merged = {
      githubToken: patch.secrets.githubToken ?? existing.githubToken,
      cloudflareApiToken:
        patch.secrets.cloudflareApiToken ?? existing.cloudflareApiToken,
    };
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    try {
      fs.chmodSync(SECRETS_FILE, 0o600);
    } catch {
      /* Windows 下忽略 */
    }
  }

  return { configFile: CONFIG_FILE, secretsFile: SECRETS_FILE };
}

export function validateConfig(cfg) {
  const missing = [];
  if (!cfg.github.token) missing.push('github.token (GITHUB_TOKEN)');
  if (!cfg.github.owner) missing.push('github.owner (GITHUB_OWNER)');
  return missing;
}

/* ============================== core/github =============================== */

const GITHUB_API = 'https://api.github.com';

async function gh(token, method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${GITHUB_API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'web-publish-plugin',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  return { status: res.status, json };
}

/** 确保仓库存在（不存在则创建），返回仓库全名 */
export async function ensureRepo(cfg, repo) {
  const token = cfg.github.token;
  const owner = cfg.github.owner;
  const { status, json } = await gh(token, 'GET', `/repos/${owner}/${repo}`);
  if (status === 200) {
    return { fullName: json.full_name, htmlUrl: json.html_url, created: false };
  }
  if (status !== 404) {
    throw new Error(`查询仓库失败 (${status}): ${json?.message ?? '未知错误'}`);
  }
  const isUser = !owner.includes('/');
  const createUrl = isUser ? '/user/repos' : `/orgs/${owner}/repos`;
  const created = await gh(token, 'POST', createUrl, {
    name: repo,
    description: '由 web-publish-plugin 自动创建并部署的 GitHub Pages 站点',
    private: cfg.repoVisibility === 'private',
    auto_init: true,
  });
  if (created.status !== 201) {
    throw new Error(`创建仓库失败 (${created.status}): ${created.json?.message ?? '未知错误'}`);
  }
  return {
    fullName: created.json.full_name,
    htmlUrl: created.json.html_url,
    created: true,
  };
}

/** 通过 Git Data API 一次性原子提交所有文件 */
export async function pushFiles(cfg, repo, branch, files, message) {
  const token = cfg.github.token;
  const owner = cfg.github.owner;
  const repoInfo = await ensureRepo(cfg, repo);
  const base = `/repos/${owner}/${repo}`;

  // 1. 获取分支 ref
  const ref = await gh(token, 'GET', `${base}/git/ref/heads/${branch}`);
  let baseSha = null;
  if (ref.status === 200) {
    baseSha = ref.json.object.sha;
  } else if (ref.status === 404 && repoInfo.created) {
    baseSha = null;
  } else if (ref.status === 404) {
    const repoMeta = await gh(token, 'GET', base);
    const defBranch = repoMeta.json.default_branch;
    const defRef = await gh(token, 'GET', `${base}/git/ref/heads/${defBranch}`);
    if (defRef.status !== 200) throw new Error(`找不到基础分支 ${defBranch}`);
    const newRef = await gh(token, 'POST', `${base}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: defRef.json.object.sha,
    });
    if (newRef.status !== 201) throw new Error(`创建分支失败: ${newRef.json?.message}`);
    baseSha = defRef.json.object.sha;
  } else {
    throw new Error(`获取分支失败 (${ref.status}): ${ref.json?.message}`);
  }

  // 2. 上传 blob
  const blobs = [];
  for (const [p, content] of Object.entries(files)) {
    const blob = await gh(token, 'POST', `${base}/git/blobs`, {
      content,
      encoding: 'utf-8',
    });
    if (blob.status !== 201) throw new Error(`上传文件 ${p} 失败: ${blob.json?.message}`);
    blobs.push({ path: p.replace(/\\/g, '/'), sha: blob.json.sha, mode: '100644' });
  }

  // 3. 构建 tree
  let baseTreeSha;
  if (baseSha) {
    const commit = await gh(token, 'GET', `${base}/git/commits/${baseSha}`);
    if (commit.status === 200) baseTreeSha = commit.json.tree.sha;
  }
  const tree = await gh(token, 'POST', `${base}/git/trees`, {
    ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    tree: blobs,
  });
  if (tree.status !== 201) throw new Error(`创建 tree 失败: ${tree.json?.message}`);

  // 4. 创建 commit
  const commit = await gh(token, 'POST', `${base}/git/commits`, {
    message,
    tree: tree.json.sha,
    ...(baseSha ? { parents: [baseSha] } : {}),
  });
  if (commit.status !== 201) throw new Error(`创建 commit 失败: ${commit.json?.message}`);

  // 5. 更新/创建 ref
  if (baseSha) {
    const upd = await gh(token, 'PATCH', `${base}/git/refs/heads/${branch}`, {
      sha: commit.json.sha,
    });
    if (upd.status !== 200) throw new Error(`更新分支失败: ${upd.json?.message}`);
  } else {
    const newRef = await gh(token, 'POST', `${base}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.json.sha,
    });
    if (newRef.status !== 201) throw new Error(`创建分支失败: ${newRef.json?.message}`);
  }

  return {
    commitSha: commit.json.sha,
    pushedFiles: blobs.map((b) => b.path),
    repoCreated: repoInfo.created,
  };
}

/** 开启 GitHub Pages（从分支部署），幂等 */
export async function enablePages(cfg, repo, branch) {
  const token = cfg.github.token;
  const owner = cfg.github.owner;
  const base = `/repos/${owner}/${repo}`;
  const pagesUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;

  const current = await gh(token, 'GET', `${base}/pages`);
  if (current.status === 200) {
    const upd = await gh(token, 'PATCH', `${base}/pages`, {
      source: { branch, path: '/' },
    });
    return {
      enabled: true,
      url: current.json.html_url ?? pagesUrl,
      message:
        upd.status === 200
          ? 'GitHub Pages 已开启（已更新发布分支）'
          : 'GitHub Pages 已开启',
    };
  }

  const created = await gh(token, 'POST', `${base}/pages`, {
    source: { branch, path: '/' },
  });
  if (created.status !== 201) {
    throw new Error(
      `开启 GitHub Pages 失败 (${created.status}): ${created.json?.message ?? '未知错误'}（注意：免费版 Pages 需要公开仓库）`,
    );
  }
  return {
    enabled: true,
    url: pagesUrl,
    message: 'GitHub Pages 已开启，首次发布通常需要 1-2 分钟生效',
  };
}

/* ============================ core/cloudflare ============================= */

const CF_API = 'https://api.cloudflare.com/client/v4';

async function cf(token, method, url, body) {
  const res = await fetch(`${CF_API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'web-publish-plugin',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { success: false, errors: [{ message: text }] };
  }
  return { status: res.status, json };
}

/**
 * 将 customDomain 的 CNAME 指向 GitHub Pages（存在则更新，不存在则创建）。
 * §4.1 语义：CNAME 目标恒为 owner.github.io；proxied:false（灰云，仅 DNS）。
 */
export async function configureCustomDomain(cfg, customDomain, githubPagesHost) {
  const token = cfg.cloudflare.apiToken;
  const zoneId = cfg.cloudflare.zoneId;
  if (!token) throw new Error('缺少 Cloudflare API Token（CLOUDFLARE_API_TOKEN）');
  if (!zoneId) throw new Error('缺少 Cloudflare Zone ID（CLOUDFLARE_ZONE_ID）');

  const list = await cf(
    token,
    'GET',
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(customDomain)}`,
  );
  if (list.status !== 200 || !list.json?.success) {
    throw new Error(
      `查询 DNS 记录失败: ${list.json?.errors?.[0]?.message ?? `HTTP ${list.status}`}`,
    );
  }

  // CNAME 目标只取主机名（去掉协议、路径、端口、末尾点）
  const targetHost = githubPagesHost
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();

  // 防御：CNAME 不能指向自身
  const sourceHost = customDomain.replace(/\.$/, '').toLowerCase();
  if (targetHost === sourceHost) {
    throw new Error(
      `CNAME 目标不能等于域名自身（${sourceHost} -> ${targetHost}）；应指向 GitHub Pages 主机 owner.github.io`,
    );
  }
  if (!targetHost.includes('.github.io')) {
    throw new Error(
      `CNAME 目标应为 GitHub Pages 主机（owner.github.io），但得到 "${targetHost}"，请检查插件逻辑`,
    );
  }

  const payload = {
    type: 'CNAME',
    name: customDomain,
    content: targetHost,
    proxied: false, // 灰云：仅 DNS 解析，不走 Cloudflare 代理
    ttl: 1, // auto
    comment: 'web-publish-plugin 自动配置',
  };

  const existing = list.json.result?.[0];
  if (existing) {
    const upd = await cf(token, 'PUT', `/zones/${zoneId}/dns_records/${existing.id}`, payload);
    if (!upd.json?.success) {
      throw new Error(
        `更新 DNS 记录失败: ${upd.json?.errors?.[0]?.message ?? `HTTP ${upd.status}`}`,
      );
    }
    return {
      ok: true,
      recordId: existing.id,
      message: `已更新 DNS 记录: ${customDomain} CNAME -> ${payload.content}（灰云，仅 DNS 解析）`,
    };
  }

  const create = await cf(token, 'POST', `/zones/${zoneId}/dns_records`, payload);
  if (!create.json?.success) {
    throw new Error(
      `创建 DNS 记录失败: ${create.json?.errors?.[0]?.message ?? `HTTP ${create.status}`}`,
    );
  }
  return {
    ok: true,
    recordId: create.json.result?.id,
    message: `已创建 DNS 记录: ${customDomain} CNAME -> ${payload.content}（灰云，仅 DNS 解析）`,
  };
}

/** 在仓库中写入 CNAME 文件（GitHub Pages 自定义域名要求） */
export function cnameFileContent(customDomain) {
  return customDomain + '\n';
}

/* =============================== core/deploy ============================== */

/**
 * 部署编排：push 文件 -> 开启 Pages -> 绑定 Cloudflare 域名。
 * §4.1：CNAME 目标恒为 `${owner}.github.io`（绝不用 enablePages 返回的 pages.url）；
 * customDomain 仅在调用时明确传入才绑定，不从配置兜底。
 */
export async function deploy(req) {
  const cfg = loadConfig();
  const missing = validateConfig(cfg);
  if (missing.length) {
    throw new Error(
      `插件尚未完成配置，缺少：${missing.join('、')}。请在插件设置中填写，或设置对应环境变量。`,
    );
  }
  if (!req.files || Object.keys(req.files).length === 0) {
    throw new Error('files 为空：请提供要部署的网页文件（路径 -> 内容）');
  }

  // repo 必填：每个项目各自指定仓库名
  const repo = req.repo?.trim();
  if (!repo) {
    throw new Error(
      '缺少仓库名：请在调用时通过 repo 参数指定本项目的仓库名（例如 "repo": "项目A"），每个项目一个独立仓库。',
    );
  }
  const branch = req.branch || cfg.github.branch || 'main';
  const messages = [];

  // 自定义域名：仅在调用时明确通过 customDomain 指定才绑定（可选）
  const files = { ...req.files };
  const domain = req.customDomain?.trim() || undefined;
  if (domain && !files['CNAME']) {
    files['CNAME'] = cnameFileContent(domain);
    messages.push(`已自动写入 CNAME 文件（${domain}）`);
  }

  // 1. 推送文件
  const push = await pushFiles(
    cfg,
    repo,
    branch,
    files,
    req.commitMessage || `deploy: 自动部署网页 (${new Date().toISOString()})`,
  );
  messages.push(
    `已提交 ${push.pushedFiles.length} 个文件到 ${cfg.github.owner}/${repo}@${branch}（${push.commitSha.slice(0, 7)}）`,
  );
  if (push.repoCreated) messages.push('仓库不存在，已自动创建');

  // 2. 开启 GitHub Pages
  let pagesEnabled = false;
  let pagesUrl = `https://${cfg.github.owner.toLowerCase()}.github.io/${repo}/`;
  if (req.enablePages !== false) {
    try {
      const pages = await enablePages(cfg, repo, branch);
      pagesEnabled = pages.enabled;
      pagesUrl = pages.url;
      messages.push(pages.message);
    } catch (e) {
      messages.push(`⚠️ GitHub Pages 配置失败：${e.message}`);
    }
  }

  // 3. 绑定 Cloudflare 自定义域名
  let domainConfigured = false;
  let customDomainUrl;
  if (domain) {
    try {
      // §4.1：CNAME 目标必须是 owner.github.io，绝不能用 pagesUrl（可能已是域名自身）
      const pagesHost = `${cfg.github.owner.toLowerCase()}.github.io`;
      const r = await configureCustomDomain(cfg, domain, pagesHost);
      domainConfigured = r.ok;
      customDomainUrl = `https://${domain}/`;
      messages.push(r.message);
    } catch (e) {
      messages.push(`⚠️ Cloudflare 域名配置失败：${e.message}`);
    }
  }

  return {
    ok: true,
    repoFullName: `${cfg.github.owner}/${repo}`,
    repoUrl: `https://github.com/${cfg.github.owner}/${repo}`,
    pagesUrl,
    customDomainUrl,
    commitSha: push.commitSha,
    branch,
    pushedFiles: push.pushedFiles,
    pagesEnabled,
    domainConfigured,
    messages,
  };
}
