import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const teammates = sqliteTable('teammates', {
  id: text('id').primaryKey(),
  name: text('name').notNull()
})

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value')
})

export const turns = sqliteTable('turns', {
  ownerId: text('owner_id').primaryKey(),
  botId: text('bot_id').notNull(),
  ownerBody: text('owner_body').notNull(),
  botLineId: text('bot_line_id').notNull(),
  botBody: text('bot_body').notNull(),
  createdAt: integer('created_at').notNull()
})

export const roomLines = sqliteTable('room_lines', {
  n: integer('n').primaryKey(),
  id: text('id').notNull().unique(),
  speakerKind: text('speaker_kind').notNull(),
  speakerBotId: text('speaker_bot_id'),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull()
})

export const pendingApprovals = sqliteTable('pending_approvals', {
  id: text('id').primaryKey(),
  botId: text('bot_id').notNull(),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull()
})

export const approvalAudit = sqliteTable('approval_audit', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  botId: text('bot_id').notNull(),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  payload: text('payload').notNull(),
  decision: text('decision').notNull(),
  requestedAt: integer('requested_at').notNull(),
  decidedAt: integer('decided_at').notNull()
})

export const schema = { teammates, meta }
export const talkSchema = { turns, roomLines }
export const approvalSchema = { pendingApprovals, approvalAudit }
