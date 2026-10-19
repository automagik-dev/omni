// Settled reasoning of every loaded step in a Turn, shown once on the first step that has
// reasoning: only steps with reasoning get a reasoning part to render it. A step still
// thinking stays out until it settles; the activity row shows it meanwhile.
export function turnReasoning(steps, current) {
  const members = steps.length ? steps : [current]
  if (members.find(step => stepReasoning(step) !== '')?.step !== current.step) return ''
  return members.filter(step => !thinkingLive(step)).map(stepReasoning).filter(Boolean).join('\n\n')
}

const texts = step => step.blocks.filter(block => block.kind === 'text' && block.text.trim() !== '')

const thinkingLive = step => step.status === 'running' && texts(step).length === 0 && step.blocks.some(block => block.kind === 'reasoning')

const stepReasoning = step => step.blocks.filter(block => block.kind === 'reasoning').map(block => block.text).join('\n').trim()
