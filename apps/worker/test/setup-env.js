const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
console.log("DATABASE_URL FROM SETUP-ENV IS: ", process.env.DATABASE_URL);
