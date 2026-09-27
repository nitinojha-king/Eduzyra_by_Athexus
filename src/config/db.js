import mongoose from 'mongoose'

export async function connectDB() {
  const uri = process.env.MONGO_URI

  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and configure it.')
  }

  mongoose.set('strictQuery', true)

  const conn = await mongoose.connect(uri)
  console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`)
  return conn
}
