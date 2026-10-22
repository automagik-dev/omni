// The frame page's script: window buttons, and the window state main.js sends.
const { platform, act, onState } = window.omniWindow
const body = document.body
body.classList.add(platform === 'darwin' ? 'darwin' : 'linux')
for (const button of document.querySelectorAll('[data-act]')) button.addEventListener('click', () => act(button.dataset.act))
onState((state) => {
  body.classList.toggle('max', state.maximized === true)
  body.classList.toggle('ready', state.ready === true)
  showUpdate(state.update)
  if (typeof state.status === 'string') {
    const status = document.getElementById('status')
    status.textContent = state.status
    status.classList.toggle('bad', state.problem === true)
  }
})

// A downloaded update offers a restart; one still downloading shows how far it is.
function showUpdate(update) {
  const button = document.getElementById('update')
  const at = update?.version ? ` ${update.version}` : ''
  button.hidden = !update
  if (!update) return
  const ready = update.state === 'ready'
  button.disabled = !ready
  button.classList.toggle('ready', ready)
  button.textContent = ready ? 'Restart to update' : `Updating · ${update.percent ?? 0}%`
  button.title = ready ? `Omni${at} is ready: restart to use it` : `Downloading Omni${at}`
}
