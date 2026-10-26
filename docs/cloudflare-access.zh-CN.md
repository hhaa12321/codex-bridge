# 使用 Cloudflare Named Tunnel + Access 发布 Codex Bridge

本文给出单用户、自托管 Codex Bridge 的公网发布路径。目标拓扑如下：

```text
手机 / 桌面浏览器
        │ HTTPS + WebSocket
        ▼
Cloudflare Access
        │ 身份策略通过
        ▼
Cloudflare Named Tunnel
        │ 仅出站连接
        ▼
127.0.0.1:18791 codex-bridge Web UI
        │ 本机 Unix socket
        ▼
codex app-server
```

该链路不开放公网入站端口，也不代理 `codex app-server`。Cloudflare Access 与 Bridge 密码必须同时
启用；Access 不能替代 Bridge 自身认证。

## 先决条件

- 一个由 Cloudflare 托管 DNS 的域名，例如 `example.com`。
- `codex-bridge` 已通过本地地址 `http://127.0.0.1:18791` 验证登录、聊天、审批和断开重连。
- `config.toml` 中的 `web_ui.listen` 保持为 `127.0.0.1:18791`。
- `web_ui.no_auth = false`，并配置了权限为 `0600` 的 `web_ui.password_file`。
- 普通用户可运行 `systemd --user`。本文不要求 `sudo`。

不要使用 `trycloudflare.com` Quick Tunnel。Quick Tunnel 使用临时主机名，无法稳定绑定 Access
策略，也不适合长期保留登录 Cookie 和 PWA 安装来源。

## 1. 创建 Named Tunnel

安装 Cloudflare 官方的 `cloudflared` 后，以目标用户执行：

```sh
cloudflared tunnel login
cloudflared tunnel create codex-bridge
cloudflared tunnel route dns codex-bridge codex.example.com
```

`tunnel create` 会生成凭据 JSON。凭据文件属于秘密材料，保持目录和文件仅当前用户可读，且不要把
内容写入仓库、聊天记录或服务日志。

创建 `~/.config/cloudflared/config.yml`：

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: /home/yourname/.cloudflared/YOUR-TUNNEL-UUID.json

ingress:
  - hostname: codex.example.com
    service: http://127.0.0.1:18791
  - service: http_status:404
```

将 UUID、用户名和域名替换为实际值。入口最后必须保留一个兜底规则，避免未匹配请求被转发到其他
本机服务。不要填写 `0.0.0.0`、局域网 IP、Unix socket 或 `codex app-server` 地址。

## 2. 配置 Bridge 公网 Origin

在 `~/.config/codex-bridge/config.toml` 中设置完整 HTTPS Origin：

```toml
[web_ui]
enabled = true
listen = "127.0.0.1:18791"
user = "codex"
password_file = "~/.codex-bridge/web-ui-password"
no_auth = false
public_origins = ["https://codex.example.com"]
```

`public_origins` 只接受精确匹配的 HTTPS scheme、hostname 和端口，不接受路径或通配符。登录 Cookie、
Passkey origin、Host/Origin 校验和 WebSocket 升级都会使用这个值。

修改后重启 Bridge：

```sh
systemctl --user restart codex-bridge.service
codexctl status
curl --fail --silent --show-error http://127.0.0.1:18791/api/auth >/dev/null
```

最后一条请求从本机发起但仍要求认证；收到 `401` 也说明 HTTP 服务可达。更完整的本机业务验证应先
通过浏览器密码登录，再完成一次聊天与审批。

## 3. 安装用户级 Tunnel 服务

仓库脚本只校验配置并安装 `systemd --user` 单元，不登录 Cloudflare、不创建 Tunnel、DNS 或 Access
策略：

```sh
./scripts/install-cloudflared-user.sh --check
./scripts/install-cloudflared-user.sh --install
```

如果配置文件不在默认位置，传入 `--config /absolute/path/config.yml`。脚本会拒绝
`trycloudflare.com`、非 loopback origin 和缺少 Named Tunnel 标识的配置。

常用诊断命令：

```sh
systemctl --user status codex-bridge-cloudflared.service
journalctl --user -u codex-bridge-cloudflared.service -n 100 --no-pager
cloudflared tunnel info codex-bridge
cloudflared tunnel --config ~/.config/cloudflared/config.yml ingress validate
```

## 4. 配置 Cloudflare Access

在 Cloudflare Zero Trust 控制台创建 Self-hosted Access application：

1. Application domain 填写完整主机名 `codex.example.com`，不要只保护某个 `/api` 路径。
2. 为本人账号创建 Allow policy；可先用 One-time PIN 或已有身份提供方验证闭环。
3. 默认拒绝其他身份。不要为 `Everyone` 创建 Allow policy。
4. 确认 Access 覆盖 WebSocket 升级路径。Cloudflare 会代理同域 WebSocket，但 Tunnel ingress 不能
   改写或剥离 `/api/events`。
5. 保存后从未登录的隐私窗口访问公网主机名，应先看到 Cloudflare Access，而不是 Bridge 登录页。

通过 Access 后仍会看到 Bridge 登录页；输入 Bridge 用户名和密码后才能进入聊天工作区。这是预期的
双层认证。

## 5. 手机与 WebSocket 验收

在手机蜂窝网络关闭 Wi-Fi 后逐项验证：

- Access 身份过期后重新认证，Bridge 登录 Cookie 仍按自身七天有效期工作。
- 打开项目与会话，发送消息，批准一次命令，再中断一次 turn。
- 在运行中发送 Steer，并加入和撤回一条 Queue 输入。
- 切到后台 30 秒以上再返回，页面重新同步活动状态和消息，不重复消息。
- 旋屏到横屏后 composer、审批卡片和发送按钮不重叠。
- 两个浏览器标签同时打开同一会话；非 writer 端明确显示只读、允许 Queue，并可显式请求会话锁。
- 安装 PWA 后仍从公网 HTTPS 主机名启动；断网时 Service Worker 只显示静态离线页，不缓存会话、
  凭据、API 响应或用户内容。

## 6. 安全边界检查

从 Cloudflare 外部网络检查时：

- 不带 Access 身份访问应被 Cloudflare 拒绝或重定向到 Access，而不是返回 Bridge HTML。
- 直接扫描服务器公网 IP 不应发现 `18791` 或 app-server 管理端口。
- `cloudflared` 进程应只建立出站连接，不新增监听在 `0.0.0.0` 的服务。
- 响应头和页面不应包含 API Key、Bridge Cookie、app-server Unix socket 或完整本机目录。
- `web_ui.no_auth` 必须为 `false`；Bridge 仅在 loopback 上允许关闭认证，但不应在公网部署中使用。

## 7. 升级与回滚

升级 Bridge 或 Codex CLI 前先完成：

```sh
codexctl status
journalctl --user -u codex-bridge.service -n 100 --no-pager
```

确认没有活动 turn 或 queued input 后，再从 Settings → Connection & diagnostics 显式重启 managed
app-server。Bridge 自身升级应保持健康的 app-server 运行；Tunnel 服务可以独立重启。

回滚顺序：

1. 停止 `codex-bridge-cloudflared.service`，关闭公网入口。
2. 恢复上一版 Bridge 二进制和与之匹配的 Codex CLI。
3. 使用原 `config.toml` 启动 Bridge，在 loopback 上完成一次登录和聊天检查。
4. 重新启动 Tunnel 服务，先验证 Access 拒绝路径，再由本人身份访问。

### 常见失败

- **要求 Access 但直接看到 Bridge 登录页**：Access application 未覆盖完整主机名，或 Tunnel 主机名
  不是 Access 配置的 domain。
- **`forbidden`**：`public_origins` 与当前 HTTPS Origin 不完全一致。
- **登录后 WebSocket 不重连**：检查 Access application、Tunnel ingress 和反向代理是否允许
  WebSocket upgrade；浏览器开发者工具中 `/api/events` 不应持续返回 `403`。
- **502/1033**：Bridge 未监听 `127.0.0.1:18791`，或 Tunnel ingress 指向了错误端口。
- **服务启动后被拒绝**：确认使用 Named Tunnel，配置包含 `tunnel` 或 `credentials-file`，且入口
  origin 严格为 loopback。
