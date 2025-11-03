import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import bcrypt from 'bcrypt'

async function makeAdmin() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL not found in environment variables')
    console.log('Make sure you have a .env or .env.local file with DATABASE_URL')
    process.exit(1)
  }

  // Get email and password from command line arguments
  const email = process.argv[2]
  const plaintextPassword = process.argv[3]

  if (!email || !plaintextPassword) {
    console.error('❌ ERROR: Missing required arguments')
    console.log('Usage: tsx scripts/makeAdmin.ts <email> <password>')
    console.log('Example: tsx scripts/makeAdmin.ts john@example.com SecurePass123!')
    process.exit(1)
  }

  console.log('Database URL:', process.env.DATABASE_URL.substring(0, 30) + '...')

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const db = drizzle(pool)

  console.log(`Processing user: ${email}`)

  try {
    // First, try to find the existing user
    const existingUser = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1)

    if (existingUser.length > 0) {
      // User exists, update to admin
      console.log('👤 User found, promoting to admin...')
      const result = await db
        .update(user)
        .set({ role: 'admin' })
        .where(eq(user.email, email))
        .returning()

      console.log('✅ SUCCESS! User is now an admin:')
      console.log('   ID:', result[0].id)
      console.log('   Email:', result[0].email)
      console.log('   Role:', result[0].role)
    } else {
      // User doesn't exist, create them as admin
      console.log('👤 User not found, creating new admin user...')
      console.log('🔐 Hashing password...')
      
      // Hash the password with bcrypt (10 salt rounds)
      const hashedPassword = await bcrypt.hash(plaintextPassword, 10)
      
      const result = await db
        .insert(user)
        .values({
          id: nanoid(21),
          email: email,
          password: hashedPassword,
          role: 'admin',
        })
        .returning()

      console.log('✅ SUCCESS! New admin user created:')
      console.log('   ID:', result[0].id)
      console.log('   Email:', result[0].email)
      console.log('   Role:', result[0].role)
      console.log('   Password has been securely hashed')
    }
  } catch (error) {
    console.error('❌ ERROR:', error)
  } finally {
    await pool.end()
    process.exit(0)
  }
}

makeAdmin()