const { query } = require('../config/db');
const { exportReportsToExcel } = require('../utils/excelExporter');

/**
 * Build issued report rows with optional filters
 */
const buildReportQuery = ({ type, role, from, to }) => {
  const conditions = [`r.issued_time IS NOT NULL`];
  const values = [];
  let i = 1;

  const activeRole = role || type;

  if (activeRole === 'faculty') {
    conditions.push(`r.requester_type = 'faculty'`);
  } else if (activeRole === 'student') {
    conditions.push(`r.requester_type = 'student'`);
  }

  if (from) { conditions.push(`r.issued_time >= $${i++}`); values.push(from); }
  if (to)   { conditions.push(`r.issued_time <= $${i++}`); values.push(to + ' 23:59:59'); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  return { where, values };
};

const getIssuedReports = async ({ type, role, from, to }) => {
  const { where, values } = buildReportQuery({ type, role, from, to });

  const { rows } = await query(`
    SELECT 
        r.id AS request_id, 
        
        -- If assigned to someone specific, they become the Requester Name
        CASE 
            WHEN ri.assigned_to IS NOT NULL AND ri.assigned_to NOT IN ('Shared Group', 'Requester') THEN ri.assigned_to
            ELSE COALESCE(u.name, s.full_name) 
        END AS requester_name,
        
        r.requester_type, 

        -- Fetch the companion's real ID if they are the assignee
        CASE 
            WHEN ri.assigned_to IS NOT NULL AND ri.assigned_to NOT IN ('Shared Group', 'Requester') THEN 
                (SELECT student_id_text FROM request_group_members rgm WHERE rgm.request_id = r.id AND rgm.full_name = ri.assigned_to LIMIT 1)
            ELSE s.student_id 
        END AS student_id,

        r.requester_id,
        COALESCE(ri.assigned_to, 'Shared Group') AS assignee,
        rm.code AS room_code,
        COALESCE(r.requested_time, r.created_at) AS requested_time,
        r.approved_time, 
        r.issued_time, 
        
        -- RETURNED AT: resolve from multiple sources in priority order:
        -- 1. If all borrowable items are returned via scanner  → MAX(ri.returned_time)
        -- 2. If this is a retroactive log marked RETURNED      → r.full_return_time (set by logRetroactiveRequest)
        -- 3. If request status is RETURNED but no timestamps   → r.full_return_time as last resort
        -- 4. Otherwise null (still out)
        CASE
            -- Normal scanner return: all borrowable items have ri.returned_time set
            WHEN SUM(CASE WHEN ri.inventory_item_id IS NOT NULL AND ri.status = 'ISSUED' THEN 1 ELSE 0 END) = 0
             AND SUM(CASE WHEN ri.inventory_item_id IS NOT NULL THEN 1 ELSE 0 END) > 0
             AND MAX(ri.returned_time) IS NOT NULL
            THEN MAX(ri.returned_time)

            -- Retroactive log that was already returned: request is RETURNED but
            -- ri.returned_time is NULL (retroactive inserts don't set it).
            -- Fall back to r.full_return_time, which logRetroactiveRequest does NOT set either,
            -- so we use the issued_time of the request itself as the stored returned_time
            -- via the retroactive payload's returned_time field stored on the request row.
            -- The safest source is: all items RETURNED status + request status RETURNED
            WHEN r.status = 'RETURNED'
             AND SUM(CASE WHEN ri.inventory_item_id IS NOT NULL AND ri.status = 'ISSUED' THEN 1 ELSE 0 END) = 0
             AND SUM(CASE WHEN ri.inventory_item_id IS NOT NULL THEN 1 ELSE 0 END) > 0
            THEN COALESCE(r.full_return_time, MAX(ri.returned_time), r.issued_time)

            ELSE NULL
        END AS returned_at,

        r.status,
        json_agg(json_build_object(
            'name', it.name,
            'barcode', COALESCE(ii.barcode, ic.barcode),
            'quantity', ri.quantity
        )) AS items
    FROM requests r
    JOIN request_items ri ON ri.request_id = r.id
    JOIN inventory_types it ON it.id = ri.inventory_type_id
    LEFT JOIN inventory_items ii ON ii.id = ri.inventory_item_id
    LEFT JOIN inventory_consumables ic ON ic.id = ri.consumable_id
    LEFT JOIN rooms rm ON rm.id = r.room_id
    LEFT JOIN users u ON u.id = r.requester_id AND r.requester_type = 'faculty'
    LEFT JOIN students s ON s.id = r.requester_id AND r.requester_type = 'student'
    ${where}
    GROUP BY 
        r.id, r.requester_type, r.requester_id, u.name, s.full_name, s.student_id,
        ri.assigned_to, rm.code, r.created_at, r.requested_time, r.approved_time, 
        r.issued_time, r.full_return_time, r.status
    ORDER BY r.issued_time DESC
  `, values);

  return rows;
};

const exportReports = async ({ type, role, from, to }) => {
  const rows = await getIssuedReports({ type, role, from, to });
  if (exportReportsToExcel) {
    const buffer = await exportReportsToExcel(rows, { type: role || type, from, to });
    return buffer;
  }
  return null;
};

const deleteFilteredReports = async ({ type, role, from, to }) => {
  const conditions = [`issued_time IS NOT NULL`];
  const values = [];
  let i = 1;

  const activeRole = role || type;

  if (activeRole === 'faculty') { conditions.push(`requester_type = 'faculty'`); }
  else if (activeRole === 'student') { conditions.push(`requester_type = 'student'`); }

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
