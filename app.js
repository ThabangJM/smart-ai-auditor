// cPanel Phusion Passenger entry point
if (typeof(PhusionPassenger) !== 'undefined') {
  PhusionPassenger.configure({ autoInstall: false });
}

// Load env vars from server/.env
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'server', '.env') });

// Load the Express app from server/
const app = require('./server/server');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NST Solutions backend running on port ${PORT}`);
});
