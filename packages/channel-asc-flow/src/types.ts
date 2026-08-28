/**
 * ASC platform Flow channel types.
 */

/** Per-instance configuration resolved on `connect()`. */
export interface AscFlowConfig {
  /** Platform base URL including the `/rest/v2` prefix. */
  ascFlowBaseUrl: string;
  /** `/authuser` login. */
  ascFlowLogin: string;
  /** `/authuser` chave (secret). */
  ascFlowChave: string;
  /** `cod_servico` handed to `/transferirHumano` — the queue that receives handoffs. */
  ascFlowHandoffServico: number;
  /** Optional shared secret the flow's api_rest node echoes on each call. */
  webhookVerifyToken?: string;
}

/** Shape the flow's `api_rest` node POSTs to us. Field names are our choice. */
export interface AscFlowInboundBody {
  /** Platform ticket id — the conversation identity for this channel. */
  codAtendimento?: string | number;
  cod_atendimento?: string | number;
  /** What the beneficiary typed (or the label of the option they tapped). */
  chatInput?: string;
  message?: string;
  /** Beneficiary MSISDN, when the flow supplies it. */
  phone?: string;
  telefone?: string;
  /**
   * Per-turn id, when the flow can supply one. Enables inbound dedupe; without
   * it every delivery is treated as new (see the handler doc).
   */
  messageId?: string;
  idMensagem?: string;
}

/** A `{ok, code, body}` triple — the platform never uses HTTP status alone. */
export interface AscFlowResponse {
  status: number;
  body: unknown;
}

/** The URA fields `POST /mensagem` accepts alongside a text bubble. */
export interface AscFlowUra {
  /** Ordinal → label, e.g. `{"1": "Manhã", "2": "Tarde"}`. */
  ura_opcoes: Record<string, string>;
  /** true → reply buttons; false → list. */
  forcar_botoes: boolean;
}
