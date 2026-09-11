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

export const schema = { teammates, meta }
export const talkSchema = { turns }
