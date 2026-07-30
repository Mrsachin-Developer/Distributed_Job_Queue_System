import "dotenv/config";
import { Pool } from "pg";
import prisma from "./api-service/dbclient";

console.log("DATABASE_URL:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

(async () => {
  try {
    // Test pg directly
    const client = await pool.connect();
    const res = await client.query("SELECT NOW()");
    console.log("pg works:", res.rows);
    client.release();

    // Test Prisma
    const count = await prisma.job.count();
    console.log("Prisma works:", count);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
