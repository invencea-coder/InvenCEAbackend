// seedArchiCE.js
// Seeds all PMP equipment into the Archi & CE room (room_id = 1)
// Run from backend root: node seedArchiCE.js

// Use __dirname so .env is found regardless of which directory you run node from
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { query, withTransaction } = require('./src/config/db');

const ROOM_ID = 1; // Archi & CE

const items = [
  { name: "Hydraulic Bench and Accessories", barcode: "78700680751", category: "Fluid Mechanics/ Hydraulics Laboratory" },
  { name: "Flow Visualization Channel", barcode: "1272839961", category: "Fluid Mechanics/ Hydraulics Laboratory" },
  { name: "Hydraulics Apparatus", barcode: "732757774", category: "Fluid Mechanics/ Hydraulics Laboratory" },
  { name: "Dissolved Oxygen Analyzer", barcode: "490815440", category: "Fluid Mechanics/ Hydraulics Laboratory" },
  { name: "Turbidity Meter", barcode: "328022773351", category: "Fluid Mechanics/ Hydraulics Laboratory" },
  { name: "Water Quality Tester", barcode: "408463554639", category: "Fluid Mechanics/ Hydraulics Laboratory" },
  { name: "Total Station, Topcon \"Japan\" 5 sec. Accuracy or higher, 26 or higher SN. GTS-10 5N GH", barcode: "3773782523", category: "Surveying Instruments" },
  { name: "Micrometer Theodolite 360 degrees 30x magnification", barcode: "88617035", category: "Surveying Instruments" },
  { name: "Transit, Optical Theodolite 106JAE w/Aluminum Tripod, SOKKISHA NO10C", barcode: "02620468805", category: "Surveying Instruments" },
  { name: "Transit, Optical Theodolite 106JAE w/Aluminum Tripod, SOKKISHA NO10C", barcode: "60859027", category: "Surveying Instruments" },
  { name: "Transit, HENGUAN", barcode: "87003928", category: "Surveying Instruments" },
  { name: "Transit, Theodolite 1 min. accuracy w/ Tripod", barcode: "7323009368", category: "Surveying Instruments" },
  { name: "Transit, Theodolite 1 min. accuracy w/ Tripod", barcode: "34649756671", category: "Surveying Instruments" },
  { name: "Transit, Theodolite 1 min. accuracy w/ Tripod", barcode: "833787224522", category: "Surveying Instruments" },
  { name: "Auto Level Topcon at 6m 22x magnificator 1 deg. M div. w/ alu. Tripod", barcode: "69324127", category: "Surveying Instruments" },
  { name: "Auto Level Topcon at 6m 22x magnificator 1 deg. M div. w/ alu. Tripod", barcode: "1812714906", category: "Surveying Instruments" },
  { name: "Auto Level Topcon at 6m 22x magnificator 1 deg. M div. w/ alu. Tripod", barcode: "953283453", category: "Surveying Instruments" },
  { name: "Automatic Level w/ Tripod, CST/Berger (32x)", barcode: "07281825542", category: "Surveying Instruments" },
  { name: "Automatic Level w/ Tripod, CST/Berger (32x)", barcode: "118806398", category: "Surveying Instruments" },
  { name: "Automatic Level w/ Tripod, CST/Berger (32x) (2 units)", barcode: "688924376", category: "Surveying Instruments" },
  { name: "Electronic Laser Theodolite, SETL, SDJ-202LN w/ tripod", barcode: "577221121682", category: "Surveying Instruments" },
  { name: "Electronic Laser Theodolite, SETL, SDJ-202LN w/ tripod (2 units)", barcode: "161394194", category: "Surveying Instruments" },
  { name: "Compass, Surveyor Handheld 0.360 deg. BRUNTON USA", barcode: "44285693", category: "Surveying Instruments" },
  { name: "Compass, Surveyor Handheld 0.360 deg. BRUNTON USA", barcode: "185549699", category: "Surveying Instruments" },
  { name: "Compass, Surveyor Handheld 0.360 deg. BRUNTON USA", barcode: "9322740206", category: "Surveying Instruments" },
  { name: "Handheld GPS, Etrex Touch 35", barcode: "956755710", category: "Surveying Instruments" },
  { name: "Handheld GPS, Etrex Touch 35", barcode: "02933908", category: "Surveying Instruments" },
  { name: "Handheld GPS, Etrex Touch 35", barcode: "60463320", category: "Surveying Instruments" },
  { name: "Handheld GPS, Etrex Touch 35", barcode: "58657674", category: "Surveying Instruments" },
  { name: "Measuring Tape (16 units)", barcode: "546928991161", category: "Surveying Instruments" },
  { name: "Aluminum Grade Leveling Rod, 3m", barcode: "211764875882", category: "Surveying Instruments" },
  { name: "Stadia Rod (5 units)", barcode: "65163623", category: "Surveying Instruments" },
  { name: "Universal Testing Machine, (STM) Korea, Dial type", barcode: "633210947126", category: "Materials Testing Laboratory" },
  { name: "Compression Testing Machine 50 tons cap. w/ single gauge", barcode: "878649422122", category: "Materials Testing Laboratory" },
  { name: "Vicat apparatus standard unit set with glass plate, needle and conical ring (3 units)", barcode: "9814728409", category: "Materials Testing Laboratory" },
  { name: "Vicat apparatus standard unit set with glass plate, needle and conical ring (2 units)", barcode: "74246819", category: "Materials Testing Laboratory" },
  { name: "Slump test with set local cone base & rod (2 units)", barcode: "43728771445", category: "Materials Testing Laboratory" },
  { name: "Slump Cone Set Punching Press with tamping rod and base plate (6 units)", barcode: "3607987913", category: "Materials Testing Laboratory" },
  { name: "Beam Mold 6\"x6\"x21\" (4 units)", barcode: "337299970", category: "Materials Testing Laboratory" },
  { name: "Beam Mold 6\"x6\"x21\" (6 units)", barcode: "603575903", category: "Materials Testing Laboratory" },
  { name: "Cylinder Mold 6\"x12\"x1/4\" (12 units)", barcode: "700614250563", category: "Materials Testing Laboratory" },
  { name: "Cylinder Mold 6\"x12\"x1/4\" (12 units)", barcode: "80757771709", category: "Materials Testing Laboratory" },
  { name: "Bulk Density of Cement, Proeti Model C00067", barcode: "598234153691", category: "Materials Testing Laboratory" },
  { name: "LCD Ultrasonic Rebound Hammer, STHTY=1", barcode: "492495116", category: "Materials Testing Laboratory" },
  { name: "LCD Ultrasonic Rebound Hammer, STHTY=1", barcode: "028195215032", category: "Materials Testing Laboratory" },
  { name: "Micrometer Caliper (digital) 0-25mm (5 units)", barcode: "49021062", category: "Materials Testing Laboratory" },
  { name: "Vernier Caliper (digital) 150mm Metal 6\" Stainless (5 units)", barcode: "5155519368", category: "Materials Testing Laboratory" },
  { name: "Steel Vernier Caliper (Manual) (5 units)", barcode: "1739416604", category: "Materials Testing Laboratory" },
  { name: "Tamping Rod (8 units)", barcode: "201901250", category: "Materials Testing Laboratory" },
  { name: "Portable Concrete Mixer, Hapda SX-125 (2 units)", barcode: "6932648060", category: "Materials Testing Laboratory" },
  { name: "Portable Concrete Mortar Mixer, Red Verge (3 units)", barcode: "9092327760", category: "Materials Testing Laboratory" },
  { name: "Cement Paste Mixer (Lab Mixer), YF, STJJJ-6", barcode: "64600598830", category: "Materials Testing Laboratory" },
  { name: "Cement Paste Mixer (Lab Mixer), YF, STJJJ-6, 200907", barcode: "645378641", category: "Materials Testing Laboratory" },
  { name: "Shovel (11 units)", barcode: "3941780857", category: "Materials Testing Laboratory" },
  { name: "Compression mold (6 units)", barcode: "868708706", category: "Soil Mechanics Laboratory" },
  { name: "Compaction Mold 4\" dia with base plate and collar (8 units)", barcode: "45984320", category: "Soil Mechanics Laboratory" },
  { name: "Sand Density Cone with Plate (3 units)", barcode: "854875603260", category: "Soil Mechanics Laboratory" },
  { name: "Mechanical Splitter (2 units)", barcode: "79469696659", category: "Soil Mechanics Laboratory" },
  { name: "Soil Auger (4 units)", barcode: "099229452", category: "Soil Mechanics Laboratory" },
  { name: "Shrinkage limit devices S011/RMU", barcode: "1622485999", category: "Soil Mechanics Laboratory" },
  { name: "Liquid limit Test Set NO. FM 40047 SN ISO 9001", barcode: "035146867658", category: "Soil Mechanics Laboratory" },
  { name: "Liquid limit Test Set NO. FM 40047 SN ISO 9001", barcode: "9634060011", category: "Soil Mechanics Laboratory" },
  { name: "Liquid limit Test Set NO. FM 40047 SN ISO 9001", barcode: "306712697", category: "Soil Mechanics Laboratory" },
  { name: "Motorized & Manual Liquid Limit Device (Casagrande)", barcode: "6601407402", category: "Soil Mechanics Laboratory" },
  { name: "Motorized Liquid Limit Device, S0042/X", barcode: "07072528385", category: "Soil Mechanics Laboratory" },
  { name: "Shrinkage Testing Meter w/ dial gauge", barcode: "293641313", category: "Soil Mechanics Laboratory" },
  { name: "Speed Moisture Tester HL Scientific (Economic Model) Malaysia, ABS Carrying Case", barcode: "190943512", category: "Soil Mechanics Laboratory" },
  { name: "Weighing Scale \"O-HAUS\" Multi-purpose 16 kg. Cap (field Scale)", barcode: "64960738254", category: "Soil Mechanics Laboratory" },
  { name: "Platform Scale, Asuki, Model No. KW-01A 150kg max. capacity", barcode: "18310755117", category: "Soil Mechanics Laboratory" },
  { name: "Sieve Shaker, Y5, STSJ-4A", barcode: "6679875719", category: "Soil Mechanics Laboratory" },
  { name: "Sieve Test, Standard, with Pan & Cover", barcode: "635941942", category: "Soil Mechanics Laboratory" },
  { name: "Sieve (US) No. 4, 10, 40 & 200 w/ pan & cover, Tyler", barcode: "89018588", category: "Soil Mechanics Laboratory" },
  { name: "Sieve (US) No. 4, 10, 40 & 200 w/ pan & cover, Tyler", barcode: "066686467", category: "Soil Mechanics Laboratory" },
  { name: "Sieve (US) No. 4, 10, 40 & 200 w/ pan & cover, Tyler", barcode: "117634563", category: "Soil Mechanics Laboratory" },
  { name: "Sieve (US) No. 4, 10, 40 & 200 w/ pan & cover, Tyler", barcode: "65791650029", category: "Soil Mechanics Laboratory" },
  { name: "Sieve (US) No. 4, 10, 40 & 200 w/ pan & cover, Tyler", barcode: "476826121", category: "Soil Mechanics Laboratory" },
  { name: "Digital Electronic Balance Shimadzu, Japan, 2200g. Capacity (UW/UX2200S)", barcode: "11562634068", category: "Soil Mechanics Laboratory" },
  { name: "Digital Electronic Balance Shimadzu, Japan, 8200g. Capacity (UW/UX8200S)", barcode: "46771996751", category: "Soil Mechanics Laboratory" },
  { name: "Solution Beam Balance HD \"OHAUS\" 20kg. 1.0 sensitivity", barcode: "88315256", category: "Soil Mechanics Laboratory" },
  { name: "Triple Beam Balance O HAUS 750-5W 2610 cap. 0.1 g sensitivity", barcode: "94327851172", category: "Soil Mechanics Laboratory" },
  { name: "Rapid Moisture Tester", barcode: "54975867404", category: "Soil Mechanics Laboratory" },
  { name: "Rapid Moisture Tester", barcode: "943369527", category: "Soil Mechanics Laboratory" },
  { name: "California Bearing Ratio (CBR), NL Scientific, Model No. 7020x010 with Accessories", barcode: "01395362", category: "Soil Mechanics Laboratory" },
  { name: "Oven with built-in thermostatic display, YF, Model: STHX-4A", barcode: "492044661155", category: "Soil Mechanics Laboratory" },
];

async function seed() {
  console.log(`Seeding ${items.length} items into room_id=${ROOM_ID}...`);
  let inserted = 0;
  await withTransaction(async (client) => {
    for (const item of items) {
      // Upsert inventory_type by name
      let typeRow = await client.query(
        `SELECT id FROM inventory_types WHERE name = $1 LIMIT 1`,
        [item.name]
      );
      let typeId;
      if (typeRow.rows.length) {
        typeId = typeRow.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO inventory_types (name, sku, category, type, metadata)
           VALUES ($1, $2, $3, 'borrowable', '{}')
           RETURNING id`,
          [item.name, item.barcode, item.category]
        );
        typeId = ins.rows[0].id;
      }
      // Insert physical inventory item (skip if barcode already exists)
      const exists = await client.query(
        `SELECT id FROM inventory_items WHERE barcode = $1 LIMIT 1`,
        [item.barcode]
      );
      if (!exists.rows.length) {
        await client.query(
          `INSERT INTO inventory_items (inventory_type_id, barcode, location_room_id, status, metadata)
           VALUES ($1, $2, $3, 'available', '{}')`,
          [typeId, item.barcode, ROOM_ID]
        );
        inserted++;
      }
    }
  });
  console.log(`Done. Inserted ${inserted} new items (skipped duplicates).`);
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });