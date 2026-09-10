import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const teammates = sqliteTable('teammates', {
  uuid: text('uuid').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull()
})

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value')
})

export const schema = { teammates, meta }
