import mongoose from 'mongoose';

export default async function DBConnect() {
  if (mongoose.connection.readyState === 1) return; 
  const uri = process.env.MONGOCONNECT;
  if (!uri) throw new Error('MONGOCONNECT is missing');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  console.log('✅ DB connected');
}