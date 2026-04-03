// src/services/inventory.service.js
const { query } = require('../config/db');

// ─── Inventory Types ──────────────────────────────────────────────────────────

const createType = async ({ sku, name, category, type, metadata, inventory_mode }) => {
  const { rows } = await query(
    `INSERT INTO inventory_types (sku, name, category, type, metadata, inventory_mode)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [sku, name, category, type, metadata || '{}', inventory_mode || 'unit']
  );
  return rows[0];
};

const listTypes = async () => {
  const { rows } = await query(`SELECT * FROM inventory_types ORDER BY name`);
  return rows;
};

// ─── Unit-mode: Borrowable Items ──────────────────────────────────────────────

const addItem = async ({ inventory_type_id, barcode, location_room_id, metadata }) => {
  if (!location_room_id) throw new Error('Room is required for borrowable items');
  const { rows } = await query(
    `INSERT INTO inventory_items (inventory_type_id, barcode, location_room_id, status, metadata)
     VALUES ($1, $2, $3, 'available', $4) RETURNING *`,
    [inventory_type_id, barcode, location_room_id, metadata || '{}']
  );
  return rows[0];
};

const updateItem = async (id, fields) => {
  const allowed = ['barcode', 'status', 'location_room_id', 'metadata'];
  const updates = [], values = [];
  let i = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) { updates.push(`${key} = $${i++}`); values.push(fields[key]); }
  }
  if (!updates.length) throw new Error('No valid fields to update');
  values.push(id);
  const { rows } = await query(
    `UPDATE inventory_items SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values
  );
  if (!rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
  return rows[0];
};

const deleteItem = async (id) => {
  const { rows } = await query(`DELETE FROM inventory_items WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
  return rows[0];
};

// ─── Consumables ──────────────────────────────────────────────────────────────

const addConsumable = async ({ inventory_type_id, barcode, quantity_total, location_room_id }) => {
  if (!location_room_id) throw new Error('Room is required for consumables');
  const { rows } = await query(
    `INSERT INTO inventory_consumables (inventory_type_id, barcode, quantity_total, quantity_available, location_room_id)
     VALUES ($1, $2, $3, $3, $4) RETURNING *`,
    [inventory_type_id, barcode, quantity_total, location_room_id]
  );
  return rows[0];
};

const updateConsumable = async (id, fields) => {
  const allowed = ['barcode', 'quantity_total', 'quantity_available', 'location_room_id', 'status', 'metadata'];
  const updates = [], values = [];
  let i = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) { updates.push(`${key} = $${i++}`); values.push(fields[key]); }
  }
  if (!updates.length) throw new Error('No valid fields to update');
  values.push(id);
  const { rows } = await query(
    `UPDATE inventory_consumables SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values
  );
  if (!rows.length) throw Object.assign(new Error('Consumable not found'), { status: 404 });
  return rows[0];
};

// ─── Quantity-mode: Stock Entries ─────────────────────────────────────────────

const addStockEntry = async ({ inventory_type_id, barcode, qty_total, room_id }) => {
  if (!room_id) throw new Error('Room is required for stock entries');
  if (!qty_total || qty_total < 1) throw new Error('qty_total must be ≥ 1');
  const { rows } = await query(
    `INSERT INTO inventory_type_stocks (type_id, barcode, qty_total, qty_available, room_id)
     VALUES ($1, $2, $3, $3, $4) RETURNING *`,
    [inventory_type_id, barcode, qty_total, room_id]
  );
  return rows[0];
};

const updateStockEntry = async (id, fields) => {
  const allowed = ['barcode', 'qty_total', 'qty_available', 'status', 'metadata'];
  const updates = [], values = [];
  let i = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) { updates.push(`${key} = $${i++}`); values.push(fields[key]); }
  }
  if (!updates.length) throw new Error('No valid fields to update');
  values.push(id);
  const { rows } = await query(
    `UPDATE inventory_type_stocks SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, values
  );
  if (!rows.length) throw Object.assign(new Error('Stock entry not found'), { status: 404 });
  return rows[0];
};

const deleteStockEntry = async (id) => {
  const { rows } = await query(
    `DELETE FROM inventory_type_stocks WHERE id = $1 RETURNING id`, [id]
  );
  if (!rows.length) throw Object.assign(new Error('Stock entry not found'), { status: 404 });
  return rows[0];
};

// ─── List All (filtered by room) ──────────────────────────────────────────────

const listAll = async (roomId = null) => {
  const params = roomId ? [roomId] : [];
  const roomFilter = roomId ? `WHERE ii.location_room_id = $1` : '';
  const consRoomFilter = roomId ? `WHERE ic.location_room_id = $1` : '';
  const stockRoomFilter = roomId ? `WHERE its.room_id = $1` : '';

  const unitQuery = `
    SELECT
      ii.id,
      ii.id                 AS item_id,
      it.id                 AS inventory_type_id,
      it.name,
      it.sku,
      it.category,
      it.type,
      it.inventory_mode,
      ii.barcode,
      ii.status,
      ii.location_room_id,
      r.code                AS room_code,
      it.metadata           AS type_metadata,
      ii.metadata           AS item_metadata,
      NULL::INTEGER         AS qty_total,
      NULL::INTEGER         AS qty_available,
      NULL::INTEGER         AS stock_id
    FROM inventory_items ii
    JOIN inventory_types it ON it.id = ii.inventory_type_id
                            AND it.inventory_mode = 'unit'
    LEFT JOIN rooms r ON r.id = ii.location_room_id
    ${roomFilter}
    ORDER BY it.name, ii.barcode
  `;

  const consumableQuery = `
    SELECT
      ic.id,
      ic.id                 AS item_id,
      it.id                 AS inventory_type_id,
      it.name,
      it.sku,
      it.category,
      it.type,
      it.inventory_mode,
      ic.barcode,
      ic.status,            -- Now mapped to DB status
      ic.location_room_id,
      r.code                AS room_code,
      it.metadata           AS type_metadata,
      ic.metadata           AS item_metadata, -- Now mapped to DB metadata
      ic.quantity_total     AS qty_total,
      ic.quantity_available AS qty_available,
      NULL::INTEGER         AS stock_id
    FROM inventory_consumables ic
    JOIN inventory_types it ON it.id = ic.inventory_type_id
    LEFT JOIN rooms r ON r.id = ic.location_room_id
    ${consRoomFilter}
    ORDER BY it.name
  `;

  const quantityQuery = `
    SELECT
      its.id,
      its.id                AS item_id,
      it.id                 AS inventory_type_id,
      it.name,
      it.sku,
      it.category,
      it.type,
      it.inventory_mode,
      its.barcode,
      its.status,           -- Now mapped to DB status
      its.room_id           AS location_room_id,
      r.code                AS room_code,
      it.metadata           AS type_metadata,
      its.metadata          AS item_metadata, -- Now mapped to DB metadata
      its.qty_total,
      its.qty_available,
      its.id                AS stock_id
    FROM inventory_type_stocks its
    JOIN inventory_types it ON it.id = its.type_id
                            AND it.inventory_mode = 'quantity'
    LEFT JOIN rooms r ON r.id = its.room_id
    ${stockRoomFilter}
    ORDER BY it.name, its.barcode
  `;

  const [unitRes, consumableRes, quantityRes] = await Promise.all([
    query(unitQuery, params),
    query(consumableQuery, params),
    query(quantityQuery, params),
  ]);

  return {
    items: unitRes.rows,
    consumables: consumableRes.rows,
    quantityItems: quantityRes.rows,
  };
};

// ─── Unified CRUD ─────────────────────────────────────────────────────────────

const createUnifiedItem = async (itemData) => {
  const name             = itemData.name;
  const type             = itemData.type || 'borrowable';
  const barcode          = itemData.barcode;
  const location_room_id = itemData.location_room_id || itemData.room_id;
  const sku              = itemData.sku || barcode || `SKU-${Date.now()}`;
  const category         = itemData.category || 'Uncategorized';
  const quantity_total   = itemData.quantity_total || 1;
  const type_metadata    = itemData.type_metadata || {};
  const item_metadata    = itemData.item_metadata || {};
  const inventory_mode   = itemData.inventory_mode || 'unit';

  if (!name || !barcode) throw Object.assign(new Error('Missing required fields: name, barcode'), { status: 400 });
  if (!location_room_id) throw Object.assign(new Error('Room is required'), { status: 400 });

  let typeRow;
  const existing = await query(
    `SELECT * FROM inventory_types WHERE name = $1 AND inventory_mode = $2`, [name, inventory_mode]
  );
  if (existing.rows.length) {
    typeRow = existing.rows[0];
  } else {
    const newType = await query(
      `INSERT INTO inventory_types (sku, name, category, type, metadata, inventory_mode)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [sku, name, category, type, type_metadata, inventory_mode]
    );
    typeRow = newType.rows[0];
  }

  if (inventory_mode === 'quantity') {
    const result = await query(
      `INSERT INTO inventory_type_stocks (type_id, barcode, qty_total, qty_available, room_id, metadata)
       VALUES ($1, $2, $3, $3, $4, $5) RETURNING *`,
      [typeRow.id, barcode, quantity_total, location_room_id, item_metadata]
    );
    return { ...result.rows[0], inventory_mode: 'quantity', name };
  }

  if (type === 'consumable') {
    const result = await query(
      `INSERT INTO inventory_consumables (inventory_type_id, barcode, quantity_total, quantity_available, location_room_id, metadata)
       VALUES ($1, $2, $3, $3, $4, $5) RETURNING *`,
      [typeRow.id, barcode, quantity_total, location_room_id, item_metadata]
    );
    return result.rows[0];
  }

  const result = await query(
    `INSERT INTO inventory_items (inventory_type_id, barcode, location_room_id, status, metadata)
     VALUES ($1, $2, $3, 'available', $4) RETURNING *`,
    [typeRow.id, barcode, location_room_id, item_metadata]
  );
  return result.rows[0];
};

const updateUnifiedItem = async (id, itemData) => {
  const {
    type, sku, name, category, barcode,
    quantity_total, quantity_available, location_room_id,
    status, type_metadata, item_metadata,
    inventory_mode,
    qty_total, qty_available,
  } = itemData;

  if (!type) throw Object.assign(new Error('Missing type field'), { status: 400 });

  if (inventory_mode === 'quantity') {
    const stockUpdates = [], stockVals = [];
    let si = 1;
    if (barcode)         { stockUpdates.push(`barcode = $${si++}`);       stockVals.push(barcode); }
    if (qty_total   !== undefined) { stockUpdates.push(`qty_total = $${si++}`);   stockVals.push(qty_total); }
    if (qty_available !== undefined) { stockUpdates.push(`qty_available = $${si++}`); stockVals.push(qty_available); }
    if (status)          { stockUpdates.push(`status = $${si++}`);        stockVals.push(status); }
    if (item_metadata)   { stockUpdates.push(`metadata = $${si++}`);      stockVals.push(item_metadata); }
    
    if (stockUpdates.length) {
      stockVals.push(id);
      await query(`UPDATE inventory_type_stocks SET ${stockUpdates.join(', ')} WHERE id = $${si} RETURNING *`, stockVals);
    }
    if (name || sku || type_metadata) {
      const { rows: stockRow } = await query(`SELECT type_id FROM inventory_type_stocks WHERE id = $1`, [id]);
      if (stockRow.length) {
        const tu = [], tv = [];
        let ti = 1;
        if (name)          { tu.push(`name = $${ti++}`);     tv.push(name); }
        if (sku)           { tu.push(`sku = $${ti++}`);      tv.push(sku); }
        if (type_metadata) { tu.push(`metadata = $${ti++}`); tv.push(type_metadata); }
        if (tu.length) { tv.push(stockRow[0].type_id); await query(`UPDATE inventory_types SET ${tu.join(', ')} WHERE id = $${ti}`, tv); }
      }
    }
    const { rows } = await query(`SELECT * FROM inventory_type_stocks WHERE id = $1`, [id]);
    return rows[0];
  }

  if (type === 'consumable') {
    const item = await query(`SELECT inventory_type_id FROM inventory_consumables WHERE id = $1`, [id]);
    if (!item.rows.length) throw Object.assign(new Error('Consumable not found'), { status: 404 });
    const typeId = item.rows[0].inventory_type_id;

    if (sku || name || category || type_metadata) {
      const tu = [], tv = []; let ti = 1;
      if (sku)           { tu.push(`sku = $${ti++}`);      tv.push(sku); }
      if (name)          { tu.push(`name = $${ti++}`);     tv.push(name); }
      if (category)      { tu.push(`category = $${ti++}`); tv.push(category); }
      if (type_metadata) { tu.push(`metadata = $${ti++}`); tv.push(type_metadata); }
      if (tu.length) { tv.push(typeId); await query(`UPDATE inventory_types SET ${tu.join(', ')} WHERE id = $${ti}`, tv); }
    }

    const updates = [], vals = []; let i = 1;
    if (barcode)                  { updates.push(`barcode = $${i++}`);            vals.push(barcode); }
    if (quantity_total !== undefined)  { updates.push(`quantity_total = $${i++}`);    vals.push(quantity_total); }
    if (quantity_available !== undefined) { updates.push(`quantity_available = $${i++}`); vals.push(quantity_available); }
    if (location_room_id !== undefined)   { updates.push(`location_room_id = $${i++}`);  vals.push(location_room_id); }
    if (status)                   { updates.push(`status = $${i++}`);             vals.push(status); }
    if (item_metadata)            { updates.push(`metadata = $${i++}`);           vals.push(item_metadata); }
    
    if (!updates.length) return { message: 'No physical item fields to update' };
    vals.push(id);
    const result = await query(`UPDATE inventory_consumables SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    return result.rows[0];
  }

  const item = await query(`SELECT inventory_type_id FROM inventory_items WHERE id = $1`, [id]);
  if (!item.rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
  const typeId = item.rows[0].inventory_type_id;

  if (sku || name || category || type_metadata) {
    const tu = [], tv = []; let ti = 1;
    if (sku)           { tu.push(`sku = $${ti++}`);      tv.push(sku); }
    if (name)          { tu.push(`name = $${ti++}`);     tv.push(name); }
    if (category)      { tu.push(`category = $${ti++}`); tv.push(category); }
    if (type_metadata) { tu.push(`metadata = $${ti++}`); tv.push(type_metadata); }
    if (tu.length) { tv.push(typeId); await query(`UPDATE inventory_types SET ${tu.join(', ')} WHERE id = $${ti}`, tv); }
  }

  const updates = [], vals = []; let i = 1;
  if (barcode)               { updates.push(`barcode = $${i++}`);            vals.push(barcode); }
  if (status)                { updates.push(`status = $${i++}`);             vals.push(status); }
  if (location_room_id !== undefined) { updates.push(`location_room_id = $${i++}`); vals.push(location_room_id); }
  if (item_metadata)         { updates.push(`metadata = $${i++}`);           vals.push(item_metadata); }
  if (!updates.length) return { message: 'No physical item fields to update' };
  vals.push(id);
  const result = await query(`UPDATE inventory_items SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return result.rows[0];
};

const deleteUnifiedItem = async (id, type, inventory_mode) => {
  try {
    if (inventory_mode === 'quantity') {
      const result = await query(`DELETE FROM inventory_type_stocks WHERE id = $1 RETURNING id`, [id]);
      if (!result.rows.length) throw Object.assign(new Error('Stock entry not found'), { status: 404 });
      return result.rows[0];
    }

    if (type) {
      const table = type === 'consumable' ? 'inventory_consumables' : 'inventory_items';
      const result = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (!result.rows.length) throw Object.assign(new Error(`${type} item not found`), { status: 404 });
      return result.rows[0];
    }

    let result = await query(`DELETE FROM inventory_items WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length) return result.rows[0];
    result = await query(`DELETE FROM inventory_consumables WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length) return result.rows[0];
    result = await query(`DELETE FROM inventory_type_stocks WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length) return result.rows[0];
    
    throw Object.assign(new Error('Item not found'), { status: 404 });

  } catch (error) {
    // Graceful Soft Delete if a Foreign Key Constraint blocks actual deletion
    if (error.code === '23503') {
      if (inventory_mode === 'quantity') {
         await query(`UPDATE inventory_type_stocks SET status = 'archived' WHERE id = $1`, [id]);
         return { id, archived: true };
      }
      if (type === 'consumable') {
         await query(`UPDATE inventory_consumables SET status = 'archived' WHERE id = $1`, [id]);
         return { id, archived: true };
      }
      
      const softDelete = await query(
        `UPDATE inventory_items SET status = 'archived' WHERE id = $1 RETURNING id`, [id]
      );
      return softDelete.rows[0];
    }
    throw error;
  }
};

module.exports = {
  createType,
  listTypes,
  addItem,
  updateItem,
  deleteItem,
  addConsumable,
  updateConsumable,
  addStockEntry,
  updateStockEntry,
  deleteStockEntry,
  listAll,
  createUnifiedItem,
  updateUnifiedItem,
  deleteUnifiedItem,
};