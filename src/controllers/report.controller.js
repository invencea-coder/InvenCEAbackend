const reportService = require('../services/report.service');
const { success, badRequest } = require('../utils/apiResponse');

const getReports = async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    const rows = await reportService.getIssuedReports({ type, from, to });
    return success(res, rows);
  } catch (e) { next(e); }
};

const exportReports = async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    const buffer = await reportService.exportReports({ type, from, to });
    const filename = `report_${type || 'all'}_${Date.now()}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (e) { next(e); }
};

const deleteReports = async (req, res, next) => {
  try {
    const { type, from, to } = req.query;
    if (!from && !to && !type) {
      return badRequest(res, 'At least one filter is required for deletion');
    }
    const result = await reportService.deleteFilteredReports({ type, from, to });
    return success(res, result, `Deleted ${result.deleted} records`);
  } catch (e) { next(e); }
};

module.exports = { getReports, exportReports, deleteReports };
