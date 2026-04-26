const bcrypt = require('bcrypt');

async function generateHash() {
  // We are hashing your specific password with 12 salt rounds (matching your auth.service.js)
  const hash = await bcrypt.hash('1nv3nc3@', 12);
  console.log('Copy this hash:\n', hash);
}

generateHash();