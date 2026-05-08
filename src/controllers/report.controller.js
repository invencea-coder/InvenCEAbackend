const reportService = require('../services/report.service');
const { success, badRequest } = require('../utils/apiResponse');

// ⚡ HELPER: Determines the correct room filter based on role
const getTargetRoomId = (req) => {
  // If the user is an admin, strictly enforce their assigned room
  if (req.user.role === 'admin' && req.user.room_id) {
    return req.user.room_id;
  }
  // If the user is a Dean or Manager, allow them to filter by the requested room_id
  return req.query.room_id || null;
};

const getReports = async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    const targetRoomId = getTargetRoomId(req);
    
    const rows = await reportService.getIssuedReports({ type, from, to, room_id: targetRoomId });
    return success(res, rows);
  } catch (e) { next(e); }
};

const exportReports = async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    const targetRoomId = getTargetRoomId(req);

    const buffer = await reportService.exportReports({ type, from, to, room_id: targetRoomId });
    const filename = `report_${type || 'all'}_${Date.now()}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (e) { next(e); }
};

const deleteReports = async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    const targetRoomId = getTargetRoomId(req);

    if (!from && !to && !type && !targetRoomId) {
      return badRequest(res, 'At least one filter is required for deletion');
    }
    const result = await reportService.deleteFilteredReports({ type, from, to, room_id: targetRoomId });
    return success(res, null, `Deleted ${result.deleted} reports`);
  } catch (e) { next(e); }
};

module.exports = {
  getReports,
  exportReports,
  deleteReports
};