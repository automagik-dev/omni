import { createElement as h, Fragment, useEffect, useState } from 'react'
import { call, t } from './core.js'

// Keep the shared verify token only in this panel's memory, never the overview or team state.
export function MetaWebhookSetup({ request = call, initiallyOpen = false, writable = true }) {
  const [open, setOpen] = useState(initiallyOpen)
  const [setup, setSetup] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [problem, setProblem] = useState('')
  const [copied, setCopied] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || !writable) return
    let live = true
    setSetup(null); setRevealed(false); setProblem(''); setCopied('')
    request('omni-wab-webhook-setup').then(reply => {
      if (live) setSetup(reply)
    }, () => { if (live) setProblem(t('Could not load webhook setup. Try again or ask an admin.')) })
    return () => { live = false }
  }, [open, writable, request, attempt])

  const copy = async (name, value) => {
    setCopied(''); setProblem('')
    try {
      await navigator.clipboard.writeText(value)
      setCopied(name)
    } catch { setProblem(t('Could not copy. Reveal or select the value and copy it manually.')) }
  }
  const allowed = writable && setup?.authorized === true
  return h('section', { className: 'oc-fix', 'aria-label': 'Meta webhook setup' },
    h('h3', null, t('Meta webhook setup')),
    !open ? h('button', { type: 'button', className: 'oc-secondary', onClick: () => setOpen(true) }, t('Show webhook setup'))
      : h(Fragment, null,
        !writable || setup?.authorized === false ? h('p', null, t('Callback URL unavailable. To view webhook setup, ask an admin.'))
          : !setup && !problem ? h('p', { role: 'status' }, t('Loading webhook setup…')) : null,
        allowed ? h(Fragment, null,
          h('label', { className: 'oc-field' }, h('span', null, t('Callback URL')),
            h('input', { 'aria-label': 'Callback URL', readOnly: true, value: setup.callbackUrl ?? '', placeholder: t('Not configured') })),
          h('button', { type: 'button', className: 'oc-secondary', disabled: !setup.callbackUrl, onClick: () => copy('url', setup.callbackUrl) }, t('Copy callback URL')),
          !setup.callbackUrl ? h('p', null, t('Ask an admin to set server.public_url or OMNI_PUBLIC_URL to the public HTTPS address of this Omni.')) : null,
          h('label', { className: 'oc-field' }, h('span', null, t('Verify token')),
            h('input', { 'aria-label': 'Verify token', readOnly: true, autoComplete: 'off', type: revealed ? 'text' : 'password', value: setup.verifyToken ? revealed ? setup.verifyToken : '••••••••' : '', placeholder: t('Not configured') })),
          h('button', { type: 'button', className: 'oc-secondary', disabled: !setup.verifyToken, onClick: () => setRevealed(value => !value) }, revealed ? t('Hide verify token') : t('Reveal verify token')),
          h('button', { type: 'button', className: 'oc-secondary', disabled: !setup.verifyToken, onClick: () => copy('token', setup.verifyToken) }, t('Copy verify token')),
          !setup.verifyToken ? h('p', null, t('Ask an admin to configure META_VERIFY_TOKEN on the Omni server.')) : null,
          !setup.appSecretConfigured ? h('p', null, t('Ask an admin to configure META_APP_SECRET on the Omni server before receiving webhooks.')) : null,
          h('p', null, t('Open Meta Developers, choose your app and its WhatsApp webhook configuration. Paste Callback URL and Verify token into the matching fields, then verify and save.')),
          h('a', { href: 'https://developers.facebook.com/apps/', target: '_blank', rel: 'noreferrer' }, t('Open Meta Developers')),
          h('p', { className: 'oc-fine' }, t('The Verify token is not your Graph API access token. Connection alone does not verify the webhook; Meta must be able to reach this HTTPS URL.')),
          copied ? h('p', { role: 'status' }, copied === 'url' ? t('Callback URL copied') : t('Verify token copied')) : null) : null,
        problem ? h('p', { role: 'alert' }, problem) : null,
        writable ? h('button', { type: 'button', className: 'oc-link', onClick: () => setAttempt(value => value + 1) }, t('Reload webhook setup')) : null,
        h('button', { type: 'button', className: 'oc-link', onClick: () => { setOpen(false); setSetup(null); setRevealed(false); setCopied(''); setProblem('') } }, t('Close webhook setup'))))
}
