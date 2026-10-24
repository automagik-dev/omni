// A tool's text result, drawn as the team's own tools draw theirs (bots-dsh src/host/tools.js).
export const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
