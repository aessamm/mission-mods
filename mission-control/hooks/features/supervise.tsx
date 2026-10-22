// /supervise [text]: a short way into the board-supervisor skill. It fills the composer with
// /board-supervisor and any text given, for the person to send; it runs nothing itself.
import type { On } from 'claude-code'

// "/supervise check the board" → "/board-supervisor check the board".
export const superviseText = (args: string): string => `/board-supervisor${args.trim() ? ` ${args.trim()}` : ''}`

export function registerSupervise(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'supervise',
      description: 'Run the project the board-supervisor way: GitHub Issues, a live board, side sessions. Fills the composer with /board-supervisor',
      argumentHint: '[what to do]',
    })
    return started
  })

  on('command.run', { command: 'supervise' }, async ($, e) => {
    const text = superviseText(String(e.args ?? ''))
    const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => undefined)
    return { text: r?.isFilled ? `The composer has ${text}. Send it to start.` : `Type ${text} to start.` }
  })
}
