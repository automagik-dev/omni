# OpenClaw Protocol Verification (Group 0 Spike)

**Date:** 2026-02-10T20:07:32.045Z
**Gateway:** ws://127.0.0.1:18789
**Test session key:** `agent:sofia:omni-spike-test-1770754049631`

## Results

### ASM-3: chat.send auto-creates sessions
**✅ CONFIRMED**

chat.send with new sessionKey "agent:sofia:omni-spike-test-1770754049631" succeeded without prior session creation. Response: {"runId":"7e0875bc-2b1c-44de-b30a-19fb71f3066c","status":"started"}

### ASM-5: ChatEvent includes runId for correlation
**✅ CONFIRMED**

2 ChatEvent frames include runId="7e0875bc-2b1c-44de-b30a-19fb71f3066c" matching chat.send response. States: [delta, final]

### Session Key Format
**✅ WORKS**

Session key format "agent:<agentId>:omni-<chatId>" works. Tested with "agent:sofia:omni-spike-test-1770754049631"

Format tested: `agent:<agentId>:omni-<chatId>`

## Protocol Notes

- Hello payload: {"type":"hello-ok","protocol":3,"server":{"version":"dev","host":"genie-os","connId":"b08b8cff-6a46-4771-ae27-12b489a19b68"},"features":{"methods":["health","logs.tail","channels.status","channels.logout","status","usage.status","usage.cost","tts.status","tts.providers","tts.enable","tts.disable","tts.convert","tts.setProvider","config.get","config.set","config.apply","config.patch","config.schema","exec.approvals.get","exec.approvals.set","exec.approvals.node.get","exec.approvals.node.set","exec.approval.request","exec.approval.resolve","wizard.start","wizard.next","wizard.cancel","wizard.status","talk.mode","models.list","agents.list","agents.files.list","agents.files.get","agents.files.set","skills.status","skills.bins","skills.install","skills.update","update.run","voicewake.get","voicewake.set","sessions.list","sessions.preview","sessions.patch","sessions.reset","sessions.delete","sessions.compact","last-heartbeat","set-heartbeats","wake","node.pair.request","node.pair.list","node.pair.approve","node.pair.reject","node.pair.verify","device.pair.list","device.pair.approve","device.pair.reject","device.token.rotate","device.token.revoke","node.rename","node.list","node.describe","node.invoke","node.invoke.result","node.event","cron.list","cron.status","cron.add","cron.update","cron.remove","cron.run","cron.runs","system-presence","system-event","send","agent","agent.identity.get","agent.wait","browser.request","chat.history","chat.abort","chat.send"],"events":["connect.challenge","agent","chat","presence","tick","talk.mode","shutdown","health","heartbeat","cron","node.pair.requested","node.pair.resolved","node.invoke.request","device.pair.requested","device.pair.resolved","voicewake.changed","exec.approval.requested","exec.approval.resolved"]},"snapshot":{"presence":[{"host":"genie-os","ip":"10.114.1.111","version":"unknown","platform":"linux 6.8.12-16-pve","deviceFamily":"Linux","modelIdentifier":"x64","mode":"gateway","reason":"self","text":"Gateway: genie-os (10.114.1.111) · app unknown · mode gateway · reason self","ts":1770754049548},{"host":"webchat","version":"1.0.0","platform":"linux","mode":"webchat","roles":["operator"],"scopes":["operator.admin","operator.approvals","operator.pairing"],"reason":"connect","ts":1770754049548,"text":"Node: webchat · mode webchat"},{"host":"webchat","version":"1.0.0","platform":"linux","mode":"webchat","roles":["operator"],"scopes":["operator.admin","operator.approvals","operator.pairing"],"reason":"disconnect","ts":1770754021965,"text":"Node: webchat · mode webchat"},{"host":"webchat","version":"1.0.0","platform":"linux","mode":"webchat","roles":["operator"],"scopes":["operator.admin","operator.approvals","operator.pairing"],"reason":"disconnect","ts":1770753946772,"text":"Node: webchat · mode webchat"}],"health":{"ok":true,"ts":1770753991513,"durationMs":29638,"channels":{"telegram":{"configured":true,"tokenSource":"none","running":false,"mode":null,"lastStartAt":null,"lastStopAt":null,"lastError":null,"probe":{"ok":false,"status":null,"error":"fetch failed","elapsedMs":9998},"lastProbeAt":1770753971873,"accountId":"eva","accounts":{"eva":{"configured":true,"tokenSource":"none","running":false,"mode":null,"lastStartAt":null,"lastStopAt":null,"lastError":null,"probe":{"ok":false,"status":null,"error":"fetch failed","elapsedMs":9998},"lastProbeAt":1770753971873,"accountId":"eva"},"genie-cli":{"configured":true,"tokenSource":"none","running":false,"mode":null,"lastStartAt":null,"lastStopAt":null,"lastError":null,"probe":{"ok":true,"status":null,"error":null,"elapsedMs":4105,"bot":{"id":8535258368,"username":"GenieCliBot","canJoinGroups":true,"canReadAllGroupMessages":false,"supportsInlineQueries":false},"webhook":{"url":"","hasCustomCert":false}},"lastProbeAt":1770753975978,"accountId":"genie-cli"},"guga":{"configured":true,"tokenSource":"none","running":false,"mode":null,"lastStartAt":null,"lastStopAt":null,"lastError":null,"probe":{"ok":true,"status":null,"error":null,"elapsedMs":10489,"bot":{"id":8296835890,"username":"GenieGugaBot","canJoinGroups":true,"canReadAllGroupMessages":true,"supportsInlineQueries":false}},"lastProbeAt":1770753986468,"accountId":"guga"},"khal":{"configured":true,"tokenSource":"none","running":false,"mode":null,"lastStartAt":null,"lastStopAt":null,"lastError":null,"probe":{"ok":true,"status":null,"error":null,"elapsedMs":4563,"bot":{"id":8192584323,"username":"GenieKhalBot","canJoinGroups":true,"canReadAllGroupMessages":false,"supportsInlineQueries":false},"webhook":{"url":"","hasCustomCert":false}},"lastProbeAt":1770753991031,"accountId":"khal"},"omni":{"configured":true,"tokenSource":"none","running":false,"mode":null,"lastStartAt":null,"lastStopAt":null,"lastError":null,"probe":{"ok":true,"status":null,"error":null,"elapsedMs":482,"bot":{"id":8179788856,"username":"GenieOmniBot","canJoinGroups":true,"canReadAllGroupMessages":false,"supportsInlineQueries":false},"webhook":{"url":"","hasCustomCert":false}},"lastProbeAt":1770753991513,"accountId":"omni"}}}},"channelOrder":["telegram"],"channelLabels":{"telegram":"Telegram"},"heartbeatSeconds":900,"defaultAgentId":"eva","agents":[{"agentId":"eva","isDefault":true,"heartbeat":{"enabled":true,"every":"15m","everyMs":900000,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/eva/sessions/sessions.json","count":11,"recent":[{"key":"agent:eva:taskfelipe","updatedAt":1770753870176,"age":91696},{"key":"agent:eva:main","updatedAt":1770753822259,"age":139613},{"key":"agent:eva:telegram:dm:1061623284","updatedAt":1770696867484,"age":57094388},{"key":"agent:eva:telegram:group:-5176008917","updatedAt":1770507464455,"age":246497417},{"key":"agent:eva:telegram:dm:@faleagora","updatedAt":1770492755996,"age":261205876}]}},{"agentId":"guga","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/guga/sessions/sessions.json","count":10,"recent":[{"key":"agent:guga:main","updatedAt":1770753953895,"age":7978},{"key":"agent:guga:subagent:9dad21a4-2da1-4f1c-83a0-8eeb2cd8384a","updatedAt":1770753946364,"age":15509},{"key":"agent:guga:subagent:1f3ed1bd-ee6c-4b62-a9f6-6ed1e265f589","updatedAt":1770751851910,"age":2109963},{"key":"agent:guga:subagent:6677b926-4a81-4707-b759-aefc8306e433","updatedAt":1770751847470,"age":2114403},{"key":"agent:guga:telegram:dm:1061623284","updatedAt":1770588655540,"age":165306333}]}},{"agentId":"khal","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/khal/sessions/sessions.json","count":5,"recent":[{"key":"agent:khal:main","updatedAt":1770701812258,"age":52149616},{"key":"agent:khal:telegram:dm:1061623284","updatedAt":1770674706362,"age":79255512},{"key":"agent:khal:cron:103dfcaf-0d0b-47c2-a9ff-624882e9efac","updatedAt":1770637532211,"age":116429663},{"key":"agent:khal:whatsapp:dm:+5512982298888","updatedAt":1770494099702,"age":259862172},{"key":"agent:chief-of-khal:main","updatedAt":1770251438113,"age":502523761}]}},{"agentId":"claw-docs","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/claw-docs/sessions/sessions.json","count":0,"recent":[]}},{"agentId":"gog-cli","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/gog-cli/sessions/sessions.json","count":1,"recent":[{"key":"agent:gog-cli:main","updatedAt":1770393927449,"age":360034425}]}},{"agentId":"genie-cli","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/genie-cli/sessions/sessions.json","count":2,"recent":[{"key":"agent:genie-cli:main","updatedAt":1770753848071,"age":113803},{"key":"agent:genie-cli:telegram:dm:1061623284","updatedAt":1770692915477,"age":61046397}]}},{"agentId":"omni","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/omni/sessions/sessions.json","count":4,"recent":[{"key":"agent:omni:main","updatedAt":1770753810777,"age":151098},{"key":"agent:omni:sofia-setup","updatedAt":1770753537978,"age":423897},{"key":"agent:omni:subagent:0b855efa-67ed-48f2-b631-1c00d0dc7f21","updatedAt":1770752833515,"age":1128360},{"key":"agent:omni:telegram:dm:1061623284","updatedAt":1770735403220,"age":18558655}]}},{"agentId":"helena","isDefault":false,"heartbeat":{"enabled":true,"every":"15m","everyMs":900000,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/helena/sessions/sessions.json","count":1,"recent":[{"key":"agent:helena:main","updatedAt":1770753824678,"age":137197}]}},{"agentId":"genie-os","isDefault":false,"heartbeat":{"enabled":false,"every":"disabled","everyMs":null,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/genie-os/sessions/sessions.json","count":1,"recent":[{"key":"agent:genie-os:main","updatedAt":1770748160387,"age":5801488}]}},{"agentId":"whatsapp-scout","isDefault":false,"heartbeat":{"enabled":true,"every":"10m","everyMs":600000,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/whatsapp-scout/sessions/sessions.json","count":1,"recent":[{"key":"agent:whatsapp-scout:main","updatedAt":1770753832251,"age":129624}]}},{"agentId":"sofia","isDefault":false,"heartbeat":{"enabled":true,"every":"7m","everyMs":420000,"prompt":"Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.","target":"last","ackMaxChars":300},"sessions":{"path":"/home/genie/.openclaw/agents/sofia/sessions/sessions.json","count":2,"recent":[{"key":"agent:sofia:main","updatedAt":1770753835115,"age":126760},{"key":"agent:sofia:sofia-brainstorm","updatedAt":1770753766079,"age":195796}]}}],"sessions":{"path":"/home/genie/.openclaw/agents/eva/sessions/sessions.json","count":11,"recent":[{"key":"agent:eva:taskfelipe","updatedAt":1770753870176,"age":91696},{"key":"agent:eva:main","updatedAt":1770753822259,"age":139613},{"key":"agent:eva:telegram:dm:1061623284","updatedAt":1770696867484,"age":57094388},{"key":"agent:eva:telegram:group:-5176008917","updatedAt":1770507464455,"age":246497417},{"key":"agent:eva:telegram:dm:@faleagora","updatedAt":1770492755996,"age":261205876}]}},"stateVersion":{"presence":60,"health":98},"uptimeMs":4500111,"configPath":"/home/genie/.openclaw/openclaw.json","stateDir":"/home/genie/.openclaw","sessionDefaults":{"defaultAgentId":"eva","mainKey":"main","mainSessionKey":"agent:eva:main","scope":"per-sender"}},"canvasHostUrl":"http://127.0.0.1:18789","policy":{"maxPayload":524288,"maxBufferedBytes":1572864,"tickIntervalMs":30000}}
- chat.send result: {"runId":"7e0875bc-2b1c-44de-b30a-19fb71f3066c","status":"started"}
- chat.send runId: 7e0875bc-2b1c-44de-b30a-19fb71f3066c
- Agent response: "Received!"

## Raw Event Log

```json
[
  {
    "state": "delta",
    "sessionKey": "agent:sofia:omni-spike-test-1770754049631",
    "runId": "7e0875bc-2b1c-44de-b30a-19fb71f3066c",
    "hasMessage": true
  },
  {
    "state": "final",
    "sessionKey": "agent:sofia:omni-spike-test-1770754049631",
    "runId": "7e0875bc-2b1c-44de-b30a-19fb71f3066c",
    "hasMessage": true
  }
]
```

## Hello Payload

```json
{
  "type": "hello-ok",
  "protocol": 3,
  "server": {
    "version": "dev",
    "host": "genie-os",
    "connId": "b08b8cff-6a46-4771-ae27-12b489a19b68"
  },
  "features": {
    "methods": [
      "health",
      "logs.tail",
      "channels.status",
      "channels.logout",
      "status",
      "usage.status",
      "usage.cost",
      "tts.status",
      "tts.providers",
      "tts.enable",
      "tts.disable",
      "tts.convert",
      "tts.setProvider",
      "config.get",
      "config.set",
      "config.apply",
      "config.patch",
      "config.schema",
      "exec.approvals.get",
      "exec.approvals.set",
      "exec.approvals.node.get",
      "exec.approvals.node.set",
      "exec.approval.request",
      "exec.approval.resolve",
      "wizard.start",
      "wizard.next",
      "wizard.cancel",
      "wizard.status",
      "talk.mode",
      "models.list",
      "agents.list",
      "agents.files.list",
      "agents.files.get",
      "agents.files.set",
      "skills.status",
      "skills.bins",
      "skills.install",
      "skills.update",
      "update.run",
      "voicewake.get",
      "voicewake.set",
      "sessions.list",
      "sessions.preview",
      "sessions.patch",
      "sessions.reset",
      "sessions.delete",
      "sessions.compact",
      "last-heartbeat",
      "set-heartbeats",
      "wake",
      "node.pair.request",
      "node.pair.list",
      "node.pair.approve",
      "node.pair.reject",
      "node.pair.verify",
      "device.pair.list",
      "device.pair.approve",
      "device.pair.reject",
      "device.token.rotate",
      "device.token.revoke",
      "node.rename",
      "node.list",
      "node.describe",
      "node.invoke",
      "node.invoke.result",
      "node.event",
      "cron.list",
      "cron.status",
      "cron.add",
      "cron.update",
      "cron.remove",
      "cron.run",
      "cron.runs",
      "system-presence",
      "system-event",
      "send",
      "agent",
      "agent.identity.get",
      "agent.wait",
      "browser.request",
      "chat.history",
      "chat.abort",
      "chat.send"
    ],
    "events": [
      "connect.challenge",
      "agent",
      "chat",
      "presence",
      "tick",
      "talk.mode",
      "shutdown",
      "health",
      "heartbeat",
      "cron",
      "node.pair.requested",
      "node.pair.resolved",
      "node.invoke.request",
      "device.pair.requested",
      "device.pair.resolved",
      "voicewake.changed",
      "exec.approval.requested",
      "exec.approval.resolved"
    ]
  },
  "snapshot": {
    "presence": [
      {
        "host": "genie-os",
        "ip": "10.114.1.111",
        "version": "unknown",
        "platform": "linux 6.8.12-16-pve",
        "deviceFamily": "Linux",
        "modelIdentifier": "x64",
        "mode": "gateway",
        "reason": "self",
        "text": "Gateway: genie-os (10.114.1.111) · app unknown · mode gateway · reason self",
        "ts": 1770754049548
      },
      {
        "host": "webchat",
        "version": "1.0.0",
        "platform": "linux",
        "mode": "webchat",
        "roles": [
          "operator"
        ],
        "scopes": [
          "operator.admin",
          "operator.approvals",
          "operator.pairing"
        ],
        "reason": "connect",
        "ts": 1770754049548,
        "text": "Node: webchat · mode webchat"
      },
      {
        "host": "webchat",
        "version": "1.0.0",
        "platform": "linux",
        "mode": "webchat",
        "roles": [
          "operator"
        ],
        "scopes": [
          "operator.admin",
          "operator.approvals",
          "operator.pairing"
        ],
        "reason": "disconnect",
        "ts": 1770754021965,
        "text": "Node: webchat · mode webchat"
      },
      {
        "host": "webchat",
        "version": "1.0.0",
        "platform": "linux",
        "mode": "webchat",
        "roles": [
          "operator"
        ],
        "scopes": [
          "operator.admin",
          "operator.approvals",
          "operator.pairing"
        ],
        "reason": "disconnect",
        "ts": 1770753946772,
        "text": "Node: webchat · mode webchat"
      }
    ],
    "health": {
      "ok": true,
      "ts": 1770753991513,
      "durationMs": 29638,
      "channels": {
        "telegram": {
          "configured": true,
          "tokenSource": "none",
          "running": false,
          "mode": null,
          "lastStartAt": null,
          "lastStopAt": null,
          "lastError": null,
          "probe": {
            "ok": false,
            "status": null,
            "error": "fetch failed",
            "elapsedMs": 9998
          },
          "lastProbeAt": 1770753971873,
          "accountId": "eva",
          "accounts": {
            "eva": {
              "configured": true,
              "tokenSource": "none",
              "running": false,
              "mode": null,
              "lastStartAt": null,
              "lastStopAt": null,
              "lastError": null,
              "probe": {
                "ok": false,
                "status": null,
                "error": "fetch failed",
                "elapsedMs": 9998
              },
              "lastProbeAt": 1770753971873,
              "accountId": "eva"
            },
            "genie-cli": {
              "configured": true,
              "tokenSource": "none",
              "running": false,
              "mode": null,
              "lastStartAt": null,
              "lastStopAt": null,
              "lastError": null,
              "probe": {
                "ok": true,
                "status": null,
                "error": null,
                "elapsedMs": 4105,
                "bot": {
                  "id": 8535258368,
                  "username": "GenieCliBot",
                  "canJoinGroups": true,
                  "canReadAllGroupMessages": false,
                  "supportsInlineQueries": false
                },
                "webhook": {
                  "url": "",
                  "hasCustomCert": false
                }
              },
              "lastProbeAt": 1770753975978,
              "accountId": "genie-cli"
            },
            "guga": {
              "configured": true,
              "tokenSource": "none",
              "running": false,
              "mode": null,
              "lastStartAt": null,
              "lastStopAt": null,
              "lastError": null,
              "probe": {
                "ok": true,
                "status": null,
                "error": null,
                "elapsedMs": 10489,
                "bot": {
                  "id": 8296835890,
                  "username": "GenieGugaBot",
                  "canJoinGroups": true,
                  "canReadAllGroupMessages": true,
                  "supportsInlineQueries": false
                }
              },
              "lastProbeAt": 1770753986468,
              "accountId": "guga"
            },
            "khal": {
              "configured": true,
              "tokenSource": "none",
              "running": false,
              "mode": null,
              "lastStartAt": null,
              "lastStopAt": null,
              "lastError": null,
              "probe": {
                "ok": true,
                "status": null,
                "error": null,
                "elapsedMs": 4563,
                "bot": {
                  "id": 8192584323,
                  "username": "GenieKhalBot",
                  "canJoinGroups": true,
                  "canReadAllGroupMessages": false,
                  "supportsInlineQueries": false
                },
                "webhook": {
                  "url": "",
                  "hasCustomCert": false
                }
              },
              "lastProbeAt": 1770753991031,
              "accountId": "khal"
            },
            "omni": {
              "configured": true,
              "tokenSource": "none",
              "running": false,
              "mode": null,
              "lastStartAt": null,
              "lastStopAt": null,
              "lastError": null,
              "probe": {
                "ok": true,
                "status": null,
                "error": null,
                "elapsedMs": 482,
                "bot": {
                  "id": 8179788856,
                  "username": "GenieOmniBot",
                  "canJoinGroups": true,
                  "canReadAllGroupMessages": false,
                  "supportsInlineQueries": false
                },
                "webhook": {
                  "url": "",
                  "hasCustomCert": false
                }
              },
              "lastProbeAt": 1770753991513,
              "accountId": "omni"
            }
          }
        }
      },
      "channelOrder": [
        "telegram"
      ],
      "channelLabels": {
        "telegram": "Telegram"
      },
      "heartbeatSeconds": 900,
      "defaultAgentId": "eva",
      "agents": [
        {
          "agentId": "eva",
          "isDefault": true,
          "heartbeat": {
            "enabled": true,
            "every": "15m",
            "everyMs": 900000,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/eva/sessions/sessions.json",
            "count": 11,
            "recent": [
              {
                "key": "agent:eva:taskfelipe",
                "updatedAt": 1770753870176,
                "age": 91696
              },
              {
                "key": "agent:eva:main",
                "updatedAt": 1770753822259,
                "age": 139613
              },
              {
                "key": "agent:eva:telegram:dm:1061623284",
                "updatedAt": 1770696867484,
                "age": 57094388
              },
              {
                "key": "agent:eva:telegram:group:-5176008917",
                "updatedAt": 1770507464455,
                "age": 246497417
              },
              {
                "key": "agent:eva:telegram:dm:@faleagora",
                "updatedAt": 1770492755996,
                "age": 261205876
              }
            ]
          }
        },
        {
          "agentId": "guga",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/guga/sessions/sessions.json",
            "count": 10,
            "recent": [
              {
                "key": "agent:guga:main",
                "updatedAt": 1770753953895,
                "age": 7978
              },
              {
                "key": "agent:guga:subagent:9dad21a4-2da1-4f1c-83a0-8eeb2cd8384a",
                "updatedAt": 1770753946364,
                "age": 15509
              },
              {
                "key": "agent:guga:subagent:1f3ed1bd-ee6c-4b62-a9f6-6ed1e265f589",
                "updatedAt": 1770751851910,
                "age": 2109963
              },
              {
                "key": "agent:guga:subagent:6677b926-4a81-4707-b759-aefc8306e433",
                "updatedAt": 1770751847470,
                "age": 2114403
              },
              {
                "key": "agent:guga:telegram:dm:1061623284",
                "updatedAt": 1770588655540,
                "age": 165306333
              }
            ]
          }
        },
        {
          "agentId": "khal",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/khal/sessions/sessions.json",
            "count": 5,
            "recent": [
              {
                "key": "agent:khal:main",
                "updatedAt": 1770701812258,
                "age": 52149616
              },
              {
                "key": "agent:khal:telegram:dm:1061623284",
                "updatedAt": 1770674706362,
                "age": 79255512
              },
              {
                "key": "agent:khal:cron:103dfcaf-0d0b-47c2-a9ff-624882e9efac",
                "updatedAt": 1770637532211,
                "age": 116429663
              },
              {
                "key": "agent:khal:whatsapp:dm:+5512982298888",
                "updatedAt": 1770494099702,
                "age": 259862172
              },
              {
                "key": "agent:chief-of-khal:main",
                "updatedAt": 1770251438113,
                "age": 502523761
              }
            ]
          }
        },
        {
          "agentId": "claw-docs",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/claw-docs/sessions/sessions.json",
            "count": 0,
            "recent": []
          }
        },
        {
          "agentId": "gog-cli",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/gog-cli/sessions/sessions.json",
            "count": 1,
            "recent": [
              {
                "key": "agent:gog-cli:main",
                "updatedAt": 1770393927449,
                "age": 360034425
              }
            ]
          }
        },
        {
          "agentId": "genie-cli",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/genie-cli/sessions/sessions.json",
            "count": 2,
            "recent": [
              {
                "key": "agent:genie-cli:main",
                "updatedAt": 1770753848071,
                "age": 113803
              },
              {
                "key": "agent:genie-cli:telegram:dm:1061623284",
                "updatedAt": 1770692915477,
                "age": 61046397
              }
            ]
          }
        },
        {
          "agentId": "omni",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/omni/sessions/sessions.json",
            "count": 4,
            "recent": [
              {
                "key": "agent:omni:main",
                "updatedAt": 1770753810777,
                "age": 151098
              },
              {
                "key": "agent:omni:sofia-setup",
                "updatedAt": 1770753537978,
                "age": 423897
              },
              {
                "key": "agent:omni:subagent:0b855efa-67ed-48f2-b631-1c00d0dc7f21",
                "updatedAt": 1770752833515,
                "age": 1128360
              },
              {
                "key": "agent:omni:telegram:dm:1061623284",
                "updatedAt": 1770735403220,
                "age": 18558655
              }
            ]
          }
        },
        {
          "agentId": "helena",
          "isDefault": false,
          "heartbeat": {
            "enabled": true,
            "every": "15m",
            "everyMs": 900000,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/helena/sessions/sessions.json",
            "count": 1,
            "recent": [
              {
                "key": "agent:helena:main",
                "updatedAt": 1770753824678,
                "age": 137197
              }
            ]
          }
        },
        {
          "agentId": "genie-os",
          "isDefault": false,
          "heartbeat": {
            "enabled": false,
            "every": "disabled",
            "everyMs": null,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/genie-os/sessions/sessions.json",
            "count": 1,
            "recent": [
              {
                "key": "agent:genie-os:main",
                "updatedAt": 1770748160387,
                "age": 5801488
              }
            ]
          }
        },
        {
          "agentId": "whatsapp-scout",
          "isDefault": false,
          "heartbeat": {
            "enabled": true,
            "every": "10m",
            "everyMs": 600000,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/whatsapp-scout/sessions/sessions.json",
            "count": 1,
            "recent": [
              {
                "key": "agent:whatsapp-scout:main",
                "updatedAt": 1770753832251,
                "age": 129624
              }
            ]
          }
        },
        {
          "agentId": "sofia",
          "isDefault": false,
          "heartbeat": {
            "enabled": true,
            "every": "7m",
            "everyMs": 420000,
            "prompt": "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
            "target": "last",
            "ackMaxChars": 300
          },
          "sessions": {
            "path": "/home/genie/.openclaw/agents/sofia/sessions/sessions.json",
            "count": 2,
            "recent": [
              {
                "key": "agent:sofia:main",
                "updatedAt": 1770753835115,
                "age": 126760
              },
              {
                "key": "agent:sofia:sofia-brainstorm",
                "updatedAt": 1770753766079,
                "age": 195796
              }
            ]
          }
        }
      ],
      "sessions": {
        "path": "/home/genie/.openclaw/agents/eva/sessions/sessions.json",
        "count": 11,
        "recent": [
          {
            "key": "agent:eva:taskfelipe",
            "updatedAt": 1770753870176,
            "age": 91696
          },
          {
            "key": "agent:eva:main",
            "updatedAt": 1770753822259,
            "age": 139613
          },
          {
            "key": "agent:eva:telegram:dm:1061623284",
            "updatedAt": 1770696867484,
            "age": 57094388
          },
          {
            "key": "agent:eva:telegram:group:-5176008917",
            "updatedAt": 1770507464455,
            "age": 246497417
          },
          {
            "key": "agent:eva:telegram:dm:@faleagora",
            "updatedAt": 1770492755996,
            "age": 261205876
          }
        ]
      }
    },
    "stateVersion": {
      "presence": 60,
      "health": 98
    },
    "uptimeMs": 4500111,
    "configPath": "/home/genie/.openclaw/openclaw.json",
    "stateDir": "/home/genie/.openclaw",
    "sessionDefaults": {
      "defaultAgentId": "eva",
      "mainKey": "main",
      "mainSessionKey": "agent:eva:main",
      "scope": "per-sender"
    }
  },
  "canvasHostUrl": "http://127.0.0.1:18789",
  "policy": {
    "maxPayload": 524288,
    "maxBufferedBytes": 1572864,
    "tickIntervalMs": 30000
  }
}
```

## Implications for Implementation

- **Session creation:** No explicit session creation needed before chat.send. Simplifies provider implementation.
- **Event correlation:** runId from chat.send response can be used to filter ChatEvent frames. Enables O(1) Map<runId, callback> routing as planned in DEC-5.
- **Session key format:** `agent:<agentId>:omni-<chatId>` is accepted by the gateway.
- **Minimum scopes:** Connected with `['chat.send']` scope only (DEC-8 compliant).
