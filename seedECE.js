// seedECE.js
require('dotenv').config();
const xlsx = require('xlsx');
const { createUnifiedItem } = require('./src/services/inventory.service');

const seed = async () => {
  console.log('📖 Reading Excel file...');
  
  try {
    // Read the file directly as an Excel workbook
    const workbook = xlsx.readFile('inventory.xlsx - Inventory.csv');
    
    // Grab the first sheet
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert the sheet to a clean array of JSON objects
    const results = xlsx.utils.sheet_to_json(sheet);
    
    console.log(`🚀 Found ${results.length} items. Starting seed process...\n`);
    
    let successCount = 0;
    let failCount = 0;

    for (const item of results) {
      // Dynamically find keys in case Excel added invisible spaces
      const keys = Object.keys(item);
      const barcodeKey = keys.find(k => k.includes('Barcode'));
      const nameKey = keys.find(k => k.includes('Item Name'));
      const signalKey = keys.find(k => k.includes('Analog/Digital'));
      const serialKey = keys.find(k => k.includes('Serial Number'));

      // Safely convert to strings and trim spaces
      const barcode = barcodeKey ? String(item[barcodeKey]).trim() : null;
      const name = nameKey ? String(item[nameKey]).trim() : null;
      let signal = signalKey ? String(item[signalKey]).trim().toLowerCase() : 'n/a';
      const serial = serialKey ? String(item[serialKey]).trim() : '';

      // Skip truly empty rows
      if (!barcode || !name) {
        continue;
      }

      // Normalize signal for the frontend dropdown
      if (signal !== 'analog' && signal !== 'digital') {
        signal = 'n/a';
      }

      try {
        await createUnifiedItem({
          barcode: barcode,
          name: name,
          type: 'borrowable',
          location_room_id: 2, // Room 2: ECE-CPE
          category: 'ECE Equipment',
          item_metadata: {
            condition: 'Good',
            analog_digital: signal,
            serial_number: serial
          }
        });
        
        console.log(`✅ Seeded: ${name} (${barcode})`);
        successCount++;
      } catch (err) {
        console.error(`❌ Failed: ${name} - ${err.message}`);
        failCount++;
      }
    }

    console.log(`\n🎉 Seeding Complete!`);
    console.log(`Successfully added: ${successCount}`);
    console.log(`Failed: ${failCount}`);
    
  } catch (err) {
    console.error(`\n🚨 CRITICAL ERROR: Could not read the file. Ensure the filename is exactly correct.`);
    console.error(err.message);
  } finally {
    process.exit(0);
  }
};

seed();