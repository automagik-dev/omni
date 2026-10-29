// Issue #1403 inventory shared by the page and its bounded host endpoints.

export const GROUPS = [
  ['Agent reply behaviour', 'agentReplyFilter agentSessionStrategy agentPrefixSenderName agentGateEnabled agentGateModel agentGatePrompt agentWaitForMedia agentSendMediaPath agentSendMediaPathTypes agentStalledTimeoutMs messageSupersedeMode enableAutoSplit messageFormatMode disableUsernamePrefix'],
  ['Triggers / routing / session', 'triggerEvents triggerReactions triggerMentionPatterns triggerMode agentChainToInstanceId chainMode sessionReset inboundMaxAgeMinutes replayEnabled inboundReplyContext'],
  ['Debounce', 'messageDebounceMode messageDebounceMinMs messageDebounceGroupMs messageDebounceMaxMs messageDebounceRestartOnTyping messageDebounceMaxWaitMs'],
  ['Split', 'messageSplitDelayMode messageSplitDelayFixedMs messageSplitDelayMinMs messageSplitDelayMaxMs'],
  ['Acks / receipts / presence', 'reactionAck reactionAckEmoji ackTimeoutMs agentAckMessage readReceipts markOnlineOnConnect'],
  ['Media', 'processAudio processImages processVideo processDocuments processMediaOnBlocked downloadMediaOnSync audioTranscription'],
  ['Access / history', 'accessMode groupHistorySize historyIdentity syncFullHistory'],
  ['Voice', 'ttsVoiceId ttsModelId'], ['Follow-up / close', 'followUpConfig closeContactConfig'],
  ['Pacing', 'outboundPacing outboundPacingOverride'], ['Provider', 'agentProviderId'],
  ['Meta connection', 'metaPhoneNumberId metaWabaId metaAppId metaBusinessId metaApiVersion metaConnectionMethod metaConnectedAt metaDisplayPhoneNumber'],
].map(([label, keys]) => ({ label, keys: keys.split(' ') }))
const enums = {
  agentSessionStrategy: ['per_user', 'per_chat', 'per_thread'], messageSupersedeMode: ['off', 'discard'],
  messageFormatMode: ['convert', 'passthrough'], triggerMode: ['round-trip', 'fire-and-forget'],
  chainMode: ['off', 'forward', 'bidirectional'], messageDebounceMode: ['disabled', 'fixed', 'randomized', 'presence'],
  messageSplitDelayMode: ['disabled', 'fixed', 'randomized'], reactionAck: ['on', 'off'],
  readReceipts: ['on', 'off', 'exclude-self'], audioTranscription: ['auto', 'off'],
  accessMode: ['disabled', 'blocklist', 'allowlist'], historyIdentity: ['desktop', 'web'],
  outboundPacing: ['humanized', 'immediate'], metaConnectionMethod: ['manual', 'embedded_signup'],
}
const set = text => new Set(text.split(' '))
const nullable = set('agentId agentProviderId agentReplyFilter agentGateModel agentGatePrompt agentSendMediaPathTypes triggerEvents triggerReactions triggerMentionPatterns agentChainToInstanceId sessionReset messageDebounceGroupMs messageDebounceMaxWaitMs reactionAckEmoji agentAckMessage ttsVoiceId ttsModelId followUpConfig closeContactConfig metaPhoneNumberId metaWabaId metaAppId metaBusinessId metaConnectionMethod metaConnectedAt metaDisplayPhoneNumber')
const json = set('agentReplyFilter sessionReset reactionAckEmoji followUpConfig closeContactConfig')
const arrays = set('agentSendMediaPathTypes triggerEvents triggerReactions triggerMentionPatterns')
const examples = { agentReplyFilter: '{"mode":"filtered","conditions":{"onDm":true,"onMention":true}}', sessionReset: '{"dm":{"mode":"idle","minutes":60},"group":{"mode":"daily","hour":0}}', followUpConfig: '{"enabled":true,"schedule":{"kind":"fixed","intervalsMinutes":[30]},"maxFollowUps":2,"promptTemplate":"Follow up","stopOutsideMessagingWindow":true,"showTypingIndicator":false}', closeContactConfig: '{"no_response":{"cooldownMs":3600000,"escalationThreshold":null}}' }
const strings = set('agentId agentProviderId agentGateModel agentGatePrompt agentChainToInstanceId agentAckMessage ttsVoiceId ttsModelId metaPhoneNumberId metaWabaId metaAppId metaBusinessId metaApiVersion metaConnectedAt metaDisplayPhoneNumber')
export const FIELDS = Object.fromEntries([...GROUPS.flatMap(group => group.keys), 'agentId'].map(key => {
  const options = enums[key]
  const kind = options ? 'enum' : json.has(key) || arrays.has(key) ? 'json' : strings.has(key) ? 'string' : /Ms$|Minutes$|Size$/.test(key) ? 'number' : 'boolean'
  return [key, { key, kind, options, nullable: nullable.has(key), readOnly: key === 'agentProviderId', example: examples[key] ?? (arrays.has(key) ? '["value"]' : undefined) }]
}))
// Zod is supplied by the host, never bundled into the browser just for the inventory.
export function settingsSchemas(z) {
  const shape = Object.fromEntries(Object.values(FIELDS).map(({ key, kind, options, nullable: clearable }) => {
    let schema = options ? z.enum(options) : arrays.has(key) ? z.array(z.string().max(4096)).max(256) : json.has(key) ? z.json().refine(value => JSON.stringify(value).length <= 20000) : kind === 'number' ? z.number().int().nonnegative() : kind === 'boolean' ? z.boolean() : z.string().max(20000)
    if (key === 'agentId' || key === 'agentProviderId' || key === 'agentChainToInstanceId') schema = z.string().uuid()
    if (key === 'groupHistorySize') schema = z.number().int().min(0).max(200)
    if (key === 'ackTimeoutMs') schema = z.number().int().min(0).max(120000)
    if (/^meta(PhoneNumberId|WabaId|AppId|BusinessId)$/.test(key)) schema = z.string().min(1).max(64)
    if (key === 'metaDisplayPhoneNumber') schema = z.string().max(32)
    if (key === 'metaApiVersion') schema = z.string().regex(/^v\d+\.\d+$/).max(16)
    if (key === 'metaConnectedAt') schema = z.iso.datetime({ offset: true })
    return [key, (clearable ? schema.nullable() : schema).optional()]
  }))
  return { read: z.object(shape), patch: z.object(shape).omit({ agentProviderId: true }).strict() }
}
export function inputValue(field, text) {
  if (field.kind === 'json') {
    try { return JSON.parse(text) } catch { throw new Error(`${field.key}: enter valid JSON`) }
  }
  if (field.kind === 'number') {
    const value = Number(text)
    if (text.trim() === '' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field.key}: enter a nonnegative integer`)
    return value
  }
  if (field.kind === 'boolean' && !['true', 'false'].includes(text)) throw new Error(`${field.key}: choose true or false`)
  if (field.options && !field.options.includes(text)) throw new Error(`${field.key}: choose a value`)
  return field.kind === 'boolean' ? text === 'true' : text
}
export const fieldText = (field, value) => value === undefined ? '' : field.kind === 'json' ? JSON.stringify(value, null, 2) : value === null ? '' : String(value)
