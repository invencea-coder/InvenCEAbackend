// backend/src/routes/manager.routes.js
const express = require('express');
const router = express.Router();
const managerCtrl = require('../controllers/manager.controller');
const authMiddleware = require('../middleware/authMiddleware'); 

const requireManager = (req, res, next) => {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ success: false, message: 'Forbidden: System Manager access only.' });
  }
  next();
};

router.use(authMiddleware.protect); 
router.use(requireManager);

router.get('/stats', managerCtrl.getManagerStats);
router.get('/users', managerCtrl.getAllSystemUsers);
router.post('/users', managerCtrl.provisionUser);
router.delete('/users/:id', managerCtrl.removeUser);

router.get('/students', managerCtrl.getAllStudents);
router.post('/students/bulk', managerCtrl.bulkAddStudents);
router.delete('/students/bulk', managerCtrl.bulkDeleteStudents);

router.get('/faculty', managerCtrl.getAllFaculty);
router.post('/faculty/bulk', managerCtrl.bulkAddFaculty);
router.delete('/faculty/bulk', managerCtrl.bulkDeleteFaculty);
router.put('/students/:id/reset-pin', managerCtrl.resetStudentPin);

// ⚡ ADDED: The Audits route!
router.get('/audits', managerCtrl.getAuditLogs);

module.exports = router;