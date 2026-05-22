# A2A 1.0 Agent Interoperability / WHY

## Rationale

Omni already contains the foundations for A2A:

- `packages/channel-a2a` exposes a channel-like A2A server skeleton.
- `packages/core/src/providers/a2a-client.ts` and `a2a-provider.ts` let Omni call
  external A2A-like agents.
- `agent_providers.schema` accepts `a2a`.
- `agents.agent_card`, `agents.capabilities`, and `agents.metadata` can hold
  durable agent metadata.

The current implementation is not enough for the target outcome because it is
based on older A2A shapes: `/.well-known/agent.json`, JSON-RPC methods like
`message/send`, lowercase roles/states, parts with `type`, static card data, and
stubbed task operations.

The target outcome is not just "an endpoint exists". The target is that another
internal system can discover Omni agents, see each agent's parameters, select a
compatible protocol interface, and talk to that agent through Omni.

## Decisions

- Use official A2A v1.0 docs as the normative target.
- Implement JSON-RPC v1.0 first because Omni already has a JSON-RPC A2A
  skeleton and provider.
- Do not advertise HTTP+JSON/REST or gRPC until those bindings exist and are
  tested.
- Keep A2A as an external protocol boundary. Internally, Omni should continue
  using `message.received`, dispatcher resolution, providers, and channel
  response paths.
- Treat multi-agent discovery as an Omni product/API concern on top of A2A,
  because A2A well-known discovery returns an Agent Card for a server/interface,
  not a standardized multi-agent catalog API.
- Store individual agent parameters in durable data (`agents.agent_card`,
  `agents.metadata`, explicit schema fields) and expose them through cards or a
  registry. Do not hide them in code constants.

## Rejected Alternatives

- Do not keep only the legacy A2A 0.3 endpoint and call it "1.0 compatible".
- Do not make a single static Omni Agent Card stand in for all agents.
- Do not expose sensitive internal agent parameters in unauthenticated public
  cards.
- Do not bypass the dispatcher for A2A calls unless there is a documented reason
  and equivalent access/routing semantics are implemented.

## References

- https://a2a-protocol.org/latest/announcing-1.0/
- https://a2a-protocol.org/latest/specification/
- https://a2a-protocol.org/latest/definitions/
- https://a2a-protocol.org/latest/topics/agent-discovery/
- https://a2a-protocol.org/latest/whats-new-v1/
