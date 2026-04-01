---
name: happy-session-status
description: Use when you need to check a Happy session status, diagnose "no response" sessions, or verify whether a session is alive/stuck/waiting for input by session ID (cmm/cmn...).
allowed-tools: Bash(rg:*), Bash(ps:*), Bash(tail:*), Bash(node packages/happy-cli/dist/index.mjs:*)
---

# Query Happy Session Status

用于快速判断一个 Happy session（`cmm...` / `cmn...`）是活着、卡住，还是已经失联。

## Inputs

- `session_id`：例如 `cmncy7h33iys1zz147bjn0v37`

## Workflow

1. 先用 daemon 视角看是否被跟踪

```bash
node packages/happy-cli/dist/index.mjs daemon list
node packages/happy-cli/dist/index.mjs daemon status
```

2. 在日志中定位该 session

```bash
rg -n "$SESSION_ID" ~/.happy/logs
```

优先看两类日志：
- 会话日志：`~/.happy/logs/YYYY-MM-DD-...-pid-<pid>.log`
- daemon 日志：`...-daemon.log`

3. 提取最后活跃记录（RPC / MCP）

```bash
rg -n "$SESSION_ID" ~/.happy/logs/<session-log>.log | tail -n 30
tail -n 120 ~/.happy/logs/<session-log>.log
```

4. 校验进程是否仍在运行

```bash
ps -p <pid> -o pid=,ppid=,stat=,etime=,command=
```

5. 判断是否“等待用户输入卡住”

- 在会话日志里出现 `request_user_input`，但后续没有对应回答/回调，即可判为等待输入。

```bash
rg -n "request_user_input|call_|answer|user_input" ~/.happy/logs/<session-log>.log | tail -n 40
```

## Status Rules

- `running-active`：PID 存活，且最近仍有 RPC/handler 记录。
- `running-waiting-input`：PID 存活，最后关键事件是 `request_user_input`，无回填。
- `running-idle`：PID 存活，但长时间（例如 > 1 小时）无有效业务事件。
- `stale-or-dead`：PID 不存在，或 daemon 仅保留陈旧状态。

## Output Template

按下面格式返回，必须带绝对时间：

1. `Session`: `<session_id>`
2. `Current status`: `<one of 4 statuses>`
3. `Last active time`: `YYYY-MM-DD HH:mm:ss (timezone)`
4. `Process`: `alive/dead` + `pid`
5. `Evidence`:
   - session log: `<path>`
   - daemon log: `<path>`
   - key lines: `<brief>`
6. `Diagnosis`: 一句话说明为什么看起来“无响应”

## Quick One-Liner

```bash
SESSION_ID="cmn..."; rg -n "$SESSION_ID" ~/.happy/logs | head -n 50
```
