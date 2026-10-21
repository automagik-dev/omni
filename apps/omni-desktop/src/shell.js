// The frame page's script: window buttons, and the window state main.js sends.
const { platform, act, onState } = window.omniWindow
const body = document.body
body.classList.add(platform === 'darwin' ? 'darwin' : 'linux')
for (const button of document.querySelectorAll('[data-act]')) button.addEventListener('click', () => act(button.dataset.act))
onState((state) => {
  body.classList.toggle('max', state.maximized === true)
  body.classList.toggle('ready', state.ready === true)
  if (typeof state.status === 'string') {
    const status = document.getElementById('status')
    status.textContent = state.status
    status.classList.toggle('bad', state.problem === true)
  }
})
