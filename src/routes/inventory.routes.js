// src/routes/inventory.routes.js
const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  createType,
  addItem,
  updateItem,
  deleteItem,
  addConsumable,
  updateConsumable,
  listAll,
  createItem,
  updateItemUnified,
  deleteItemUnified
} = require('../controllers/inventory.controller');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.use(authMiddleware.protect);

router.get('/', listAll);

router.post('/', roleMiddleware('admin'), createItem);
router.put('/:id', roleMiddleware('admin'), updateItemUnified);
router.delete('/:id', roleMiddleware('admin'), deleteItemUnified);

router.post('/types', roleMiddleware('admin'), [
  body('sku').notEmpty(),
  body('name').notEmpty(),
  body('type').isIn(['borrowable', 'consumable']),
], createType);

router.post('/items', roleMiddleware('admin'), [
  body('inventory_type_id').isInt(),
  body('barcode').notEmpty(),
], addItem);

router.put('/items/:id', roleMiddleware('admin'), updateItem);
router.delete('/items/:id', roleMiddleware('admin'), deleteItem);

router.post('/consumables', roleMiddleware('admin'), [
  body('inventory_type_id').isInt(),
  body('barcode').notEmpty(),
  body('quantity_total').isInt({ min: 0 }),
], addConsumable);

router.put('/consumables/:id', roleMiddleware('admin'), updateConsumable);

module.exports = router;