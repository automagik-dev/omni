import { createElement as h, useEffect } from 'react'
import { Stage, useFinish, useGate, useGlitch } from './stage.js'

// Step omni-welcome (order -300): the octopus says hello, once.
export function WelcomeStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  const [glitching, glitch] = useGlitch()
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null
  return h(Stage, {
    title: 'Welcome to Omni',
    speech: 'Hi! I\'m Omni. Every chat, every channel, one place. Let\'s get you set up.',
    at: 'omni-welcome',
    glitching,
  },
  h('p', null, 'Two quick steps: connect your Omni, so I can see your channels, and connect an AI, so I can think.'),
  h('button', { type: 'button', className: 'oai-primary', onClick: () => finish() }, 'Let\'s go'))
}
