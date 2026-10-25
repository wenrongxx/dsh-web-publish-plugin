/**
 * DSH 鎻掍欢鍐呴儴閮ㄧ讲鏍稿績锛氫笌 src/core/ + src/shared/ 鐨?TypeScript 閫昏緫涓€鑷? * 锛圕NAME 鐩爣鎭掍负 owner.github.io銆丆loudflare 鐏颁簯 proxied:false 绛?搂4.1 璇箟涓嶅彉锛夈€? * DSH Loader 浠ョ函 ESM 鍔犺浇鎻掍欢锛屾棤娉曡В鏋?TS 璺ㄦ枃浠剁殑 .js 鎸囧悜锛屾晠姝ゆ枃浠跺皢
 * config / github / cloudflare / deploy 鍚堝苟涓洪浂渚濊禆鐨勭函 JS 妯″潡銆? */
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
    throw new Error(`閰嶇疆鏂囦欢瑙ｆ瀽澶辫触 ${file}: ${e.message}`);
  }
  return {};
}

/** 浼樺厛绾э細鐜鍙橀噺 > secrets.json > config.json */
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

/** 闈炴満瀵嗗啓 config.json锛涙満瀵嗗啓 secrets.json锛?600锛夈€倀oken/apiToken 姘镐笉杩?config.json */
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
      /* Windows 涓嬪拷鐣?*/
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

/** 纭繚浠撳簱瀛樺湪锛堜笉瀛樺湪鍒欏垱寤猴級锛岃繑鍥炰粨搴撳叏鍚?*/
export async function ensureRepo(cfg, repo) {
  const token = cfg.github.token;
  const owner = cfg.github.owner;
  const { status, json } = await gh(token, 'GET', `/repos/${owner}/${repo}`);
  if (status === 200) {
    return { fullName: json.full_name, htmlUrl: json.html_url, created: false };
  }
  if (status !== 404) {
    throw new Error(`鏌ヨ浠撳簱澶辫触 (${status}): ${json?.message ?? '鏈煡閿欒'}`);
  }
  const isUser = !owner.includes('/');
  const createUrl = isUser ? '/user/repos' : `/orgs/${owner}/repos`;
  const created = await gh(token, 'POST', createUrl, {
    name: repo,
    description: '鐢?web-publish-plugin 鑷姩鍒涘缓骞堕儴缃茬殑 GitHub Pages 绔欑偣',
    private: cfg.repoVisibility === 'private',
    auto_init: true,
  });
  if (created.status !== 201) {
    throw new Error(`鍒涘缓浠撳簱澶辫触 (${created.status}): ${created.json?.message ?? '鏈煡閿欒'}`);
  }
  return {
    fullName: created.json.full_name,
    htmlUrl: created.json.html_url,
    created: true,
  };
}

/** 閫氳繃 Git Data API 涓€娆℃€у師瀛愭彁浜ゆ墍鏈夋枃浠?*/
export async function pushFiles(cfg, repo, branch, files, message) {
  const token = cfg.github.token;
  const owner = cfg.github.owner;
  const repoInfo = await ensureRepo(cfg, repo);
  const base = `/repos/${owner}/${repo}`;

  // 1. 鑾峰彇鍒嗘敮 ref
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
    if (defRef.status !== 200) throw new Error(`鎵句笉鍒板熀纭€鍒嗘敮 ${defBranch}`);
    const newRef = await gh(token, 'POST', `${base}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: defRef.json.object.sha,
    });
    if (newRef.status !== 201) throw new Error(`鍒涘缓鍒嗘敮澶辫触: ${newRef.json?.message}`);
    baseSha = defRef.json.object.sha;
  } else {
    throw new Error(`鑾峰彇鍒嗘敮澶辫触 (${ref.status}): ${ref.json?.message}`);
  }

  // 2. 涓婁紶 blob
  const blobs = [];
  for (const [p, content] of Object.entries(files)) {
    const blob = await gh(token, 'POST', `${base}/git/blobs`, {
      content,
      encoding: 'utf-8',
    });
    if (blob.status !== 201) throw new Error(`涓婁紶鏂囦欢 ${p} 澶辫触: ${blob.json?.message}`);
    blobs.push({ path: p.replace(/\\/g, '/'), sha: blob.json.sha, mode: '100644' });
  }

  // 3. 鏋勫缓 tree
  let baseTreeSha;
  if (baseSha) {
    const commit = await gh(token, 'GET', `${base}/git/commits/${baseSha}`);
    if (commit.status === 200) baseTreeSha = commit.json.tree.sha;
  }
  const tree = await gh(token, 'POST', `${base}/git/trees`, {
    ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    tree: blobs,
  });
  if (tree.status !== 201) throw new Error(`鍒涘缓 tree 澶辫触: ${tree.json?.message}`);

  // 4. 鍒涘缓 commit
  const commit = await gh(token, 'POST', `${base}/git/commits`, {
    message,
    tree: tree.json.sha,
    ...(baseSha ? { parents: [baseSha] } : {}),
  });
  if (commit.status !== 201) throw new Error(`鍒涘缓 commit 澶辫触: ${commit.json?.message}`);

  // 5. 鏇存柊/鍒涘缓 ref
  if (baseSha) {
    const upd = await gh(token, 'PATCH', `${base}/git/refs/heads/${branch}`, {
      sha: commit.json.sha,
    });
    if (upd.status !== 200) throw new Error(`鏇存柊鍒嗘敮澶辫触: ${upd.json?.message}`);
  } else {
    const newRef = await gh(token, 'POST', `${base}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.json.sha,
    });
    if (newRef.status !== 201) throw new Error(`鍒涘缓鍒嗘敮澶辫触: ${newRef.json?.message}`);
  }

  return {
    commitSha: commit.json.sha,
    pushedFiles: blobs.map((b) => b.path),
    repoCreated: repoInfo.created,
  };
}

/** 寮€鍚?GitHub Pages锛堜粠鍒嗘敮閮ㄧ讲锛夛紝骞傜瓑 */
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
          ? 'GitHub Pages 宸插紑鍚紙宸叉洿鏂板彂甯冨垎鏀級'
          : 'GitHub Pages 宸插紑鍚?,
    };
  }

  const created = await gh(token, 'POST', `${base}/pages`, {
    source: { branch, path: '/' },
  });
  if (created.status !== 201) {
    throw new Error(
      `寮€鍚?GitHub Pages 澶辫触 (${created.status}): ${created.json?.message ?? '鏈煡閿欒'}锛堟敞鎰忥細鍏嶈垂鐗?Pages 闇€瑕佸叕寮€浠撳簱锛塦,
    );
  }
  return {
    enabled: true,
    url: pagesUrl,
    message: 'GitHub Pages 宸插紑鍚紝棣栨鍙戝竷閫氬父闇€瑕?1-2 鍒嗛挓鐢熸晥',
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
 * 灏?customDomain 鐨?CNAME 鎸囧悜 GitHub Pages锛堝瓨鍦ㄥ垯鏇存柊锛屼笉瀛樺湪鍒欏垱寤猴級銆? * 搂4.1 璇箟锛欳NAME 鐩爣鎭掍负 owner.github.io锛沺roxied:false锛堢伆浜戯紝浠?DNS锛夈€? */
export async function configureCustomDomain(cfg, customDomain, githubPagesHost) {
  const token = cfg.cloudflare.apiToken;
  const zoneId = cfg.cloudflare.zoneId;
  if (!token) throw new Error('缂哄皯 Cloudflare API Token锛圕LOUDFLARE_API_TOKEN锛?);
  if (!zoneId) throw new Error('缂哄皯 Cloudflare Zone ID锛圕LOUDFLARE_ZONE_ID锛?);

  const list = await cf(
    token,
    'GET',
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(customDomain)}`,
  );
  if (list.status !== 200 || !list.json?.success) {
    throw new Error(
      `鏌ヨ DNS 璁板綍澶辫触: ${list.json?.errors?.[0]?.message ?? `HTTP ${list.status}`}`,
    );
  }

  // CNAME 鐩爣鍙彇涓绘満鍚嶏紙鍘绘帀鍗忚銆佽矾寰勩€佺鍙ｃ€佹湯灏剧偣锛?  const targetHost = githubPagesHost
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .toLowerCase();

  // 闃插尽锛欳NAME 涓嶈兘鎸囧悜鑷韩
  const sourceHost = customDomain.replace(/\.$/, '').toLowerCase();
  if (targetHost === sourceHost) {
    throw new Error(
      `CNAME 鐩爣涓嶈兘绛変簬鍩熷悕鑷韩锛?{sourceHost} -> ${targetHost}锛夛紱搴旀寚鍚?GitHub Pages 涓绘満 owner.github.io`,
    );
  }
  if (!targetHost.includes('.github.io')) {
    throw new Error(
      `CNAME 鐩爣搴斾负 GitHub Pages 涓绘満锛坥wner.github.io锛夛紝浣嗗緱鍒?"${targetHost}"锛岃妫€鏌ユ彃浠堕€昏緫`,
    );
  }

  const payload = {
    type: 'CNAME',
    name: customDomain,
    content: targetHost,
    proxied: false, // 鐏颁簯锛氫粎 DNS 瑙ｆ瀽锛屼笉璧?Cloudflare 浠ｇ悊
    ttl: 1, // auto
    comment: 'web-publish-plugin 鑷姩閰嶇疆',
  };

  const existing = list.json.result?.[0];
  if (existing) {
    const upd = await cf(token, 'PUT', `/zones/${zoneId}/dns_records/${existing.id}`, payload);
    if (!upd.json?.success) {
      throw new Error(
        `鏇存柊 DNS 璁板綍澶辫触: ${upd.json?.errors?.[0]?.message ?? `HTTP ${upd.status}`}`,
      );
    }
    return {
      ok: true,
      recordId: existing.id,
      message: `宸叉洿鏂?DNS 璁板綍: ${customDomain} CNAME -> ${payload.content}锛堢伆浜戯紝浠?DNS 瑙ｆ瀽锛塦,
    };
  }

  const create = await cf(token, 'POST', `/zones/${zoneId}/dns_records`, payload);
  if (!create.json?.success) {
    throw new Error(
      `鍒涘缓 DNS 璁板綍澶辫触: ${create.json?.errors?.[0]?.message ?? `HTTP ${create.status}`}`,
    );
  }
  return {
    ok: true,
    recordId: create.json.result?.id,
    message: `宸插垱寤?DNS 璁板綍: ${customDomain} CNAME -> ${payload.content}锛堢伆浜戯紝浠?DNS 瑙ｆ瀽锛塦,
  };
}

/** 鍦ㄤ粨搴撲腑鍐欏叆 CNAME 鏂囦欢锛圙itHub Pages 鑷畾涔夊煙鍚嶈姹傦級 */
export function cnameFileContent(customDomain) {
  return customDomain + '\n';
}

/* =============================== core/deploy ============================== */

/**
 * 閮ㄧ讲缂栨帓锛歱ush 鏂囦欢 -> 寮€鍚?Pages -> 缁戝畾 Cloudflare 鍩熷悕銆? * 搂4.1锛欳NAME 鐩爣鎭掍负 `${owner}.github.io`锛堢粷涓嶇敤 enablePages 杩斿洖鐨?pages.url锛夛紱
 * customDomain 浠呭湪璋冪敤鏃舵槑纭紶鍏ユ墠缁戝畾锛屼笉浠庨厤缃厹搴曘€? */
export async function deploy(req) {
  const cfg = loadConfig();
  const missing = validateConfig(cfg);
  if (missing.length) {
    throw new Error(
      `鎻掍欢灏氭湭瀹屾垚閰嶇疆锛岀己灏戯細${missing.join('銆?)}銆傝鍦ㄦ彃浠惰缃腑濉啓锛屾垨璁剧疆瀵瑰簲鐜鍙橀噺銆俙,
    );
  }
  if (!req.files || Object.keys(req.files).length === 0) {
    throw new Error('files 涓虹┖锛氳鎻愪緵瑕侀儴缃茬殑缃戦〉鏂囦欢锛堣矾寰?-> 鍐呭锛?);
  }

  // repo 蹇呭～锛氭瘡涓」鐩悇鑷寚瀹氫粨搴撳悕
  const repo = req.repo?.trim();
  if (!repo) {
    throw new Error(
      '缂哄皯浠撳簱鍚嶏細璇峰湪璋冪敤鏃堕€氳繃 repo 鍙傛暟鎸囧畾鏈」鐩殑浠撳簱鍚嶏紙渚嬪 "repo": "椤圭洰A"锛夛紝姣忎釜椤圭洰涓€涓嫭绔嬩粨搴撱€?,
    );
  }
  const branch = req.branch || cfg.github.branch || 'main';
  const messages = [];

  // 鑷畾涔夊煙鍚嶏細浠呭湪璋冪敤鏃舵槑纭€氳繃 customDomain 鎸囧畾鎵嶇粦瀹氾紙鍙€夛級
  const files = { ...req.files };
  const domain = req.customDomain?.trim() || undefined;
  if (domain && !files['CNAME']) {
    files['CNAME'] = cnameFileContent(domain);
    messages.push(`宸茶嚜鍔ㄥ啓鍏?CNAME 鏂囦欢锛?{domain}锛塦);
  }

  // 1. 鎺ㄩ€佹枃浠?  const push = await pushFiles(
    cfg,
    repo,
    branch,
    files,
    req.commitMessage || `deploy: 鑷姩閮ㄧ讲缃戦〉 (${new Date().toISOString()})`,
  );
  messages.push(
    `宸叉彁浜?${push.pushedFiles.length} 涓枃浠跺埌 ${cfg.github.owner}/${repo}@${branch}锛?{push.commitSha.slice(0, 7)}锛塦,
  );
  if (push.repoCreated) messages.push('浠撳簱涓嶅瓨鍦紝宸茶嚜鍔ㄥ垱寤?);

  // 2. 寮€鍚?GitHub Pages
  let pagesEnabled = false;
  let pagesUrl = `https://${cfg.github.owner.toLowerCase()}.github.io/${repo}/`;
  if (req.enablePages !== false) {
    try {
      const pages = await enablePages(cfg, repo, branch);
      pagesEnabled = pages.enabled;
      pagesUrl = pages.url;
      messages.push(pages.message);
    } catch (e) {
      messages.push(`鈿狅笍 GitHub Pages 閰嶇疆澶辫触锛?{e.message}`);
    }
  }

  // 3. 缁戝畾 Cloudflare 鑷畾涔夊煙鍚?  let domainConfigured = false;
  let customDomainUrl;
  if (domain) {
    try {
      // 搂4.1锛欳NAME 鐩爣蹇呴』鏄?owner.github.io锛岀粷涓嶈兘鐢?pagesUrl锛堝彲鑳藉凡鏄煙鍚嶈嚜韬級
      const pagesHost = `${cfg.github.owner.toLowerCase()}.github.io`;
      const r = await configureCustomDomain(cfg, domain, pagesHost);
      domainConfigured = r.ok;
      customDomainUrl = `https://${domain}/`;
      messages.push(r.message);
    } catch (e) {
      messages.push(`鈿狅笍 Cloudflare 鍩熷悕閰嶇疆澶辫触锛?{e.message}`);
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
