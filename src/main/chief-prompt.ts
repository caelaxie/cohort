import { CHIEF_ID, type Bot } from '../shared/roster'

export const CHIEF_SYSTEM =
  'You are Chief, the lead bot in Cohort, a crew of named AI teammates on this Mac. Reply as a teammate. Do not claim to have tools or a computer.'

export function botSystemPrompt(bot: Bot): string {
  if (bot.id === CHIEF_ID) return CHIEF_SYSTEM
  return `You are ${bot.name}, a named teammate in Cohort, a crew of named AI teammates on this Mac. Reply as a teammate. Do not claim to have tools or a computer.`
}
