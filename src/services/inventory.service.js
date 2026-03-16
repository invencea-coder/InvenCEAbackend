// src/services/inventory.service.js
const { query } = require('../config/db');

// ─── Inventory Types ──────────────────────────────────────────────────────────

const createType = async ({ sku, name, category, type, metadata }) => {
  const { rows } = await query(
    `INSERT INTO inventory_types (sku, name, category, type, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sku, name, category, type, metadata || '{}']
  );
  return rows[0];
};

const listTypes = async () => {
  const { rows } = await query(`SELECT * FROM inventory_types ORDER BY name`);
  return rows;
};

// ─── Borrowable Items ─────────────────────────────────────────────────────────

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
  const updates = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${i++}`);
      values.push(fields[key]);
    }
  }
  if (!updates.length) throw new Error('No valid fields to update');
  values.push(id);
  const { rows } = await query(
    `UPDATE inventory_items SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  if (!rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
  return rows[0];
};

const deleteItem = async (id) => {
  const { rows } = await query(
    `DELETE FROM inventory_items WHERE id = $1 RETURNING id`,
    [id]
  );
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
  const allowed = ['barcode', 'quantity_total', 'quantity_available', 'location_room_id'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = $${i++}`);
      values.push(fields[key]);
    }
  }
  if (!updates.length) throw new Error('No valid fields to update');
  values.push(id);
  const { rows } = await query(
    `UPDATE inventory_consumables SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  if (!rows.length) throw Object.assign(new Error('Consumable not found'), { status: 404 });
  return rows[0];
};

// ─── List All (filtered by room) ──────────────────────────────────────────────

const listAll = async (roomId = null) => {
  // Enhanced to pull JSONB metadata from both types and items
  let borrowableQuery = `
    SELECT
      ii.id,
      ii.id AS item_id,
      it.id AS inventory_type_id,
      it.name,
      it.sku,
      it.category,
      it.type,
      ii.barcode,
      ii.status,
      ii.location_room_id,
      r.code AS room_code,
      it.metadata AS type_metadata,
      ii.metadata AS item_metadata
    FROM inventory_items ii
    JOIN inventory_types it ON it.id = ii.inventory_type_id
    LEFT JOIN rooms r ON r.id = ii.location_room_id
  `;

  let consumableQuery = `
    SELECT
      ic.id,
      ic.id AS item_id,
      it.id AS inventory_type_id,
      it.name,
      it.sku,
      it.category,
      it.type,
      ic.barcode,
      ic.quantity_total,
      ic.quantity_available,
      ic.location_room_id,
      r.code AS room_code,
      it.metadata AS type_metadata
    FROM inventory_consumables ic
    JOIN inventory_types it ON it.id = ic.inventory_type_id
    LEFT JOIN rooms r ON r.id = ic.location_room_id
  `;

  const params = [];
  if (roomId) {
    borrowableQuery += ` WHERE ii.location_room_id = $1`;
    consumableQuery += ` WHERE ic.location_room_id = $1`;
    params.push(roomId);
  }

  borrowableQuery += ` ORDER BY it.name, ii.barcode`;
  consumableQuery += ` ORDER BY it.name`;

  const borrowableRes = await query(borrowableQuery, params);
  const consumableRes = await query(consumableQuery, params);

  return {
    items: borrowableRes.rows,
    consumables: consumableRes.rows,
  };
};

// ─── Unified CRUD ─────────────────────────────────────────────────────────────

const createUnifiedItem = async (itemData) => {
  // Mapping the frontend payload to database schema
  const name = itemData.name;
  const type = itemData.type || 'borrowable'; 
  const barcode = itemData.barcode;
  const location_room_id = itemData.location_room_id || itemData.room_id;
  const sku = itemData.sku || barcode || `SKU-${Date.now()}`;
  const category = itemData.category || 'Uncategorized';
  const quantity_total = itemData.quantity_total || 1;
  const type_metadata = itemData.type_metadata || {};
  const item_metadata = itemData.item_metadata || {};

  if (!name || !barcode) {
    throw Object.assign(new Error('Missing required fields: name, barcode'), { status: 400 });
  }
  if (!location_room_id) {
    throw Object.assign(new Error('Room is required'), { status: 400 });
  }

  let typeRow;
  // Look for existing type by name so we don't duplicate "Arduino Uno" 50 times
  const existing = await query(`SELECT * FROM inventory_types WHERE name = $1`, [name]);
  
  if (existing.rows.length) {
    typeRow = existing.rows[0];
  } else {
    const newType = await query(
      `INSERT INTO inventory_types (sku, name, category, type, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [sku, name, category, type, type_metadata]
    );
    typeRow = newType.rows[0];
  }

  if (type === 'consumable') {
    const result = await query(
      `INSERT INTO inventory_consumables (inventory_type_id, barcode, quantity_total, quantity_available, location_room_id)
       VALUES ($1, $2, $3, $3, $4) RETURNING *`,
      [typeRow.id, barcode, quantity_total, location_room_id]
    );
    return result.rows[0];
  } else {
    // Covers 'borrowable', 'thesis', etc.
    const result = await query(
      `INSERT INTO inventory_items (inventory_type_id, barcode, location_room_id, status, metadata)
       VALUES ($1, $2, $3, 'available', $4) RETURNING *`,
      [typeRow.id, barcode, location_room_id, item_metadata]
    );
    return result.rows[0];
  }
};

const updateUnifiedItem = async (id, itemData) => {
  const { type, sku, name, category, barcode, quantity_total, quantity_available, location_room_id, status, type_metadata, item_metadata } = itemData;

  if (!type) throw Object.assign(new Error('Missing type field'), { status: 400 });

  let typeId;
  if (type === 'consumable') {
    const item = await query(`SELECT inventory_type_id FROM inventory_consumables WHERE id = $1`, [id]);
    if (!item.rows.length) throw Object.assign(new Error('Consumable not found'), { status: 404 });
    typeId = item.rows[0].inventory_type_id;
  } else {
    const item = await query(`SELECT inventory_type_id FROM inventory_items WHERE id = $1`, [id]);
    if (!item.rows.length) throw Object.assign(new Error('Item not found'), { status: 404 });
    typeId = item.rows[0].inventory_type_id;
  }

  // Update Type & Type Metadata
  if (sku || name || category || type_metadata) {
    const updates = [];
    const vals = [];
    let i = 1;
    if (sku) { updates.push(`sku = $${i++}`); vals.push(sku); }
    if (name) { updates.push(`name = $${i++}`); vals.push(name); }
    if (category) { updates.push(`category = $${i++}`); vals.push(category); }
    if (type_metadata) { updates.push(`metadata = $${i++}`); vals.push(type_metadata); }
    
    if (updates.length > 0) {
      vals.push(typeId);
      await query(`UPDATE inventory_types SET ${updates.join(', ')} WHERE id = $${i}`, vals);
    }
  }

  // Update Physical Item & Item Metadata
  if (type === 'consumable') {
    const updates = [];
    const vals = [];
    let i = 1;
    if (barcode) { updates.push(`barcode = $${i++}`); vals.push(barcode); }
    if (quantity_total !== undefined) { updates.push(`quantity_total = $${i++}`); vals.push(quantity_total); }
    if (quantity_available !== undefined) { updates.push(`quantity_available = $${i++}`); vals.push(quantity_available); }
    if (location_room_id !== undefined) { updates.push(`location_room_id = $${i++}`); vals.push(location_room_id); }
    if (!updates.length) return { message: "No physical item fields to update" };
    
    vals.push(id);
    const result = await query(`UPDATE inventory_consumables SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    return result.rows[0];
  } else {
    const updates = [];
    const vals = [];
    let i = 1;
    if (barcode) { updates.push(`barcode = $${i++}`); vals.push(barcode); }
    if (status) { updates.push(`status = $${i++}`); vals.push(status); }
    if (location_room_id !== undefined) { updates.push(`location_room_id = $${i++}`); vals.push(location_room_id); }
    if (item_metadata) { updates.push(`metadata = $${i++}`); vals.push(item_metadata); }

    if (!updates.length) return { message: "No physical item fields to update" };
    vals.push(id);
    const result = await query(`UPDATE inventory_items SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    return result.rows[0];
  }
};

const deleteUnifiedItem = async (id, type) => {
  try {
    if (type) {
      const table = type === 'consumable' ? 'inventory_consumables' : 'inventory_items';
      const result = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (!result.rows.length) throw Object.assign(new Error(`${type} item not found`), { status: 404 });
      return result.rows[0];
    } else {
      let result = await query(`DELETE FROM inventory_items WHERE id = $1 RETURNING id`, [id]);
      if (result.rows.length) return result.rows[0];
      result = await query(`DELETE FROM inventory_consumables WHERE id = $1 RETURNING id`, [id]);
      if (result.rows.length) return result.rows[0];
      throw Object.assign(new Error('Item not found'), { status: 404 });
    }
  } catch (error) {
    // 23503 is the PostgreSQL code for Foreign Key Violation
    if (error.code === '23503') {
      // Soft Delete: Instead of deleting, mark it as archived so it keeps transaction history intact
      if (type !== 'consumable') {
        const softDelete = await query(
          `UPDATE inventory_items SET status = 'archived' WHERE id = $1 RETURNING id`, 
          [id]
        );
        return softDelete.rows[0];
      }
      // If it's a consumable with history, we just throw a friendly error
      throw Object.assign(new Error('Cannot delete this item because it has a borrowing history. Please update its available quantity to 0 instead.'), { status: 400 });
    }
    // Throw any other unexpected errors normally
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
  listAll,
  createUnifiedItem,
  updateUnifiedItem,
  deleteUnifiedItem,
};