const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env.test') });
if (process.env.NODE_ENV !== 'test') throw new Error("NODE_ENV must be test");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
if (!process.env.DATABASE_URL.includes('lia_test')) throw new Error("DATABASE_URL must point to lia_test");
if (process.env.DATABASE_URL.includes('lia_db')) throw new Error("TESTS CANNOT RUN AGAINST lia_db");
