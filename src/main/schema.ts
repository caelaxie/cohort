import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const teammates = sqliteTable('teammates', {
  id: text('id').primaryKey(),
  name: text('name').notNull()
})

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value')
})

export const schema = { teammates, meta }
