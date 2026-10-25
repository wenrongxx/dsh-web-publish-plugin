# Web Publish Plugin 鈥?DSH 鎻掍欢

璁?AI Agent 鍐欑殑缃戦〉鑷姩涓婁紶鍒?GitHub銆侀厤缃?GitHub Pages锛屽彲缁戝畾 Cloudflare 鑷畾涔夊煙鍚嶃€?
## 鍖呭惈鐨勫伐鍏?
| 宸ュ叿 | 璇存槑 |
|---|---|
| `publish_website` | 閮ㄧ讲缃戦〉鍒?GitHub Pages銆傚繀濉?`files` + `repo`锛屽彲閫?`customDomain` |
| `configure_plugin` | 鏌ョ湅/鏇存柊閰嶇疆锛圙itHub/Cloudflare API key锛?|
| `get_plugin_status` | 鏌ヨ閰嶇疆瀹屾暣鎬э紙涓嶅洖鏄炬満瀵嗭級 |

## 瀹夎锛圖SH锛?
### 1. 涓嬭浇骞惰В鍘?
浠?[Release 椤甸潰](https://github.com/wenrongxx/dsh-web-publish-plugin/releases) 涓嬭浇 `web-publish-plugin.zip`锛岃В鍘嬪埌浠绘剰鐩綍銆?
### 2. 瀹夎鍒?DSH

鍦?DSH 瀵硅瘽涓 Agent 鎵ц锛?
```
plugin_manager install_bundle target=<瑙ｅ帇鍚庣殑缁濆璺緞>
```

鎴栧湪 Web 渚ц竟鏍忋€屾彃浠躲€嶉〉 鈫?銆屽畨瑁呫€嶁啋 閫夋嫨鏈湴鐩綍銆?
### 3. 閰嶇疆 API Key

鍒涘缓閰嶇疆鏂囦欢锛坄~` 鍦?Windows 涓婃槸 `C:\Users\<鐢ㄦ埛鍚?`锛夛細

- **Windows**: `C:\Users\<鐢ㄦ埛鍚?\.web-publish-plugin\`
- **Linux/Mac**: `~/.web-publish-plugin/`

#### `secrets.json`锛堟満瀵嗭紝鏉冮檺寤鸿 600锛?
```json
{
  "githubToken": "ghp_xxx锛坮epo + workflow 鏉冮檺锛?,
  "cloudflareApiToken": "xxx锛圸one.DNS Edit 鏉冮檺锛?
}
```

#### `config.json`锛堥潪鏈哄瘑锛?
```json
{
  "github": { "owner": "浣犵殑GitHub鐢ㄦ埛鍚?, "branch": "main" },
  "cloudflare": { "zoneId": "浣犵殑Zone ID" },
  "repoVisibility": "public"
}
```

涔熷彲浠ュ湪瀵硅瘽涓 Agent 鐢?`configure_plugin` 宸ュ叿濉啓锛屾棤闇€鎵嬪姩缂栬緫鏂囦欢銆?
## 浣跨敤绀轰緥

閰嶇疆瀹屾垚鍚庯紝鐩存帴瀵?Agent 璇达細

> 鐢?publish_website 閮ㄧ讲涓€涓綉椤靛埌浠撳簱 my-site锛屾枃浠跺涓嬶細
> index.html: `<h1>Hello</h1>`

Agent 浼氳嚜鍔ㄨ皟鐢ㄥ伐鍏峰畬鎴愶細寤轰粨 鈫?涓婁紶 鈫?寮€鍚?Pages銆?
## 瀹夊叏璇存槑

- API key 浠呭瓨鏈湴 `secrets.json`锛屼笉闅忔彃浠跺垎鍙?- 宸ュ叿杩斿洖**姘镐笉鍥炴樉** token锛屽彧鏄剧ず銆岋紙宸茶缃級/锛堟湭璁剧疆锛夈€?- CNAME 鐩爣閿佸畾涓?`owner.github.io`锛孋loudflare DNS 璁板綍浣跨敤鐏颁簯锛坄proxied: false`锛?- 鎻掍欢浠ｇ爜**鏃犱换浣?DELETE 鎿嶄綔**锛屼笉浼氬垹闄や粨搴撴垨 DNS 璁板綍

## 鏂囦欢缁撴瀯

```
package.json              # DSH bundle manifest
cordis.patch.yml          # Bundle patch
icon.svg                  # 鎻掍欢鍥炬爣
locale/en.json            # 鑻辨枃璇█鍖?locale/zh.json            # 涓枃璇█鍖?config.example.json       # 閰嶇疆妯℃澘
secrets.example.json      # 鏈哄瘑閰嶇疆妯℃澘
src/dsh-plugin/index.js   # DSH 鎻掍欢鍏ュ彛
src/dsh-plugin/deploy-core.js  # 閮ㄧ讲鏍稿績閫昏緫
```

## License

MIT
