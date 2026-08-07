# 排障速查

## `connection refused`

`--server` 指向了前端端口。memogit 必须打后端端口,前端(Vite)和后端通常不是
同一个端口。用 `lsof -nP -iTCP -sTCP:LISTEN | grep -i memos` 找后端端口,
再 `memogit login` 重新登录。

## `Cloned 0 memos`

workspace 解析成功但没匹配到文档 —— 可能文档还没归到该 workspace,或用的是
2026-07-16 前的旧二进制(creator 过滤有 bug,需从源码重建)。

## 改服务器/token

直接再跑 `memogit login …`,会覆盖 `.memogit/config.yaml`。
