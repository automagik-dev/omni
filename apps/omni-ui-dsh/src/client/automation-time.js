import { t } from './i18n.js'

// When a scheduled task (DSH's schedule service) runs, in words, for the Automations page.
const pad = value => String(value).padStart(2, '0')
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function whenText(task) {
  if (task.kind === 'every') {
    const seconds = task.everySeconds ?? 0
    if (seconds % 86_400 === 0) return t('Every {n} days', { n: seconds / 86_400 })
    if (seconds % 3_600 === 0) return seconds === 3_600 ? t('Every hour') : t('Every {n} hours', { n: seconds / 3_600 })
    return t('Every {n} min', { n: Math.round(seconds / 60) })
  }
  if (task.kind === 'daily') return t('Every day at {time}', { time: task.time })
  if (task.kind === 'weekly') {
    const days = [...(task.weekdays ?? [])].sort()
    const label = days.join(',') === '1,2,3,4,5' ? t('Weekdays') : days.map(day => t(WEEKDAYS[day] ?? String(day))).join(', ')
    return t('{days} at {time}', { days: label, time: task.time })
  }
  if (task.kind === 'cron') return t('Custom ({expression})', { expression: task.expression })
  if (task.scheduledAt) {
    const at = new Date(task.scheduledAt)
    return t('Once, {date} {time}', { date: at.toLocaleDateString([], { month: 'short', day: 'numeric' }), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` })
  }
  return t('Once')
}
