import 'dotenv/config' 
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'

async function makeAdmin() {
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL not found in environment variables')
    console.log('Make sure you have a .env or .env.local file with DATABASE_URL')
    process.exit(1)
  }

  console.log('Database URL:', process.env.DATABASE_URL.substring(0, 30) + '...')

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const db = drizzle(pool)

  const email = 'John@billboardsource.com'
  
  console.log(`Promoting user: ${email}`)
  
  try {
    const result = await db
      .update(user)
      .set({ role: 'admin' })
      .where(eq(user.email, email))
      .returning()

    if (result.length > 0) {
      console.log('✅ SUCCESS! User is now an admin:')
      console.log('   Email:', result[0].email)
      console.log('   Role:', result[0].role)
    } else {
      console.log('❌ ERROR: User not found with that email')
    }
  } catch (error) {
    console.error('❌ ERROR:', error)
  } finally {
    await pool.end()
    process.exit(0)
  }
}

makeAdmin()