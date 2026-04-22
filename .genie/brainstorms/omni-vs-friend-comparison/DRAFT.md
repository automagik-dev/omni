# Omni v2 vs "Omni Pessoal" — Comparison

## Tabela Comparativa

| Feature | Omni Pessoal (Amigo) | Omni v2 | Status |
|---------|---------------------|---------|--------|
| **INBOX / SCANNING** | | | |
| Scan inbox (listar conversas) | `scan_raw.py <N>` — lê sidebar do WhatsApp Web | `omni chats list --instance <id>` / `GET /api/v2/chats` | **Omni tem** |
| Preview + timestamp + unread count | Retorna nome, preview, timestamp, unread | Chat list inclui lastMessage, unreadCount, timestamps | **Omni tem** |
| **LER CONVERSAS** | | | |
| Ler mensagens de uma conversa | `read_full.py "Nome"` — últimas N msgs por nome | `omni chats messages <chatId>` / `GET /api/v2/chats/:id/messages` | **Omni tem** |
| Busca por nome do contato | Abre por nome diretamente | Busca por chatId (precisa lookup nome→id primeiro) | **Omni tem** (workflow diferente) |
| **ENVIAR MENSAGENS** | | | |
| Enviar texto | `reply.py "Nome" "Msg"` | `omni send --instance <id> --to <jid> --text "msg"` | **Omni tem** |
| Delays anti-bot | Delays hardcoded no script | Debounce modes (fixed/randomized) + human delay simulation | **Omni tem** (mais sofisticado) |
| Enviar mídia | Não mencionado | `omni send --media <path>` / stickers / voice / TTS | **Omni tem mais** |
| Enviar localização | Não mencionado | `omni send --location --lat --lng` | **Omni tem mais** |
| Enviar contato | Não mencionado | `omni send --contact --phone --name` | **Omni tem mais** |
| Enviar poll | Não mencionado | `omni send --poll` | **Omni tem mais** |
| Reactions | Não mencionado | `POST /messages/:id/reactions` | **Omni tem mais** |
| Forward mensagem | Não mencionado | `POST /messages/send/forward` | **Omni tem mais** |
| Editar mensagem enviada | Não mencionado | `editMessage()` | **Omni tem mais** |
| **ARQUIVAMENTO** | | | |
| Arquivar conversa individual | Via `archive_batch.py` | `omni chats archive <id>` / `POST /chats/:id/archive` | **Omni tem** |
| Arquivar em lote | `archive_batch.py "N1" "N2"` — múltiplos nomes | Precisa chamar archive N vezes (sem batch endpoint) | **GAP** — Omni não tem batch archive |
| Desarquivar | Não mencionado | `omni chats unarchive <id>` | **Omni tem** |
| **BLOCKLIST / FILTERING** | | | |
| Blocklist de contatos | `blocked.txt` — 23 nomes, substring match | `POST /instances/:id/block` / `fetchBlocklist()` | **Omni tem** (nativo WhatsApp) |
| Substring match (case-insensitive) | Sim — "Naders" bloqueia qualquer chat com esse nome | Não — block é por JID exato | **DIFERENTE** — abordagens distintas |
| Blocklist respeitada em todos os scripts | Sim — scan, read, reply, archive, check_pending | Sim — access mode blocklist/allowlist no instance | **Omni tem** |
| Silent unblock → send → re-block | Sim — remove da lista, manda, adiciona de volta | Não tem workflow automático para isso | **GAP** — Omni não tem silent bypass |
| **TRIAGE / SPAM DETECTION** | | | |
| Classificar spam vs legítimo | Workflow manual com AI (classificação + validação humana) | Automations com conditions (regex, contains) | **PARCIAL** — Omni tem o engine, falta o workflow pronto |
| Mostrar em lotes para validação | Lotes de 4 para o user validar | Não tem UI de triage | **GAP** — Omni não tem workflow de triage interativo |
| Salvar rótulos em dataset | `dataset.csv` para treinar ML | Não tem | **GAP** — Omni não salva labels para training |
| **PENDING / CHECK** | | | |
| Identificar conversas pendentes | `check_pending.py` — onde você deve resposta | Não tem equivalente direto | **GAP** — Omni não tem "pending check" |
| **GESTÃO DE PERFIL** | | | |
| Atualizar nome/bio/foto | Não mencionado | `updateProfileName()`, `updateBio()`, `updateProfilePicture()` | **Omni tem mais** |
| Privacy settings | Não mencionado | `fetchPrivacySettings()` | **Omni tem mais** |
| **GRUPOS** | | | |
| Criar/gerenciar grupos | Não mencionado | `groupCreate()`, invite, metadata, sync | **Omni tem mais** |
| **MULTI-CANAL** | | | |
| Slack, Telegram, Discord, etc. | Não — só WhatsApp | WhatsApp + Slack + extensível via plugins | **Omni tem mais** |
| **AUTOMAÇÕES** | | | |
| Workflows event-driven | Não mencionado (scripts manuais) | Full automation engine (triggers, conditions, actions) | **Omni tem mais** |
| Agent integration | Não mencionado | Inbox bridge, agent calls, session strategies | **Omni tem mais** |
| **SYNC / HISTORY** | | | |
| History sync | Não mencionado | Full message/contact/group sync via Baileys | **Omni tem mais** |

## Resumo dos GAPs no Omni

| # | Gap | Complexidade | Descrição |
|---|-----|-------------|-----------|
| 1 | **Batch archive** | Baixa | Endpoint/CLI para arquivar múltiplos chats de uma vez |
| 2 | **Check pending** | Baixa-Média | Building blocks existem (unreadCount + message.direction), falta query/comando que cruze: "chats onde última msg é inbound e não respondi" |
| 3 | **Triage workflow** | Média-Alta | Workflow interativo de classificação spam/legítimo com validação humana |
| 4 | **Chat Visibility / Agent Privacy** | Média | Esconder chats da listagem do agente. Hoje accessMode só filtra processamento de msg — chat ainda aparece no `chats list`. User quer que agente NÃO enxergue certas conversas por privacidade |
| 5 | **Silent bypass** | Baixa | Unblock→send→re-block automatizado |
| 6 | **Label/dataset export** | Baixa | Salvar classificações para treinamento futuro |

## Como o Amigo Pode Fazer o Equivalente no Omni

| Script dele | Equivalente Omni | Como usar |
|------------|-----------------|-----------|
| `scan_raw.py 20` | `omni chats list --instance <id> --limit 20` | Lista as 20 conversas mais recentes com preview |
| `read_full.py "João"` | `omni chats messages <chatId> --limit 5` | Precisa primeiro achar o chatId do João via `omni chats list` |
| `reply.py "João" "Oi"` | `omni send --instance <id> --to <jid> --text "Oi"` | JID = 5511999999999@s.whatsapp.net |
| `archive_batch.py "N1" "N2"` | `for id in id1 id2; do omni chats archive $id; done` | Loop no shell (sem batch nativo ainda) |
| `check_pending.py` | Não tem equivalente direto | Poderia ser construído com automations + query de chats não lidos |
