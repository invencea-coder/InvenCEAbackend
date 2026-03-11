const { validationResult } = require('express-validator');
const inventoryService = require('../services/inventory.service');
const { success, created, badRequest } = require('../utils/apiResponse');

// ─── Existing methods ──────────────────────────────────────────────

const createType = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());
    const data = await inventoryService.createType(req.body);
    return created(res, data, 'Inventory type created');
  } catch (e) { next(e); }
};

const addItem = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());
    const data = await inventoryService.addItem(req.body);
    return created(res, data, 'Item added');
  } catch (e) { next(e); }
};

const updateItem = async (req, res, next) => {
  try {
    const data = await inventoryService.updateItem(req.params.id, req.body);
    return success(res, data, 'Item updated');
  } catch (e) { next(e); }
};

const deleteItem = async (req, res, next) => {
  try {
    const data = await inventoryService.deleteItem(req.params.id);
    return success(res, data, 'Item deleted');
  } catch (e) { next(e); }
};

const addConsumable = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());
    const data = await inventoryService.addConsumable(req.body);
    return created(res, data, 'Consumable added');
  } catch (e) { next(e); }
};

const updateConsumable = async (req, res, next) => {
  try {
    const data = await inventoryService.updateConsumable(req.params.id, req.body);
    return success(res, data, 'Consumable updated');
  } catch (e) { next(e); }
};

const listAll = async (req, res, next) => {
  try {
    // FIXED: If user is an Admin, lock them to their room. 
    // If they are a Student/Faculty, use the room_id they selected in the dropdown!
    const roomId = (req.user?.role === 'admin' && req.user.room_id) 
      ? req.user.room_id 
      : req.query.room_id;

    const data = await inventoryService.listAll(roomId);
    return success(res, data);
  } catch (e) { next(e); }
};

// ─── Unified methods (for frontend) ─────────────────────────────────

const createItem = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return badRequest(res, 'Validation failed', errors.array());

    if (req.user?.role === 'admin' && req.user.room_id) {
      req.body.location_room_id = req.user.room_id;
    }

    const data = await inventoryService.createUnifiedItem(req.body);
    return created(res, data, 'Item created');
  } catch (e) { next(e); }
};

const updateItemUnified = async (req, res, next) => {
  try {
    if (req.user?.role === 'admin' && req.user.room_id) {
      req.body.location_room_id = req.user.room_id;
    }
    const data = await inventoryService.updateUnifiedItem(req.params.id, req.body);
    return success(res, data, 'Item updated');
  } catch (e) { next(e); }
};

const deleteItemUnified = async (req, res, next) => {
  try {
    const data = await inventoryService.deleteUnifiedItem(req.params.id, req.query.type);
    return success(res, data, 'Item deleted');
  } catch (e) { next(e); }
};

module.exports = {
  createType,
  addItem,
  updateItem,
  deleteItem,
  addConsumable,
  updateConsumable,
  listAll,
  createItem,
  updateItemUnified,
  deleteItemUnified,
};