// lib/mongoose.ts
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI");

declare global {
  // eslint-disable-next-line no-var
  var _mongooseConn: Promise<typeof mongoose> | undefined;
}

export async function dbConnect() {
  if (global._mongooseConn) return global._mongooseConn;

  global._mongooseConn = mongoose.connect(MONGODB_URI, {
    dbName: process.env.MONGODB_DB || "smartdocs",
    maxPoolSize: 10,
  });
  return global._mongooseConn;
}
