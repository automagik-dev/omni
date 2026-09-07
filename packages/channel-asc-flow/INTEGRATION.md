# ASC ↔ Omni ↔ agente — runbook de integração

Como a linha WhatsApp da Hapvida pelo BSP **ASC** chega no agente e volta, o que
está configurado de cada lado, e o que quebra quando cada peça sai do lugar.

O [`README.md`](./README.md) ao lado é o contrato do plugin para quem programa.
Este documento é o **operacional**: acesso ao portal, cada componente do flow,
cada campo da instância, e a mão dupla do handoff.

Tudo aqui foi medido na linha viva em 01–05/09/2026. Onde há número, ele veio de
um atendimento real e o atendimento está citado.

---

## 1. O caminho inteiro, em uma figura

```
beneficiário (WhatsApp)
      │
      ▼
ASC — plataforma BSP  (sac-notredame.ascbrazil.com.br)
      │  o atendimento entra no serviço 130 "Namastex Bots"
      │  e cai no FLOW #225 "Teste KHAL 1"
      ▼
flow, nó api_rest ─── POST ──► Omni  /api/v2/channels/asc-flow/{instanceId}/webhook
                                  │
                                  │ message.received
                                  ▼
                            agente (hv-scheduling, Agno)
                                  │
                                  │ POST /api/v2/messages/send        (texto, componente)
                                  │ POST /api/v2/messages/send/handoff (texto + flags)
                                  ▼
                            plugin channel-asc-flow
                                  │
      ┌───────────────────────────┼──────────────────────────────┐
      ▼                           ▼                              ▼
POST /callbackFlowMsg       POST /mensagem              corpo do POLL
(as bolhas de texto)        (mídia, URA/botões)         (hand_off, fila_vq,
 chega em ~1s                                            motivo_transf_vq)
      │                           │                              │
      └──────────► aparelho ◄─────┘                              ▼
                                                      flow, nó dec_handoff
                                                                 │ hand_off = sim
                                                                 ▼
                                                      nó genesys_1 → Genesys
                                                                 │
                                                      atendente humano assume
```

**A assimetria que explica quase tudo:** o TEXTO sai empurrado
(`/callbackFlowMsg`, chega em ~1s) e o **sinal de handoff** só existe no corpo da
resposta do poll — que é resposta **única**. Quem chegar depois dela não é lido.
Ver §6.

---

## 2. Portal da ASC

**URL:** `https://sac-notredame.ascbrazil.com.br/`

**Credenciais:** usuário `gustavo.batistam`. A senha do **portal web** e a
`chave` da **API REST** são valores DIFERENTES e rotacionam em momentos
diferentes — as duas vivem no `.env` do `asc-flow-adapter` e no Bitwarden. Nunca
em código, nunca em issue.

### 🔴 Marque "Permanecer no painel clássico" no login

O editor de flow é mxGraph e **só existe no painel clássico**. Entrando pelo
painel novo, `window.mxUtils` fica indefinido e `/flow/view/cod_flow/225`
devolve 500 — que parece plataforma fora do ar e não é. O checkbox vem marcado
por padrão; um login programático que preencha só usuário e senha o perde.

### O login web tem anti-bot (reCAPTCHA)

Playwright normal toma **"Nome de usuário ou senha inválidos"** com a senha
CERTA — as mesmas credenciais autenticam na API REST no mesmo minuto. Para
automatizar, usar o **camofox** (Camoufox, Firefox com spoof de fingerprint),
que passa:

```bash
curl -s -X POST http://localhost:9377/tabs -H 'Content-Type: application/json' \
  -d '{"userId":"cezao","sessionKey":"asc","url":"https://sac-notredame.ascbrazil.com.br/login"}'
# depois: POST /tabs/<id>/type, /click, /evaluate; GET /tabs/<id>/snapshot
```

A sessão persiste em `~/.camofox/profiles/` entre reinícios do browser.

### Ler o flow por JS, não por clique

Com o painel clássico carregado, o modelo inteiro sai em uma chamada:

```js
mxUtils.getXml(new mxCodec().encode(_editor.editor.graph.getModel()))
```

`_editor` é o objeto do editor (`_editor.editor.graph`, `_editor.actions`).
O `CustomData` de cada nó é um **Element do DOM** cujo `textContent` é o JSON da
config — `JSON.stringify(cell.data)` devolve `{}` e engana.

### 🔴 Salvar não é confiar — releia do servidor

`_editor.actions.get('saveFlow').funct()` devolve sem erro mesmo quando a sessão
expirou no meio. **Dois saves falharam em silêncio** em 05/09 e só apareceram ao
reabrir a página. Depois de todo save: abrir uma **aba nova**, recarregar do
servidor e conferir o campo. Tirar backup do XML ANTES de editar
(`asc-flow-adapter/flow225-server-*.xml`).

### O que a API REST resolve sem browser

`https://sac-notredame.ascbrazil.com.br/rest/v2/doc/` — a spec OpenAPI está
embutida no HTML da página do Swagger (não há `swagger.json`). Autenticação:

```
POST /rest/v2/authuser  {"login": "...", "chave": "..."}
  → {"success": true, "result": {"token": "<JWT 1h>"}}
Header nas demais: Authorization: Bearer <token>
```

Endpoints que valem no dia a dia:

| endpoint | serve para |
|---|---|
| `GET /atendimento?codigo_atendimento=` | histórico completo, status, agente, todas as mensagens |
| `GET /RelRequisicoes?dat_inicial=&dat_final=` | **o que o flow mandou e o que recebeu** — request e response do `api_rest` |
| `GET /flow?limit=5` | lista os flows (só metadados) |
| `POST /mensagem` | injeta mensagem/mídia no atendimento |
| `POST /sendMsgInterativaAvancado` | lista/botões nativos do WhatsApp, com descrição por linha |
| `POST /callbackFlowMsg` | empurra bolha de texto |
| `POST /transferirHumano` | transfere para serviço da ASC (modo `service`) |

⚠ `GET /flow?cod_flow=225` devolve **500** (bug da plataforma; `limit` e
`nom_flow` funcionam). O grafo só sai pelo editor.

⚠ Correção (06/09) — esta seção afirmava que `/sendMsgInterativaAvancado` só
servia para HSM/campanha e abria atendimento novo. **É falso**, e a suposição
custou um dia: com `bol_incluir_atual: 1` ele entrega DENTRO do atendimento em
curso, e é o único caminho com `descricao` por linha. O `ura_opcoes` do
`/mensagem` é um mapa plano de rótulos — foi por isso que a proposta chegou no
beneficiário como `1 - amanhã 07/09 · 08:00`, sem dizer a clínica.

Três armadilhas dele, todas medidas:

1. **lê form, não JSON.** Mandado como JSON responde `400 Faltando identificador
   da conta` com o `cod_conta` no corpo, porque nem chega a parsear. Em
   `application/x-www-form-urlencoded` com chave aninhada estilo PHP
   (`msg_interativa_parametros[list][secao][0][linhas][0][texto]`) passa.
2. **`envio_direto` é recusado** para os tipos interativos ("Nao e possivel
   utilizar envio direto para esse tipo de mensagem") — não mandar o campo.
3. **endereça o CONTATO**, não o atendimento: `cod_conta` + `contato.telefone`
   são obrigatórios (`cod_atendimento` sozinho → "Faltando identificador da
   conta"). Os dois saem do `GET /atendimento`.

O percent-encoding é UTF-8 aqui — a regra latin-1 da seção 3 vale para o
`/mensagem`, não para este: `acentuação · ç ã` voltou intacto do aparelho.

---

## 3. A plataforma é **latin-1**

Provado em 05/09 mandando uma mensagem e lendo de volta em `/atendimento`:

```
enviado   latin1[áéíóúçãõ °ª]  fora[— – … " " ' ' → ≥ ✓]
guardado  latin1[áéíóúçãõ °ª]  fora[? ? ? ? ? ? ? ? ? ?]
```

Tudo que ISO-8859-1 guarda sobrevive. Tudo que não guarda vira `?`. Isso governa
duas coisas do plugin:

- **emoji** viajam como marcadores `##<codepoint>##` (`✅` → `##2705##`), nos dois
  sentidos — é o que a própria ASC usa no flow #215 de produção;
- **pontuação** fora de latin-1 é **transliterada** antes de sair (`—` → `-`,
  `…` → `...`, aspas curvas → retas, `→` → `->`).

Os travessões do agente chegaram como `Clínico Geral ? inclusive por
teleconsulta ?` num beneficiário real (atendimento 22342782) por dias, sem nada
em log. Hoje o que sobrar fora de latin-1 vira **warning com codepoint**.

Português acentuado não é tocado — latin-1 guarda.

---

## 4. O flow #225 "Teste KHAL 1", nó a nó

Topologia:

```
start ──► api_rest ──► dec_handoff ──┬── [hand_off = sim] ──► genesys_1 ──► fin_1
                                     └── [Padrão] ──► msg_resposta ──► aguarda_usuario
                                                                            │
                                        ┌── [Validado] ──► api_rest ◄───────┘
                                        └── [Tempo de espera] ──► fin_1
```

### `api_rest` — id 3, `cod_componente=9`

O nó que fala com o Omni.

```json
{ "url": "https://asc-omni.cezar.ia.br/api/v2/channels/asc-flow/{instanceId}/webhook",
  "method": "1",            // POST
  "async": "0",             // SÍNCRONO
  "async_condition": "",
  "timeout": "45",
  "remove_breaks": "1" }
```

**Body** (texto livre — os nomes dos campos são contrato NOSSO, não da ASC):

```json
{"codAtendimento": "{#CODIGO_ATENDIMENTO}",
 "chatInput": "{#entrada}",
 "message": "{#MENSAGEM}",
 "phone": "{#CONTATO.TELEFONE}"}
```

**Store** — mapeia a resposta em variáveis do flow:

| variável | campo do JSON |
|---|---|
| 2200001 | `resposta` |
| 2200002 | `hand_off` |
| 2250002 | `motivo_transf_vq` |
| 2250001 | `fila_vq` |

🔴 **`timeout: 45` é o teto de tudo.** O `ASC_FLOW_HOLD_MS` do plugin (40s por
padrão) fica abaixo dele de propósito: segurar mais é responder num socket que o
nó já abandonou, e o turno fica estacionado esperando um poll que não vem.

🔴 **`{#MENSAGEM}` congela** na mensagem que ABRIU o atendimento. É por isso que
o body manda os dois campos: `chatInput` é o que a pessoa digitou agora,
`message` é a fallback que só serve para ABRIR conversa.

### `msg_resposta` — id 100, `cod_componente=1`

Renderiza `{#resposta}`. Hoje a `resposta` volta **sempre vazia**: todas as
bolhas saem empurradas por `/callbackFlowMsg`. Ver §5.

### `aguarda_usuario` — id 101, `cod_componente=2`

```json
{ "variable": "2200003",   // é o {#entrada} do body
  "timeout": "300",        // SEGUNDOS
  "validation": "0" }
```

🔴 **Estava em 10 segundos e isso quebrava a conversa.** A aresta de timeout vai
para `fin_1`, então silêncio além do limite ENCERRA o flow; a próxima mensagem o
reinicia do `start`, e o reinício reentra no `api_rest` carregando o **valor
ANTERIOR** de `{#entrada}` — a variável só é escrita quando `aguarda_usuario`
valida entrada nova.

Medido no atendimento 22342225:

```
14:46:19  turno respondido; aguarda_usuario espera 10s, estoura, encerra
14:52:46  beneficiário manda "quero falar com um atendente humano"
14:52:53  api_rest chama com chatInput "🗑️"   ← o valor das 14:46
14:53:31  api_rest só então chama com o texto certo, 45s depois
```

O 🗑️ velho resetava a sessão no meio da conversa. Subido para **300s** em
05/09. O plugin também se defende disso (§5, guard de réplica), porque em
produção o flow é o **#215 do cliente**, não este.

### `dec_handoff` — id 102, `cod_componente=8`

Decisão sobre `{#hand_off}` (variável 2200002). `sim` → `genesys_1`; padrão →
`msg_resposta`.

### `genesys_1` — id 103, `cod_componente=31` (`genesys_mobile_service`)

Ponte para o Genesys Engage. `connection.cod_flow_componente_config: "1"`,
`inactivity_minutes: 30`.

`session.first_name = {#CONTATO.NOME}`, `session.subject = {#resposta}`.

**userdata** — 13 pares. Os três que NÓS preenchemos estão em negrito:

| # | key | value |
|---|---|---|
| 1 | `u_cpf` | *(vazio)* |
| 2 | `u_cnpj` | *(vazio)* |
| 3 | `PhoneNumber` | `{#CONTATO.TELEFONE}` |
| 4 | `userId` | `{#CONTATO.TELEFONE}` |
| 5 | `u_protocolo` | *(vazio)* |
| 6 | **`u_cod_transf`** | **`{#fila_vq}`** ← a fila de destino |
| 7 | `displayName` | *(vazio)* |
| 8 | `u_NomeBeneficiario` | *(vazio)* |
| 9 | **`u_bot_motivo_transf`** | **`{#motivo_transf_vq}`** ← o motivo |
| 10 | `u_codigoOperadora` | *(vazio)* |
| 11 | `u_carteirinha_beneficiario_atendimento` | *(vazio)* |
| 12 | `u_PJ_RazaoSocial` | *(vazio)* |
| 13 | **`u_central_de_atendimento`** | **`WPP_TECNICA_GENESYS`** |

⚠ O flow #215 de produção tem um 14º campo, `u_bot_falha_api`. Ver
`asc-flow-adapter/HANDOFF-GENESYS.md`.

⚠ `u_cod_transf` é a **fila** e o valor tem que existir do lado do Genesys. O
de-para de filas **não existe documentado** nem do lado da Hapvida (Alan
Gomes/Mutant, 25/08). Hoje o agente manda `SKILL_WPP_TECNICA_GENESYS`.

### `fin_1` — id 5, `cod_componente=4`

Encerra. Recebe o timeout do `aguarda_usuario` e as três saídas do `genesys_1`
(Finalizado, Erro, Inatividade).

---

## 5. O lado do Omni

### Instância

Canal `asc-flow`. Campos (tabela `instances`, prefixo `asc_flow_`):

| campo | obrigatório | observação |
|---|---|---|
| `ascFlowBaseUrl` | não | default `https://sac-notredame.ascbrazil.com.br`; `/rest/v2` é anexado |
| `ascFlowLogin` | **sim** | login do `/authuser` |
| `ascFlowChave` | **sim** | chave do `/authuser` — **secret**, redigido nas respostas da API |
| `ascFlowHandoffMode` | não | default `flow`. **Exclusivo** — ver §6 |
| `ascFlowHandoffServico` | não | `cod_servico` do `/transferirHumano`, **só no modo `service`** |
| `webhookVerifyToken` | não | segredo compartilhado; o flow ecoa em `?token=` ou header `x-webhook-token` |

🔴 Uma vez configurado, o `webhookVerifyToken` é **obrigatório**: token ausente é
recusado igual a token errado. Aceitar a ausência tornava a checagem
contornável — e a rota é montada sem auth, então quem tivesse o UUID injetaria
turnos (runs de agente cobrados) e drenaria respostas estacionadas.

O `chatId` de uma conversa é o **`cod_atendimento`**, só dígitos. Um UUID ali não
dá erro visível: o `resolveRecipient` da rota troca um uuid de pessoa pelo
telefone dela e a mensagem sai pelo lugar errado, com 200.

⚠ `PATCH {"isActive": true}` **não** reativa a instância (responde 200 e não muda
nada). Use `POST /instances/:id/connect`.

### Ajustes que a integração exigiu do nosso lado

Cada um nasceu de uma medição na linha viva:

| ajuste | por quê |
|---|---|
| **toda bolha empurrada**, `resposta` vazia | o `api_rest` **não espera** a resposta HTTP em nenhum dos dois modos — medido 3× (22327328, 22327711). O flow renderiza `{#resposta}` ~1s depois do inbound, com o valor do ciclo ANTERIOR. `/callbackFlowMsg` chega em ~1s e é registrado entregue |
| **segurar o inbound** até o agente responder | responder a PRIMEIRA chamada com o turno pronto elimina a dúvida sobre o `async_condition`: a condição vale sobre a única resposta que existe. Teto 40s, sob os 45s do nó |
| **guard de réplica** (`isStaleFlowReplay`) | flow reiniciado reentra com `{#entrada}` velho. Só um texto que REPETE o último turno respondido paga uma ida a `/atendimento` para perguntar à plataforma qual é a última mensagem real. Falha ABERTO |
| **fallback congelado** (`fromFallback` + `hasSeenCod`) | `{#MENSAGEM}` só pode ABRIR conversa; depois que o cod é conhecido, é poll |
| **botão em vez de lista** | lista **não renderiza** nesta plataforma: vira texto achatado com menu numerado que a ASC monta. Até 3 opções o `forceList` do agente é ignorado e os títulos são encurtados em fronteira de palavra (limite 20 do Meta) |
| **transliteração latin-1** | §3 |
| **dedupe por janela de turno** | a plataforma não dá id de mensagem por turno; em modo async o nó re-POSTa a cada ~2s (medido: ~22 chamadas e 3 runs de agente para UMA mensagem) |
| **`asc-flow` em `CHANNELS_WITH_MESSAGING_WINDOW`** | a janela de sessão vale aqui como em qualquer canal WhatsApp |

### Como o agente fala com o Omni

`hv-scheduling`, `.env`:

```bash
OMNI_API_URL=http://localhost:8898
OMNI_SEND_API_KEY=<api key>
OMNI_SEND_ENABLED=true          # sem isto, nenhum componente interativo é tentado
OMNI_INSTANCE_ID=<uuid>
OMNI_ASC_INSTANCE_ID=<uuid>
HANDOFF_ENABLED=true
HANDOFF_TARGET=omni_asc         # 'odoo' é o outro destino
```

🔴 `INTERACTIVE_CHANNELS` em `adapters/omni/messages.py` precisa conter
`asc-flow`. É uma allowlist **fail-closed**: canal fora dela faz
`supports_interactive()` devolver `False` e o agente **nunca tenta** o
componente — todo turno sai em texto, inclusive os que existem para oferecer uma
escolha.

---

## 6. Handoff — as duas rotas, e a que fala com o Genesys

`ascFlowHandoffMode` escolhe **uma**, e elas são exclusivas:

| modo | como transfere | para onde |
|---|---|---|
| `flow` *(default)* | devolve `hand_off: "sim"` + `fila_vq` + `motivo_transf_vq` no corpo do poll; o `dec_handoff` roteia | **Genesys**, pelo nó `genesys_1` |
| `service` | chama `POST /transferirHumano` com `cod_servico` | fila da **própria ASC** |

**Para Genesys só serve o modo `flow`.** O `service` estaciona o atendimento numa
fila da ASC e nunca chega no Genesys.

### 🔴 O sinal tem que viajar no MESMO envio da despedida

O corpo do poll é resposta **única**. O `dec_handoff` lê `{#hand_off}` do ciclo
que acabou de responder; um sinal que chegue depois disso não é lido nunca.

Foi exatamente o defeito de 05/09 (atendimento 22342225):

```
15:02:52  tool transferir_para_humano — fila e motivo já conhecidos
15:02:54  hook dispara o handoff e RETORNA; o texto do run é entregue
15:02:55  o flow lê o corpo do poll: hand_off "nao"   ← dec_handoff roteia
15:02:59  o adapter omni_asc só então manda o sinal
```

Quatro segundos tarde. E, como os dois caminhos entregavam texto, o beneficiário
lia a mesma frase duas vezes.

**Corrigido** fazendo o destino declarar se ele mesmo entrega o aviso
(`entrega_o_aviso`): quem entrega é **aguardado** antes de a resposta do run
sair, e o texto do run é suprimido em favor do dele. A supressão só acontece
**depois do aceite** — recusou, levantou ou estourou, o `content` fica intacto e
o beneficiário recebe a despedida pelo caminho de sempre. Sem janela de silêncio.

A espera usa `_arun`, nunca `_run`: o Agno roda hook síncrono INLINE no event
loop, e bloquear ali congela o loop de todas as conversas (card 86ak8pjny mediu
14,9s e 503 com a aplicação viva).

### O caminho de ponta a ponta, medido

Atendimento 22342729, 05/09:

```
18:55:52  omni_asc: transbordo aceito fila=SKILL_WPP_TECNICA_GENESYS
18:55:53  handoff: atendimento aberto
15:55:53  o flow recebe:
          {"pronto":1, "resposta":"", "hand_off":"sim",
           "fila_vq":"SKILL_WPP_TECNICA_GENESYS", "motivo_transf_vq":"...",
           "bolhas":["Convidamos um especialista neste tópico..."]}
15:55:58  no aparelho: "Bem-vindo (a). Meu nome e MARCELA."  ← atendente Genesys
```

O `status` do atendimento na ASC continua **"Automático"** depois do handoff, e
isso é esperado: a sessão do Genesys roda DENTRO do flow (`genesys_mobile_service`),
não é atribuição de agente da ASC. Não use `status` para auditar transferência —
use as mensagens do `/atendimento`.

### `agentPaused` é incompatível com o modo `flow`

No modo `flow` o atendimento continua rodando no flow; pausar o agente do lado do
Omni deixaria o beneficiário falando sozinho. A pausa vale no modo `service`,
onde a ASC assume a conversa.

---

## 7. Checklist de subida

**Na ASC (flow):**
1. Login com **"Permanecer no painel clássico"** marcado
2. `api_rest`: URL apontando para a instância certa, `async: 0`, `timeout: 45`
3. `api_rest` body com os **quatro** campos (`codAtendimento`, `chatInput`, `message`, `phone`)
4. `api_rest` store mapeando os **quatro** retornos (`resposta`, `hand_off`, `motivo_transf_vq`, `fila_vq`)
5. `aguarda_usuario.timeout` em **minutos de conversa**, não segundos de rede (300+)
6. `dec_handoff` comparando `{#hand_off}` com `sim`
7. `genesys_1` com `u_cod_transf = {#fila_vq}`, `u_bot_motivo_transf = {#motivo_transf_vq}`, `u_central_de_atendimento = WPP_TECNICA_GENESYS`
8. flow com `integrate_genesys = 1`
9. **Salvar e reabrir em aba nova para conferir**

**No Omni:**
10. Instância `asc-flow` com `login` + `chave` válidos
11. `ascFlowHandoffMode = flow` (Genesys) — não configurar `ascFlowHandoffServico`
12. `webhookVerifyToken` definido, e o mesmo valor no header/query do `api_rest`
13. URL do webhook alcançável a partir da ASC (túnel/ingress de pé)

**No agente:**
14. `INTERACTIVE_CHANNELS` contém `asc-flow`
15. `OMNI_SEND_ENABLED=true`, `HANDOFF_TARGET=omni_asc`
16. `OMNI_ASC_INSTANCE_ID` = a instância certa

---

## 8. Diagnóstico — onde olhar quando quebra

| pergunta | onde a resposta ESTÁ |
|---|---|
| o que o flow mandou e recebeu? | `GET /RelRequisicoes` da ASC — request e response, com horário |
| o que o beneficiário leu? | `GET /atendimento?codigo_atendimento=` |
| **renderizou botão de verdade?** | **só o lado receptor** — `raw_payload.message` no Baileys: `buttonsMessage` vs `conversation`. O `/atendimento` registra os dois como `tip_msg: TEXTO` e **não serve** para isso |
| o canal mandou componente? | `raw_payload.ascFlow` da mensagem no Omni: `{uraOptions, interactive, viaMensagem, handoff}` |
| o agente tentou componente? | log `interactive_flush: componente enviado canal=... opções=N` |
| a sessão do agente foi resetada? | tabela `ai.agno_sessions` — o `session_id` é `<cod>:<epoch>`; reset **apaga a linha** |
| a réplica velha foi barrada? | log `[asc-flow] flow restarted with a stale input variable — dropping the replay` |
| algum caractere vai chegar como `?` | log `[asc-flow] characters the platform cannot carry` |

---

## 9. O que continua aberto

- **`u_bot_falha_api`** (14º userdata do #215) não está no #225
- **de-para de filas do Genesys** não existe documentado de nenhum lado
- **`GET /flow?cod_flow=`** devolve 500 na ASC — o grafo só sai pelo editor
- **`[Continuar por aqui]` em beco sem saída** — hv-scheduling#457
- **busca de clínicas que falhou vira "sem disponibilidade"** — hv-scheduling#458
- **`session_timeout_sweeper` ignora `retryable:false`** — hv-scheduling#459
- **fixtures sem o formato real de `user_code`** — hv-scheduling#460
