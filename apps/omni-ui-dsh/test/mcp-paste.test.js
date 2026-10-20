import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractSecrets, mcpRequest } from '../src/client/mcp-paste.js'

test('keys in pasted MCP setups become secret references, wherever the docs put them', () => {
  const json = extractSecrets('{"mcpServers":{"brave":{"command":"npx","args":["-y","server-brave"],"env":{"BRAVE_API_KEY":"BSAFAKE0testFAKE0test"}}}}')
  assert.match(json.text, /"BRAVE_API_KEY":"\$DSH_SECRET_BRAVE_API_KEY"/)
  assert.deepEqual(json.secrets, [{ name: 'BRAVE_API_KEY', value: 'BSAFAKE0testFAKE0test' }])
  const shell = extractSecrets('env LINEAR_TOKEN=lin_api_FAKE0testFAKE0te npx -y linear-mcp')
  assert.equal(shell.text, 'env LINEAR_TOKEN=$DSH_SECRET_LINEAR_TOKEN npx -y linear-mcp')
  assert.equal(extractSecrets('https://mcp.example.com/sse?api_key=abc123def456ghi789&team=x').text, 'https://mcp.example.com/sse?api_key=$DSH_SECRET_API_KEY&team=x')
  assert.match(extractSecrets('{"headers":{"Authorization":"Bearer eyJabc.def.ghi123456"}}').text, /"Authorization":"Bearer \$DSH_SECRET_MCP_AUTH_TOKEN"/)
  const bare = extractSecrets('put sk-proj-FAKE0testFAKE0testFAKE in the header')
  assert.equal(bare.text, 'put $DSH_SECRET_MCP_API_KEY in the header')
  for (const result of [json, shell, bare]) for (const { value } of result.secrets) assert.equal(result.text.includes(value), false)
})

test('placeholders and plain settings are left as they are', () => {
  const text = '{"env":{"API_KEY":"<your-api-key>","DEBUG":"true","TOKEN":"${TOKEN}"}}'
  assert.deepEqual(extractSecrets(text), { text, secrets: [] })
})

test('the same value pasted twice is one secret', () => {
  const { secrets } = extractSecrets('{"API_KEY":"abcdef0123456789","OTHER_TOKEN":"abcdef0123456789"}')
  assert.equal(secrets.length, 1)
})

test('the request to the Main Bot keeps the references and asks instead of guessing', () => {
  const request = mcpRequest('  npx -y thing  ')
  assert.match(request, /save_capability/)
  assert.match(request, /\$DSH_SECRET_<NAME>: keep those references/)
  assert.match(request, /<<<\nnpx -y thing\n>>>$/)
})
