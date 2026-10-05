# Z-API no Omni — integração local para Kelvin

Branch: `codex/z-api-channels`, baseada no `dev` upstream em
`02c9f49a73941b7733d29bbaf739fd556ea4233a`. Esta implementação não cria um fork remoto,
não publica PR e não altera o runtime do Kelvin.

## Contrato único, duas conexões

- `zapi-web`: instância Z-API Web, API não oficial, QR e callbacks próprios.
- `zapi-omni`: canal `META_WHATSAPP` provisionado no produto **Z-API Omni**, API oficial.
  Z-API Omni é o fornecedor; Omni/automagik é este gateway. São produtos distintos.

Ambos implementam `ChannelPlugin`, recebem `OutgoingMessage` e publicam os eventos
normalizados do gateway. Kelvin poderá consumir a mesma API e o mesmo journal,
alterando somente a instância selecionada. O código compartilhado fica em
`@omni/channel-zapi-web`; o plugin oficial especializa o driver e as capacidades.

| Recurso | Web | Oficial |
| --- | --- | --- |
| Texto, imagem, áudio, vídeo e sticker por URL HTTPS | Sim | Sim |
| Documento por URL HTTPS e extensão de arquivo | Sim | Não habilitado |
| Contato e localização | Sim | Sim |
| Botões de resposta | Sim | Até 3 |
| Lista de opções | Sim | Não habilitada |
| Resposta citada | Sim | Não habilitada |
| Envio/remoção de reação e callbacks de reação | Sim | Não habilitados |
| Recibo de leitura de IDs específicos | Sim | Não habilitado |
| Templates aprovados | Não | Sim |
| QR | Sim | Conectar no painel do fornecedor |
| Grupos | IDs preservados | Não habilitados |
| Histórico, administração de grupos, chamadas, polls, Flows | Não implementado | Não implementado |

O plugin oficial rejeita recursos que a documentação do fornecedor ainda indica
como em desenvolvimento. Não converte silenciosamente listas, documentos ou citações
em texto. Recebimentos preservam o payload original e normalizam o conteúdo principal;
no Oficial a primeira mídia tem preferência sobre texto acompanhante. Anexos adicionais
permanecem em `rawPayload`. Tipos desconhecidos permanecem `unknown`.

## Cadastro e credenciais

Provisionar primeiro a instância/canal no fornecedor. A chave oficial precisa
conseguir consultar `GET /v1/channels/{channelId}`; a documentação exige papel
ENTERPRISE. A conexão valida o ID e o tipo `META_WHATSAPP`.

Pela UI, selecionar Z-API Web ou Z-API Official em Create Instance e preencher os
campos. Pela CLI, carregar um arquivo JSON fora do repositório:

```sh
omni instances create --name kelvin-zapi --channel zapi-web --zapi-config-file /caminho/seguro/zapi-web.json
omni instances connect kelvin-zapi
```

Formato Web (valores ilustrativos; substituir):

```json
{
  "driver": "web",
  "instanceId": "ID_DA_INSTANCIA_ZAPI",
  "instanceToken": "SUBSTITUIR_PELO_TOKEN_DA_INSTANCIA",
  "clientToken": "SUBSTITUIR_PELO_CLIENT_TOKEN",
  "webhookToken": "GERAR_TOKEN_ALEATORIO_DE_PELO_MENOS_32_CARACTERES"
}
```

Formato Oficial:

```json
{
  "driver": "omni",
  "channelId": "ID_DO_CANAL_META_WHATSAPP",
  "secretKey": "SUBSTITUIR_PELA_SECRET_KEY",
  "signingSecret": "SUBSTITUIR_PELO_SEGREDO_DE_ASSINATURA"
}
```

Usar `--channel zapi-omni` com o segundo arquivo. `--zapi-config-file` também está
em update e connect para rotação. PATCH armazena a nova configuração; connect ou
restart aplica ao plugin. IDs Web e Oficial não são intercambiáveis. A API recusa
combinações inválidas antes de persistir ou chamar o fornecedor.

Na API, POST `/api/v2/instances` recebe `name`, `channel`, `zapiConfig`; os mesmos
campos de configuração entram em PATCH e connect. Toda resposta de instância
remove `zapiConfig`. Persistência usa a nova migration aditiva
`0080_instances_zapi_config.sql`. As credenciais aninhadas seguem o mecanismo
existente de sealing por tenant: **só são cifradas quando a chave mestre e a
propriedade de tenant persistida permitem isso**. O modo legado do Omni continua
armazenando plaintext; não tratar esse modo como cifrado.

## Webhooks

`LOCAL_INSTANCE_UUID` é o UUID retornado pelo Omni, não o ID do fornecedor.

Web:

```text
https://SEU_GATEWAY/api/v2/channels/zapi-web/LOCAL_INSTANCE_UUID/webhook?token=SEU_WEBHOOK_TOKEN
```

Configurar os callbacks de recebimento, envio por mim, status de mensagem,
conexão, desconexão e delivery para esta URL no painel/API Z-API. O token é
independente dos tokens de envio e tem comparação em tempo constante. Bearer
também é aceito quando o emissor permite header customizado. Redigir a query nos
logs do proxy. Esta autenticação não se apresenta como assinatura nativa do Web.

Oficial:

```text
https://SEU_GATEWAY/api/v2/channels/zapi-omni/LOCAL_INSTANCE_UUID/webhook
```

Habilitar assinaturas no fornecedor e cadastrar seu segredo. Verificação exige
`x-webhook-signature` e `x-idempotency-key`, usa a mensagem canônica
`t\ntopic\npartition\noffset\n` seguida dos bytes descomprimidos e tolerância de
300 segundos. Gzip é suportado, com limite de 2 MiB antes e depois da descompressão.

Ambos validam o ID remoto dentro do payload contra a conexão local. JSON inválido
ou ID divergente retorna 400; autenticação inválida retorna 401; falha no journal
retorna 503 para redelivery. A mensagem só recebe ACK após publicar pelo helper
que usa a claim durável do Omni. Mensagens recebidas, ecos e reações são deduplicados
por instância/chat/ID/tipo. Recibos podem repetir e devem ser tratados como fatos
idempotentes por seus consumidores. Uma conexão desconectada localmente retorna 404.

## Envio

Texto, mídia, contatos, localização e reações usam os endpoints existentes do Omni.
Mídia exige URL pública HTTPS; este adapter não faz upload de base64/localPath para
a Z-API. O QR em base64 é mostrado como imagem pela UI. Desafios de passkey devem
ser concluídos no fornecedor nesta versão. Disconnect remove a conexão local e
não encerra a sessão remota.

Templates usam o novo endpoint comum, também disponível para o plugin Meta:

```text
POST /api/v2/messages/send/template
```

```json
{
  "instanceId": "LOCAL_INSTANCE_UUID",
  "to": "5511999999999",
  "template": {
    "name": "atualizacao_pedido",
    "language": "pt_BR",
    "bodyParameters": ["Cliente", "123"]
  },
  "sentBy": "agent"
}
```

O SDK expõe `client.messages.sendTemplate`. O descriptor compartilhado aceita
mídia HTTPS no header e parâmetros de botões, traduzidos pelo adapter. Gerenciamento,
aprovação e cadastro de templates ficam no fornecedor. A janela de 24h é declarada
nas capacidades; a validação final da janela e das permissões é do fornecedor.

`message.sent` significa aceite pela API. `DeliveryCallback` Web significa envio
para WhatsApp e não confirmação de entrega ao destinatário. `MessageStatusCallback`
produz delivered/read/failed. No Oficial, estados de mensagens de saída são lidos
em `state_items`. IDs LID não são transformados em telefones. IDs Web `-group` viram `@g.us` no contrato interno e voltam para `-group` no envio ao fornecedor.

Timeout, conexão interrompida, 5xx ou falha no journal após aceite **não autorizam
retry cego de envio**; é necessário reconciliar o ID e o eco antes de reenviar.
HTTP 429 é o único retorno marcado como retryable. Não há outbox novo nem exactly-once
end-to-end; a deduplicação é de ingress/publicação, não de POSTs repetidos de envio.

## Validação e homologação

Os testes usam fetch/event bus/DB simulados e cobrem payloads de envio, HMAC,
gzip, redelivery, isolamento de instância, QR, reações, callbacks, persistência,
rotação e ocultação de segredos. Os testes de contrato, tenancy e egress do Omni
incluem os novos canais. SDK é regenerado offline a partir do OpenAPI.

Verificação local: 512 testes passaram em 14 suites; tipos de core, DB, API,
plugins, SDK, CLI e UI passaram; lint dos arquivos alterados, contrato de migration
e versões passaram. Builds do SDK e do servidor empacotado passaram.

Não foi aplicada migration a um banco nem feita chamada autenticada ao fornecedor.
Antes de ativar para o Kelvin: homologar com instância e canal de teste, confirmar
payloads reais e recursos habilitados na conta, parear Web, testar recebimento,
resposta, delivery/read, templates e reinício. Depois integrar o cliente HTTP/eventos
do Kelvin a este gateway e habilitar por cliente; o Maglink continua no legado até
sua migração explícita.

Fontes oficiais consultadas em 2026-10-05:
- [Z-API Web — índice de endpoints](https://developer.z-api.io/llms.txt)
- [Z-API Omni — índice de endpoints](https://developer.omni.z-api.io/llms.txt)
- [Assinatura de webhooks](https://developer.omni.z-api.io/webhooks/signature)
- [Exemplos de recebimento Web](https://developer.z-api.io/webhooks/on-message-received-examples)
- [Repositório upstream Omni](https://github.com/automagik-dev/omni)


## Collection pública do Postman

Referência adicional: [Z-API Collection](https://www.postman.com/docs-z-api/z-api-s-public-workspace/collection/gwri249/z-api-collection).
Consulta parcial pelo navegador em 2026-10-05, sem autenticação e sem executar
requests. A página inicial apresentou `Collection not found`, mas foi possível
abrir os exemplos individuais pela árvore da collection.

Os exemplos consultados confirmam os contratos já usados pelo adapter Web:

| Operação | Contrato observado | Implementação |
| --- | --- | --- |
| Texto | `POST /instances/{instanceId}/token/{token}/send-text`, header `Client-Token`, body `phone` e `message`; resposta com `messageId` e `zaapId` | `ZapiClient.send` |
| Leitura | `POST /instances/{instanceId}/token/{token}/read-message`, mesmo header, body `phone` e `messageId`; resposta `value: true` | `ZapiWebPlugin.markAsRead` |

A árvore também lista encaminhamento, fixar/desafixar mensagens, PTV, carrosséis,
produtos, pedidos, registro de dispositivo, comunidades e administração de grupos.
Esses recursos ainda não estão implementados nesta branch. O adapter cobre o
contrato comum descrito na matriz acima; não equivale à cobertura integral da
collection. `delayMessage`, `delayTyping` e edição de texto de saída por
`editMessageId`, documentados no exemplo de texto, também não são expostos pelo
adapter. Receber callbacks de edição não implica poder editar mensagens de saída.

A collection consultada utiliza o contrato Web de instâncias e tokens. Ela não
valida o contrato Oficial Z-API Omni, que possui documentação e autenticação
separadas. Nenhuma comparação completa dos payloads da collection foi realizada.
