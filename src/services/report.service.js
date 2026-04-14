const { query } = require('../config/db');
const { exportReportsToExcel } = require('../utils/excelExporter');

/**
 * Build issued report rows with optional filters
 * Aligned parameters with the controller (type, from, to) and added room_id
 */
const getIssuedReports = async ({ room_id, type, role, from, to }) => {
  const conditions = ["r.status IN ('ISSUED', 'PARTIALLY RETURNED', 'RETURNED')"];
  const values = [];
  let i = 1;

  // Role Filtering
  const activeRole = role || type;
  if (activeRole === 'faculty') {
    conditions.push(`r.requester_type = 'faculty'`);
  } else if (activeRole === 'student') {
    conditions.push(`r.requester_type = 'student'`);
  }

  // Room Filtering
  if (room_id) {
    conditions.push(`r.room_id = $${i++}`);
    values.push(room_id);
  }

  // Date Filtering
  if (from) {
    conditions.push(`r.issued_time >= $${i++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`r.issued_time <= $${i++}`);
    values.push(to + ' 23:59:59');
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT 
        r.id AS request_id,
        r.requester_type,
        
        COALESCE(s.student_id::text, r.requester_id::text) AS requester_id,
        COALESCE(u.name, s.full_name) AS requester_name,
        
        r.room_id,
        r.purpose,
        r.status AS request_status,
        
        r.created_at,
        r.created_at AS requested_time,
        r.created_at AS requested_at,
        r.approved_time,
        r.approved_time AS approved_at,
        r.issued_time,
        r.issued_time AS issued_at,
        r.return_deadline,
        r.last_return_time,
        
        -- ⚡ FIX: Filter out nulls so it never returns an empty [null] array
        COALESCE(
          json_agg(
            json_build_object(
              'item_name', COALESCE(it.name, 'Unknown Item'),
              'quantity_issued', COALESCE(ri.qty_requested, ri.quantity, 1),
              'quantity_returned', COALESCE(ri.qty_returned, 0),
              'barcode', COALESCE(ii.barcode, its.barcode, ic.barcode),
              'item_status', ri.status
            )
          ) FILTER (WHERE ri.id IS NOT NULL),
          '[]'::json
        ) as items
        
     FROM requests r
     
     LEFT JOIN users u ON u.id::text = r.requester_id::text AND r.requester_type IN ('faculty', 'admin')
     LEFT JOIN students s ON (s.id::text = r.requester_id::text OR s.student_id::text = r.requester_id::text) AND r.requester_type = 'student'
     
     LEFT JOIN request_items ri ON r.id = ri.request_id
     LEFT JOIN inventory_types it ON ri.inventory_type_id = it.id
     LEFT JOIN inventory_items ii ON ri.inventory_item_id = ii.id
     LEFT JOIN inventory_type_stocks its ON ri.stock_id = its.id
     LEFT JOIN inventory_consumables ic ON ri.consumable_id = ic.id
     
     ${whereClause}
     
     GROUP BY 
        r.id, r.requester_type, r.requester_id, u.name, s.full_name, s.student_id, 
        r.room_id, r.purpose, r.status, r.created_at, r.approved_time, r.issued_time, 
        r.return_deadline, r.last_return_time
     ORDER BY r.issued_time DESC`,
    values
  );

  return rows;
};

const exportReports = async ({ type, role, from, to, room_id }) => {
  const rows = await getIssuedReports({ type, role, from, to, room_id });
  if (exportReportsToExcel) {
    const buffer = await exportReportsToExcel(rows, { type: role || type, from, to });
    return buffer;
  }
  return null;
};

const deleteFilteredReports = async ({ type, role, from, to, room_id }) => {
  const conditions = [`issued_time IS NOT NULL`];
  const values = [];
  let i = 1;

  const activeRole = role || type;

  if (activeRole === 'faculty') { conditions.push(`requester_type = 'faculty'`); }
  else if (activeRole === 'student') { conditions.push(`requester_type = 'student'`); }

  if (room_id) { conditions.push(`room_id = $${i++}`); values.push(room_id); }
  if (from) { conditions.push(`issued_time >= $${i++}`); values.push(from); }
  if (to) { conditions.push(`issued_time <= $${i++}`); values.push(to + ' 23:59:59'); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rowCount } = await query(
    `DELETE FROM requests ${where}`,
    values
  );

  return { deleted: rowCount };
};

module.exports = { getIssuedReports, exportReports, deleteFilteredReports };